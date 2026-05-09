# Public Scores — Architecture

The public scores site aggregates live and final scores from every school using Statly into one anonymous, scores-only view. Statistics, rosters, spray charts, and other school-owned data stay private to each school account. This document captures the data model, cross-account matching, display rules, privacy posture, and rollout sequence for that work.

Parent accounts are explicitly out of scope here and tracked separately.

## Goals and non-goals

**Goals**
- A single public URL that shows live and finalized scores from all participating schools.
- Each game has a designated home team (in the rules sense — bats last) whose account controls the public score for that game.
- When two schools both score the same game, the system pairs the records, displays one canonical score, and alerts both coaches if their numbers disagree.
- Score corrections after a game is final are allowed and surface visibly to the public site.

**Non-goals**
- No statistics on the public site, ever. Spray charts, hitting/pitching/fielding stats, video, and other school-owned data stay behind the school login.
- No parent-facing features in this scope.
- No automatic resolution of score disputes — coaches reconcile manually.
- No retroactive cross-account linking for games predating a school's account.

## Current state

What is already built:

- The `/scores` route at `src/app/scores/page.tsx` renders games where `status IN ('in_progress', 'final')` using `force-dynamic` server rendering.
- `games.status` (`draft | in_progress | final`) and `is_final`/`finalized_at` co-exist; a trigger (`games_sync_status_is_final`, `20260508120000_tablet_phase_1_schema.sql`) keeps `is_final` in sync. **All new work standardizes on `status`**, not `is_final`.
- `game_live_state` is a denormalized one-row-per-game table; public read is allowed when the game's `status IN ('in_progress', 'final')`.
- Anonymous SELECT access to schools, teams, and `status IN ('in_progress', 'final')` games is established by `20260507200000_public_scores_rls.sql` plus the policy update in tablet phase 1.
- `at_bats` public read was added then locked back down (`20260508210000_lockdown_at_bats_public_read.sql`); the public surface stays scores-only.
- Tablet finalize path writes back to `games` (status, team_score, opponent_score, result) at `src/lib/scoring/server.ts` lines 165–189. This is one of two write paths that change a public-visible score; the other is manual edits in the schedule UI.

What is not yet built:

- The opponent on a game is free text (`games.opponent`); there is no FK to the opposing school's team.
- There is no concept of a per-game home/visitor designation independent of `games.location` (which is venue/perspective).
- There is no shared identity between two schools' independent records of the same game, and therefore no cross-account discrepancy detection.
- There is no school-level discoverability or coach-contact privacy setting.

**Current bug worth naming explicitly:** if two schools both finalize the same game today, the public `/scores` page renders **two tiles** for that game — one from each perspective — because both rows pass the `status IN ('in_progress', 'final')` public-read policy and there is no link to dedupe on. Step 6 of the rollout (public scores rewrite) must dedupe paired rows; until it lands, this is the current behavior.

## Data model

The model adds five layers on top of the existing schema. Each is independently shippable.

### Layer 1 — opponent identity and home/visitor

```sql
ALTER TABLE public.games
  ADD COLUMN opponent_team_id UUID NULL
    REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN is_home BOOLEAN,
  ADD COLUMN game_sequence SMALLINT NOT NULL DEFAULT 1
    CHECK (game_sequence BETWEEN 1 AND 2),
  ADD COLUMN result_type TEXT NOT NULL DEFAULT 'regulation'
    CHECK (result_type IN ('regulation', 'shortened', 'forfeit', 'suspended'));

CREATE INDEX games_opponent_team_idx ON public.games (opponent_team_id)
  WHERE opponent_team_id IS NOT NULL;

CREATE INDEX games_status_idx ON public.games (status, game_date DESC);
DROP INDEX IF EXISTS public.games_finalized_idx;
```

