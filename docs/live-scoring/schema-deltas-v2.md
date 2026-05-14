# Live Scoring v2 — Schema Deltas

> Locked 2026-05-14 via design pass. Read before Stage 1 of the v2 UX build.
> Companion to `live-scoring-v2-ux-direction` memory and `play-catalog.md`.

This doc enumerates every schema change needed to support the v2 UX. The
guiding principle: the live-scoring event log is the source of truth; new
fields go on existing payloads where they describe a single play, new event
types only when the action is independently meaningful (modifier or
state-transition).

## Bucket summary

| Delta | Bucket | Migration? |
|---|---|---|
| `fielder_chain` on at_bat | Payload field | No (jsonb) |
| `batted_ball_type` on at_bat | Payload field | No |
| `error_step_index` on at_bat | Payload field | No |
| `pitch_type_label`, `velocity_mph` on pitch | Payload field | No |
| `umpire_call` event | New event type | **Yes** — CHECK + replay |
| `game_suspended` event + `'suspended'` GameStatus | New event type + enum | **Yes** — CHECK + replay + status enum |
| `league_rules` table | New table | **Yes** — schema + RLS |

Everything else from the v2 UX direction (charged-conference counter,
tag-up, walk-off banner, mercy banner, hit-vs-error prompt, time plays,
reverse-force DPs) is derived from existing state — no schema change.

---

## 1. `AtBatPayload` extensions

Additive optional fields. Replay engine reads them when present; legacy
events with the fields absent still replay correctly.

```ts
interface FielderTouch {
  position: string;                       // '1'..'9' or 'P'/'C'/'1B'/etc.
  action: 'fielded' | 'threw_to' | 'received' | 'tagged' | 'caught';
  target?: Base | 'home';                 // for 'threw_to' / 'tagged'
}

interface AtBatPayload {
  // ... existing fields
  fielder_chain?: FielderTouch[];         // ordered drag chain
  batted_ball_type?: 'ground' | 'fly' | 'line' | 'pop' | 'bunt';
  error_step_index?: number | null;       // index into fielder_chain
}
```

**Why one field, not per-touch events:** the chain is committed only when
the coach taps the outcome — no per-touch undo to support. Storing the
chain inline keeps "one tap = one undoable event" intact and avoids
multi-event coordination in replay. (Decision locked.)

**Rollup implications:** `rollupFielding` can now credit assists/putouts
from `fielder_chain` directly instead of inferring from `fielder_position`.
First-touch (`fielder_chain[0].position`) populates the spray-chart point
and replaces `fielder_position` semantics; keep `fielder_position` for
back-compat read on legacy events.

---

## 2. `PitchPayload` extensions

Optional pitch-richness fields, gated by a per-team toggle (already in v2
UX spec). Default v2 build does **not** ship the toggle UI; field shape is
locked so the data layer doesn't change later.

```ts
type PitchTypeLabel = 'FB' | 'CB' | 'CH' | 'SL' | 'CT' | 'SI' | 'SP' | 'KN';

interface PitchPayload {
  // ... existing fields
  pitch_type_label?: PitchTypeLabel | null;
  velocity_mph?: number | null;
}
```

`location_x`/`location_y` already exist. No migration; replay engine
ignores them today and will pass them through for future analytics.

---

## 3. `umpire_call` event (new event type)

Modeled as a **modifier event** consumed by the next play-resolving event
(`at_bat` for batted balls, `stolen_base` / `error_advance` / etc. for
runner movement). The engine tracks pending umpire calls in
`ReplayState.pending_umpire_calls[]` and clears them when consumed.

```ts
type UmpireCallKind =
  | 'IFR'                       // infield fly — batter auto-out on next at_bat
  | 'obstruction_a'             // play being made — base awarded immediately
  | 'obstruction_b'             // no play being made — base awarded if put out
  | 'batter_interference'       // batter out; runner returns
  | 'runner_interference'       // runner out; ball dead
  | 'spectator_interference'    // umpire-judged base award
  | 'coach_interference';       // runner out

interface UmpireCallPayload {
  kind: UmpireCallKind;
  fielder_position?: string;            // for obstruction_a/b
  offender_id?: string | null;          // player or coach id when known
  awarded_to?: Base | 'home';           // for obstruction, spectator
  notes?: string | null;
}
```