- `opponent_team_id` — nullable FK; set when the opponent is in the system, NULL for free-text opponents. `ON DELETE SET NULL` so the game survives team deletion. Free-text games never participate in cross-account matching.
- `is_home` — the rules-sense home team designation. **Initially nullable** so the layer-1 migration doesn't require backfill before the create form is updated; layer 2 includes a backfill step (derive from `location`) and then sets it `NOT NULL`. The create/edit form sets it explicitly: 'home' → TRUE, 'away' → FALSE, 'neutral' → required user choice. Independent of `location`.
- `game_sequence` — smallint tiebreaker for doubleheaders (1 or 2). Defaults to 1; the create form pre-fills 2 when a coach creates a second game on the same date against the same opponent.
- `result_type` — distinguishes regulation play from shortened/forfeit/suspended. Discrepancy detection should suppress alerts when both sides agree on a non-standard ending even if the literal scores differ slightly.
- `games_status_idx` replaces the old `games_finalized_idx` (which was keyed on `is_final` and is unused by the current code path). The new index supports the `/scores` query directly.

`location` is retained as venue/perspective metadata. It is not deprecated and not used for matching.

`season_year` is a generated column (`20260509120000_season_year_generated.sql`) computed from `game_date`; it's redundant for matching since both sides will derive the same value from the same date.

### Layer 2 — game pairing

```sql
CREATE TABLE public.game_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_game_id    UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  visitor_game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  confirmed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (home_game_id),
  UNIQUE (visitor_game_id)
);

CREATE INDEX game_links_home_idx    ON public.game_links (home_game_id);
CREATE INDEX game_links_visitor_idx ON public.game_links (visitor_game_id);
```

- Each game can participate in at most one link (uniqueness on both sides).
- `home_game_id` is always the game record owned by the home team's account; `visitor_game_id` is always the visitor's. This ordering is invariant — code never has to ask "which side is which."
- `confirmed_by` is `ON DELETE SET NULL` so links survive coach removals.

**Cross-account discovery RPC.** The bigger change: link confirmation requires a coach to see whether the opposing team has a candidate game on the same date. Current RLS only exposes `status IN ('in_progress', 'final')` games to anyone but team members; `draft` games belonging to another school are invisible. A `SECURITY DEFINER` RPC bridges this gap without widening RLS:

```sql
CREATE OR REPLACE FUNCTION public.game_match_candidates(
  p_my_game_id UUID
) RETURNS TABLE (
  candidate_game_id UUID,
  game_date         DATE,
  game_time         TIME,
  game_sequence     SMALLINT,
  status            TEXT,
  is_home           BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my public.games;
BEGIN
  SELECT * INTO v_my FROM public.games WHERE id = p_my_game_id;
  IF v_my.id IS NULL OR NOT public.is_team_member(v_my.team_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_my.opponent_team_id IS NULL THEN
    RETURN;  -- free-text opponent; no candidates
  END IF;

  RETURN QUERY
    SELECT g.id, g.game_date, g.game_time, g.game_sequence, g.status, g.is_home
    FROM public.games g
    WHERE g.team_id = v_my.opponent_team_id
      AND g.opponent_team_id = v_my.team_id
      AND g.game_date = v_my.game_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.game_match_candidates(UUID) TO authenticated;
```

This returns minimal columns — never scores or stats — for games on the opposing team's account that match this game's date. It enforces caller authorization via `is_team_member` and never leaks information about non-matching games.

**Confirm-link RPC.** Writing a `game_links` row requires referencing the opposing team's game by ID. Under standard RLS, the visitor's coach cannot insert a row that names the home team's `game.id` because they don't own that game. The link confirmation flow is therefore also a `SECURITY DEFINER` RPC:

```sql
CREATE OR REPLACE FUNCTION public.confirm_game_link(
  p_home_game_id    UUID,
  p_visitor_game_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home    public.games;
  v_visitor public.games;
  v_id      UUID;
BEGIN
  SELECT * INTO v_home    FROM public.games WHERE id = p_home_game_id;
  SELECT * INTO v_visitor FROM public.games WHERE id = p_visitor_game_id;

  IF v_home.id IS NULL OR v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'game not found';
  END IF;

  -- Caller must be on EITHER side. Either coach can confirm.
  IF NOT (public.is_team_member(v_home.team_id) OR public.is_team_member(v_visitor.team_id)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Sanity: the games must reference each other.
  IF v_home.opponent_team_id    <> v_visitor.team_id
  OR v_visitor.opponent_team_id <> v_home.team_id
  OR v_home.game_date           <> v_visitor.game_date THEN
    RAISE EXCEPTION 'games do not match';
  END IF;

  -- Sanity: exactly one side must be is_home = TRUE.
  IF v_home.is_home IS NOT TRUE OR v_visitor.is_home IS NOT FALSE THEN
    RAISE EXCEPTION 'home/visitor designation conflict';
  END IF;

  INSERT INTO public.game_links (home_game_id, visitor_game_id, confirmed_by)
  VALUES (v_home.id, v_visitor.id, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_game_link(UUID, UUID) TO authenticated;
```

The home/visitor sanity check guards against the dual-home conflict (both schools claim home) by raising a clear error the UI can show.

**Unlink RPC.** Either side's coach can break a confirmed link unilaterally. Open discrepancies on a deleted link are also deleted via CASCADE.

```sql
CREATE OR REPLACE FUNCTION public.unlink_games(p_link_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_link public.game_links;
BEGIN
  SELECT * INTO v_link FROM public.game_links WHERE id = p_link_id;
  IF v_link.id IS NULL THEN RETURN; END IF;
  IF NOT (
    public.is_team_member((SELECT team_id FROM public.games WHERE id = v_link.home_game_id))
    OR public.is_team_member((SELECT team_id FROM public.games WHERE id = v_link.visitor_game_id))
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  DELETE FROM public.game_links WHERE id = p_link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlink_games(UUID) TO authenticated;
```

Auto-linking unique candidates is deferred. v1 always asks; the RPC is the only insert path.

### Layer 3 — discrepancies

```sql
CREATE TABLE public.score_discrepancies (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_link_id             UUID NOT NULL REFERENCES public.game_links(id) ON DELETE CASCADE,
  -- Canonical home/visitor frame, two perspectives stored:
  home_acct_home_score     INTEGER,
  home_acct_visitor_score  INTEGER,
  vis_acct_home_score      INTEGER,
  vis_acct_visitor_score   INTEGER,
  home_self_confirmed      BOOLEAN NOT NULL DEFAULT FALSE,
  visitor_self_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at              TIMESTAMPTZ,
  CHECK (
    NOT (home_acct_home_score = vis_acct_home_score
         AND home_acct_visitor_score = vis_acct_visitor_score
         AND resolved_at IS NULL)
  )
);

CREATE UNIQUE INDEX score_discrepancies_one_open_per_link
  ON public.score_discrepancies (game_link_id) WHERE resolved_at IS NULL;
```

- One row tracks one disagreement event. If the row is resolved (scores agree) and later reopens, `resolved_at` is cleared rather than inserting a new row. The partial unique index enforces at most one open dispute per link.
- Score columns store both perspectives in canonical home/visitor frame. The `home_acct_*` pair is what the home team's account has recorded; `vis_acct_*` is what the visitor's account has recorded. The CHECK constraint guards against a logically impossible state.
- `home_self_confirmed` / `visitor_self_confirmed` track which coach has clicked "my score is correct" on an open dispute. Cleared automatically whenever that coach changes their score.

#### Score column mapping

`games` stores scores from each account's own perspective (`team_score` = the account's team scored; `opponent_score` = the other team scored). The translation to the canonical frame is:

| Canonical column | Home account row | Visitor account row |
| --- | --- | --- |
| `home_acct_home_score` | `team_score` | n/a |
| `home_acct_visitor_score` | `opponent_score` | n/a |
| `vis_acct_home_score` | n/a | `opponent_score` |
| `vis_acct_visitor_score` | n/a | `team_score` |

The detection trigger (see "Discrepancy detection") performs this mapping on every score-changing UPDATE.