**Why separate events:** locked by user 2026-05-14 — audit-trail value of
"the umpire made this specific call at this moment" outweighs the
replay-coordination cost.

**Balk stays as its own event type.** Already wired through replay; not
unifying under `umpire_call` to keep the diff small.

**Replay rules:**
1. `umpire_call` events append to `pending_umpire_calls`.
2. Next `at_bat` / `stolen_base` / `error_advance` event consumes them in
   order, applies effects, clears the queue.
3. Unconsumed calls at `inning_end` are dropped with a warning.
4. `IFR` flips a flag on the next at_bat — batter is out regardless of
   catch outcome, forced advances are suppressed.
5. Obstruction sets `awarded_to` as the runner's destination, overriding
   the coach-entered runner advance for that runner.

**Migration:** ADD `umpire_call` to `game_events.event_type` CHECK.

---

## 4. `game_suspended` event + `'suspended'` GameStatus

```ts
type GameStatus = 'draft' | 'in_progress' | 'final' | 'suspended';

interface GameSuspendedPayload {
  reason?: 'weather' | 'darkness' | 'curfew' | 'other';
  notes?: string | null;
}
```

**Resume path:** any subsequent event (`at_bat`, `pitch`, etc.) on a
suspended game flips `status` back to `in_progress`. No "unsuspend" event
needed.

**Migrations:**
- ADD `'suspended'` to `games.status` CHECK / enum.
- ADD `game_suspended` to `game_events.event_type` CHECK.
- `/scores` and `game_live_state` consumers stay on the existing
  `status === 'final'` branch; suspended games render as in_progress with
  a banner (no schema work in consumers).

**Rollup:** `stat_snapshots` writes stay gated to `status === 'final'`.
Suspended games do not contribute to season totals until resumed and
finalized.

---

## 5. `league_rules` table

Per-school, per-season configuration. Existing `teams.league_type` /
`nfhs_state` / `pitch_limits` stay as legacy fallback.

```sql
CREATE TABLE public.league_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  season_year     int  NOT NULL,

  -- Mercy
  mercy_threshold_runs    int   NOT NULL DEFAULT 10,
  mercy_threshold_inning  int   NOT NULL DEFAULT 5,
  mercy_threshold_runs_alt    int,    -- e.g., 15-after-3 variant
  mercy_threshold_inning_alt  int,

  -- Pitch counts
  pitch_count_max         int   NOT NULL DEFAULT 105,
  pitch_count_rest_tiers  jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- shape: [{ "pitches": 76, "rest_days": 4 }, ...]
  mid_batter_finish       bool  NOT NULL DEFAULT true,

  -- Substitutions
  courtesy_runner_allowed bool  NOT NULL DEFAULT true,
  reentry_starters_only   bool  NOT NULL DEFAULT true,
  reentry_once_per_starter bool NOT NULL DEFAULT true,

  -- Field
  double_first_base       bool  NOT NULL DEFAULT false,

  -- Extras open for future
  extras                  jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (school_id, season_year)
);

CREATE INDEX league_rules_school_season_idx
  ON public.league_rules (school_id, season_year);
```

**RLS:** read = any signed-in member of the school; write = school admin
only. Mirror the pattern from `team_league_config` and `school_logos`.

**Lookup at game-time:**
```
1. select where school_id = game.school_id and season_year = game.season_year
2. fall back to school default row where season_year IS NULL
3. fall back to NFHS defaults from src/lib/scoring/league-defaults.ts
```