### Layer 4 — privacy posture

```sql
ALTER TABLE public.schools
  ADD COLUMN is_discoverable        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN public_scores_enabled  BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.school_admins
  ADD COLUMN allow_coach_contact BOOLEAN NOT NULL DEFAULT FALSE;
```

- `is_discoverable` — when false, the school's teams do not appear in opponent picker results across other schools. Default true; the picker query filters `WHERE is_discoverable = TRUE`. Existing links are not affected — explicit lookups by team ID continue to work.
- `public_scores_enabled` — when false, **none of the school's games appear on `/scores`**, even when finalized. This is a separate, stronger opt-out from discoverability. Some schools (private schools, programs in transition) may want to use Statly internally without publishing anything publicly. The public games SELECT policy must be amended to require `public_scores_enabled = TRUE` on the team's school.
- `allow_coach_contact` — per-coach, defaults false. Coach contact info (name + email) is exposed to the discrepancy banner only when both sides have an admin with this flag set. Defaults false to avoid spam vectors.

Discoverability and public-scores visibility are independent: a school can keep their scores public without being findable in the picker, or vice versa.

### Layer 5 — RLS for the new tables

```sql
ALTER TABLE public.game_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_discrepancies ENABLE ROW LEVEL SECURITY;

-- game_links: read by team members on either side. Writes only via RPCs.
CREATE POLICY "game_links read by either side" ON public.game_links
  FOR SELECT USING (
    public.is_team_member((SELECT team_id FROM public.games WHERE id = home_game_id))
    OR public.is_team_member((SELECT team_id FROM public.games WHERE id = visitor_game_id))
  );

-- score_discrepancies: same read scope. Writes only via service role / triggers.
CREATE POLICY "score_discrepancies read by either side" ON public.score_discrepancies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.game_links gl
      WHERE gl.id = game_link_id
      AND (
        public.is_team_member((SELECT team_id FROM public.games WHERE id = gl.home_game_id))
        OR public.is_team_member((SELECT team_id FROM public.games WHERE id = gl.visitor_game_id))
      )
    )
  );
```

Existing public read policies on `games` and `game_live_state` must be amended to also gate on `public_scores_enabled`:

```sql
DROP POLICY IF EXISTS "games public read live or finalized" ON public.games;
CREATE POLICY "games public read live or finalized" ON public.games
  FOR SELECT USING (
    status IN ('in_progress', 'final')
    AND EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.schools s ON s.id = t.school_id
      WHERE t.id = public.games.team_id
      AND s.public_scores_enabled = TRUE
    )
  );
-- Analogous update for game_live_state's public-read policy.
```

## Cross-account matching

A pair of game records is a candidate match when:

```
A.opponent_team_id = B.team_id
AND B.opponent_team_id = A.team_id
AND A.game_date      = B.game_date
```

Sport equivalence is implicit: if `A.opponent_team_id = B.team_id`, the two records reference the same team, and that team has exactly one sport. No explicit sport check needed.

Tiebreakers when a single date+teams pair produces multiple candidates (doubleheaders):

1. `game_time` — closest match wins.
2. `game_sequence` — used only when `game_time` is missing or identical on both sides.

**Confirmation flow:**

1. When a coach creates or edits a game with `opponent_team_id` set, the UI calls `game_match_candidates(my_game_id)`.
2. **Zero candidates** — the opposing school may not have entered the game yet. Show a status indicator on the game: *"You've identified Lincoln. Waiting for Lincoln's coach to enter their record."* The UI re-checks on game edit and on dashboard reload.
3. **Exactly one candidate** — show a banner: *"Lincoln has a game that looks like this one. Confirm same game?"* with **Yes / No / Not sure yet**. On confirm, the UI calls `confirm_game_link(home_game_id, visitor_game_id)`.
4. **Multiple candidates** — coach picks from a list. Rare; implies a doubleheader entered without time/sequence on the other side.
5. After confirmation, both sides see a "linked with Lincoln" indicator on the game.

**Failure modes the UI must handle:**

- `confirm_game_link` raises *home/visitor designation conflict*: surface "Both schools have this marked as the home team. One of you needs to correct this before linking." with a deep link to edit `is_home`.
- Bidirectional FK mismatch: surface "Lincoln's record names a different opponent. They may have picked the wrong team." Coach contacts Lincoln (if directory enabled) or waits for them to fix.
- Discoverability opt-out after a partial link: if Lincoln opts out of discovery after Coach A picked them but before confirming, the candidate query still works (it queries by FK directly, not via the picker). Discoverability only affects the picker.

## Display rules for the public site

The `/scores` query becomes:

1. SELECT games where `status IN ('in_progress', 'final')` and the school has `public_scores_enabled = TRUE`.
2. LEFT JOIN `game_links` to identify pairs.
3. **Dedupe pairs:** when a game appears in `game_links` (as either side), keep the home side's row; drop the visitor's. Unlinked games are unaffected.
4. Render in canonical home/visitor frame, regardless of whose account is the source.

Display logic, in priority order:

1. **Linked, both sides finalized.** Show home account's score. Visitor's number is used for discrepancy detection only.
2. **Linked, only home side finalized.** Show home account's score.
3. **Linked, only visitor side finalized.** Show visitor's number with a `(reported by visitor)` label until home finalizes.
4. **Unlinked game (free-text opponent or opposing school has no account).** Show whichever single account's score exists, labeled by who reported it.
5. **In-progress (live).** Prefer home account's `game_live_state` if present and `last_event_at` is recent (within 30 minutes). Fall back to visitor's only if home has *never* heartbeated this game. This avoids public score flip-flop when home pauses for a weather/lunch delay.
6. **Stale in-progress.** If `status='in_progress'` and `last_event_at` is older than 24 hours on both sides, the tile is hidden from `/scores` until the game is finalized or a fresh event lands. Surface the game in the originating coach's dashboard with an "abandoned game" prompt.
7. **Updated indicator.** Show an `updated` badge for 48 hours after the most recent score-changing event on a finalized game. Source: the most recent `game_events` row of type `correction` for the game (if any), else `games.updated_at`. Never silently mutate a public number.

## Discrepancy detection and reconciliation

**Hook point: trigger.** Discrepancy detection runs as a Postgres trigger on `games` (AFTER UPDATE OF status, team_score, opponent_score) and on `game_live_state` (final state changes only). Trigger choice is deliberate: every code path that changes a public-visible score — tablet finalize at `src/lib/scoring/server.ts` lines 165–189, manual edits in the schedule UI, future ingestion paths — fires it without needing to remember to call an RPC. A session-local GUC (`statly.skip_discrepancy_check`) is recognized by the trigger and short-circuits it; admin imports/backfills set this for the duration of the import.

The trigger:
1. Looks up the link; bails if the game is unlinked.
2. Reads both sides' current scores via the canonical mapping.
3. UPSERTs into `score_discrepancies` keyed by `game_link_id` (using the partial unique index on open rows):
   - If scores now agree, set `resolved_at = now()`.
   - If scores still disagree, update the score columns. If the changing side's score moved toward the other's, the dispute may resolve; otherwise it stays open.
4. When a side's score column changes value, clears that side's `*_self_confirmed` flag.

**Coach UX:**

- Both linked coaches see the same alert in their dashboard: *"Lincoln has this game 7-5. You have it 7-6."*
- Three actions:
  - **Update my score** — opens the game editor.
  - **My score is correct** — sets the caller's `*_self_confirmed = TRUE` on the open dispute. Banner stays in the dashboard but quiets visually.
  - **Message Lincoln's coach** — when both schools have an admin with `allow_coach_contact = TRUE`, show contact info. Otherwise show "messaging not available." In-app threads are out of scope for v1.
- When both sides agree, `resolved_at` fills in and banners auto-dismiss.
- Disputes never expire and never appear publicly. They are private to the two coaches.

The home team's number is shown publicly throughout a dispute. This is the hard rule — see "Known limitations."