**Why per-(school, season_year), not per-team:** at HS level the school's
state association sets the rules, not the individual team (varsity and JV
share the rule set). Season-year is the right time axis since NFHS updates
rules annually and a mid-season rule change shouldn't retroactively edit
last season's archived games.

**Defaults file:** `src/lib/scoring/league-defaults.ts` ships the NFHS
baseline so a new school is usable on day one without writing a row.
`team_league_config` columns (`league_type`, `nfhs_state`, `pitch_limits`)
stay as a per-team override layer for edge cases (e.g., a JV team running
a different mercy threshold than varsity).

---

## 6. What we explicitly are NOT changing

| v2 feature | Why no schema change |
|---|---|
| Charged-conference counter | `defensive_conference` events already exist; counter is derived from `ReplayState.defensive_conferences` |
| Tag-up confirmation chip | Pure UI prompt; runner advance is already in `runner_advances` |
| Walk-off banner | Derived from `team_score`, `opponent_score`, `inning`, `outs` |
| Mercy banner | Derived; reads from `league_rules.mercy_threshold_*` |
| Hit-vs-error prompt | Just selects between `AtBatResult` values (1B vs E) |
| Stretch attempts | Two events (hit + runner-out-on-throw via `error_advance` or runner-move) |
| Time plays / reverse-force DPs | Derived from event order + outs at time of run-scoring event |
| Force-play slide rule | Outcome modifier — coach picks DP, engine doesn't care which rule produced it |
| Auto-advance proposals | UI state; commits as runner_advances on the at_bat |
| ER reconstruction | Stage 6 work; uses existing `non_pa_runs`, `bases_before`, `reached_on_error` — no new persisted fields |
| Lineup card export | Read-only render of `our_lineup` |
| Continuous batting order | Deferred to v3 (per `no_extra_hitter_in_hs_baseball`) |
| Ejections | Deferred per v2 UX direction — handle as substitution |

---

## 7. Migration order (when Stage 1 begins)

The schema deltas split into two migrations + several payload-shape
changes. Order matters for replay back-compat.

1. **Migration A — event_type CHECK extension.**
   Add `umpire_call` and `game_suspended` to the allow-list. Mirror the
   DROP-then-ADD pattern from `20260512120000_opponent_players.sql`.

2. **Migration B — games.status + league_rules.**
   Add `'suspended'` to `games.status` CHECK. Create `league_rules` table
   + RLS. Seed defaults via a follow-up `INSERT ... ON CONFLICT DO NOTHING`
   keyed on existing schools.

3. **Payload shape changes (no migration).**
   Extend `AtBatPayload` / `PitchPayload` types in `src/lib/scoring/types.ts`.
   Replay engine reads optional fields; existing events without them
   continue to replay unchanged.

4. **Backfill.**
   None needed. All new fields are optional. Old events stay valid.

---

## 8. Open follow-ups (not blocking Stage 1)

- **Charged-conference removal threshold** is not in the engine yet —
  engine logs visits but doesn't auto-force a pitching change on the 4th.
  Worth wiring during Stage 5 (Contextual Prompts).
- **State-by-state pitch limits** seed data: today `pitch-limits.ts` hard-codes
  the federal NFHS table. When `league_rules` ships, move the per-state
  tier data into seed rows.
- **Batting out of order** (Cat 11.9): no event for this today. Defer to
  v3 unless it surfaces in a real game.
- **`extras jsonb`** on `league_rules` is intentional escape hatch for
  rule variants we haven't enumerated. Schema can stay stable while UI
  experiments with new toggles.

---

## Decision log

- 2026-05-14: `fielder_chain` as single payload field, not per-touch events.
- 2026-05-14: `umpire_call` as separate event type (modifier consumed by
  next play-resolving event); audit-trail value wins over coordination cost.
- 2026-05-14: `'suspended'` added to `GameStatus` enum; new
  `game_suspended` event; resume by emitting any subsequent event.
- 2026-05-14: `league_rules` as new table keyed on
  `(school_id, season_year)`; existing team-level columns kept as override
  layer.