## Rollout staircase

Each step is independently shippable.

1. **Migration: layer 1 columns.** `opponent_team_id`, `is_home` (nullable), `game_sequence`, `result_type`, `games_status_idx`. Drop `games_finalized_idx`. No UI changes yet.
2. **Opponent picker UI.** Type-ahead against discoverable teams + free-text fallback. Coaches start setting FKs going forward. Form derives `is_home` from `location` selection at create time.
3. **Backfill `is_home` + set NOT NULL.** Derive `TRUE` for `location='home'`, `FALSE` for `location='away'`, leave `NULL` for `location='neutral'` and surface a one-time review prompt to coaches with neutral games. After review window or default ('home' team is whoever the coach claims), `ALTER TABLE games ALTER COLUMN is_home SET NOT NULL`.
4. **Privacy settings UI.** `is_discoverable` and `public_scores_enabled` toggles in school settings (school admins only); `allow_coach_contact` per-admin toggle.
5. **Layer 2: `game_links` table + RPCs.** `game_match_candidates`, `confirm_game_link`, `unlink_games`. Confirmation banner UI. Linked indicator on each side's game.
6. **Public scores rewrite.** Switch `/scores` from per-account perspective to canonical home/visitor display, including dedupe via `game_links`, unlinked fallbacks, the heartbeat-stickiness rule, the stale-game policy, and the `updated` badge.
7. **Layer 3 + detection trigger.** `score_discrepancies` table, partial unique index, mapping logic in the trigger, GUC bypass, dashboard alerts, three coach actions.
8. **Soft re-link prompt** when a free-text opponent later joins Statly. Low priority.

Steps 1–4 are scaffolding with no public-facing behavior change. Step 5 is the first product visible to coaches. Step 6 is the user-visible payoff (and fixes the current `/scores` duplicate-tile bug). Step 7 is the trust-building feature. Step 8 is polish.

## Known limitations

- **Home team is wrong and won't fix.** If the home team enters an incorrect final and is unresponsive, the public score remains wrong. Visitor's number is privately known but not public. Acceptable for v1; revisit if it occurs in practice.
- **Historical games stay perspective-bound.** Games entered before either school had an account, or via CSV import, are not retroactively linked. Step 8's soft re-link prompt is the only path to retroactive linking, and only for free-text matches a coach explicitly approves.
- **Doubleheader ordering disagreements.** If both schools enter games with no `game_time` and inconsistent `game_sequence`, the coach must disambiguate manually during link confirmation.
- **Time zones near midnight.** Games starting near midnight in different time zones could be entered with different `game_date` values. Acceptable to ignore; rare in practice.
- **No external alerting.** Discrepancy alerts surface only in the in-app dashboard. A coach who never logs in won't know there's a dispute. Email digest is a v2 follow-up.
- **Current /scores shows duplicate tiles for paired games.** Until step 6 lands, finalized games scored by both schools render as two separate tiles. This is the existing bug; the rewrite fixes it.
- **Role gating for confirmation/unlink is permissive.** Any team_member can confirm or unlink. If this becomes a problem (e.g., a JV scorer mis-linking a varsity game), restrict to `role IN ('coach')` or to school admins. Worth revisiting once usage is observable.

## Open questions

- **Multi-game series identity.** Three-game weekend series have natural identity ("game 1 of series"). Out of scope; doubleheaders are the only multi-game-in-a-day case handled.
- **Discoverability granularity.** Today's plan is school-level. Some programs may want team-level (varsity discoverable, JV not). Defer until requested.
- **Coach contact ambiguity.** When `allow_coach_contact = TRUE` and a school has multiple admins, which admin is shown? Either flag a "primary contact" admin per school, or surface all opted-in admins in a list. Decision deferred to the privacy-settings UI work in step 4.
- **Auto-linking unique candidates.** Currently always coach-confirm. After observing real confirmation behavior, consider auto-linking when exactly one candidate exists and `is_home` agrees on both sides.
