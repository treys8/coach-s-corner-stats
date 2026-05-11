# Opponent tracking — follow-ups

Self-review of the 5-phase opponent tracking build (commits `1f86bb0..66278a2` on `main`, unpushed). Plan at `~/.claude/plans/yes-talk-through-atomic-flame.md`. Migration files at `supabase/migrations/2026051212* / 2026051213* / 2026051214* / 2026051215*` are committed but not yet applied to Supabase.

This file is the punch list. Work it top-to-bottom.

---

## Critical gaps

### 1. Hard gate isn't actually a hard gate

**Where:** `src/app/s/[school]/[team]/score/[gameId]/page.tsx:551`

**Problem:** Start Game button is only `disabled={submitting}`. `validate()` runs on click and produces a toast. The user explicitly asked for hard-gate twice. Current UX: click → error toast → fix → click again.

**Fix:** Compute `validate()` reactively (memoized) and use its result as the `disabled` predicate. Add a small reason chip near the button showing what's missing ("Opposing slot 4 needs a jersey or name"). Keep the on-submit toast as a final guard.

**Effort:** ~30 min.

---

### 2. No mid-game opposing-lineup edit UI

**Where:** `src/components/scoring/LiveScoring.tsx` (FlowControls / Manage sheet)

**Problem:** Phase 1 wired `opposing_lineup_edit` end-to-end (schema CHECK at `supabase/migrations/20260512120000_opponent_players.sql`, replay handler at `src/lib/scoring/replay.ts:196` `applyOpposingLineupEdit`, API route allow-list at `src/app/api/games/[gameId]/events/route.ts:23`, types). **But no UI ever emits one.** The user explicitly required "fully editable mid-game" for the opposing lineup.

**Fix:** Add an "Edit opposing lineup" entry to the Manage sheet (`FlowControls` component around line 760 of `LiveScoring.tsx`). Open a Sheet/Dialog that reuses `OpposingLineupPicker` (already accepts a draft + setDraft). On save, POST an event with `event_type: "opposing_lineup_edit"` and payload `{ opposing_lineup, opponent_use_dh }`. Use `client_event_id: \`opplineup-${Date.now()}\`` (no idempotency window needed — each edit is a distinct event).

The picker may need its own dedicated "edit" wrapper since the pre-game version is tightly coupled to the PreGameForm's surrounding fields. Consider extracting an `OpposingLineupSheet` component.

**Effort:** ~1–2 hr.

---

### 3. No Settings UI for `schools.is_public_roster`

**Where:** `src/app/s/[school]/settings/page.tsx`

**Problem:** Column exists with default `true` (`supabase/migrations/20260512120000_opponent_players.sql`) and `get_public_roster` RPC honors it, but admins have no UI to flip it. Opt-out exists in the schema but not in the product.

**Fix:** Add a `Switch` to the school-level settings form, next to `is_discoverable` and `public_scores_enabled` (those are existing patterns at the same scope). Update the school-row update path on save to include `is_public_roster`. The Insert type in `src/integrations/supabase/types.ts` already has the field optional.

**Effort:** ~30 min.

---

## Real bugs

### 4. `pullFromStatly` uses `currentSeasonYear()` instead of game's season

**Where:** `src/components/score/OpposingLineupPicker.tsx:68`

**Problem:** If a coach is scoring a past-season game (e.g., catching up data entry in early June, after the May 31 season rollover), the wrong season year is sent to `get_public_roster` and zero rows come back.

**Fix:** Plumb the game date through to the picker (it's already on `game.game_date`) and use `seasonYearFor(game.game_date)` from `@/lib/season`. The picker takes `gameId` already; add `gameDate` to the props.

**Effort:** ~5 min.

---

### 5. Misleading "no roster" toast when source school has opted out

**Where:** `src/components/score/OpposingLineupPicker.tsx:71`

**Problem:** Toast says "X hasn't published a current-season roster" but `get_public_roster` returns empty in two cases: no roster *or* `is_public_roster=false`. Coach can't tell which.

**Fix:** When `opponentIsPublicRoster === false`, hide the Pull button (already done via `canPull`). For the empty-roster case, the toast message is fine as-is. Verify the conditional rendering already covers it; if so this is just a flag for awareness, no code change needed.

Alternatively, have `get_public_roster` return a discriminator (e.g., a leading sentinel row) — but that's overkill for a UX paper cut.

**Effort:** ~5 min (if any change needed).

---

### 6. Soft-identity index can collapse genuinely different opponents

**Where:** `supabase/migrations/20260512120000_opponent_players.sql` (unique index `opponent_players_soft_identity_idx`)

**Problem:** The index keys on `(school_id, lower(last_name), jersey_number, COALESCE(opponent_team_id::text, '__manual__'))`. Two manually-entered "#7 Smith" rows — one against Lamar (not on Statly), one against Brookhaven (not on Statly) — both bucket as `__manual__` and collapse to the same row. Stats from both get attributed to the same "Smith #7."

**Won't surface** until a school has two ad-hoc opponents with name collisions. Will eventually happen.

**Fix is non-trivial.** Options:
- Include `games.id` (the originating game) as a salt for `__manual__` — but then the same player across games against the same ad-hoc opponent ALSO splits, defeating cross-game continuity.
- Salt by opponent text from the games table — gets close to the right answer; identity is "Smith #7 vs Lamar" not "Smith #7." Requires a denormalized `opponent_name` column on `opponent_players` and adjustment to the upsert RPC. Probably the right fix.
- Just live with it and add a "merge / split" UI later — pragmatic.

Recommend option 2 (denormalized `opponent_name` salt) — schema migration + RPC + soft-identity rebuild.

**Effort:** ~2–3 hr (migration with care).

---

### 7. Recognition silently swallows errors

**Where:** `src/lib/opponents/recognition.ts:30`

**Problem:** `recognizeOpponentTeam` returns `{ kind: "none" }` on RPC failure. If the new RPC fails to deploy or there's a transient error, the coach sees no auto-link with no signal anything's wrong.

**Fix:** Add `console.warn("recognize_opponent_team failed:", error)` before the `return { kind: "none" }` branch. Don't toast — recognition is a UX nicety, never block the user.

**Effort:** ~2 min.

---

## Coverage gaps

### 8. No new tests for opponent tracking

**Where:** `src/lib/scoring/*.test.ts`, `src/lib/opponents/` (no tests yet)

**Problem:** Extended one fixture in `rollup.test.ts` (added `opponent_batter_id: null` to the factory). Zero tests for:
- Opposing batter slot advancement in `replay.ts` — invariant: `current_opp_batter_slot` advances only when we field, wraps 9→1, survives `inning_end`.
- `applyOpposingLineupEdit` — wholesale replacement, slot-pointer reset only when previously empty.
- `deriveOpposingBatterProfile` — pure, easy to test, drives two pages.

**Fix:** Three test files. Recommend adding to existing `src/lib/scoring/replay.test.ts` for the first two and a new `src/lib/opponents/profile.test.ts` for the third.

**Effort:** ~1 hr.

---

### 9. The `<= 1` CHECK is permissive forever — server should validate at write time

**Where:** `src/app/api/games/[gameId]/events/route.ts`

**Problem:** CHECK constraint allows both `batter_id` and `opponent_batter_id` to be NULL (necessary for legacy data). But the *new* live tablet could still produce both-null PAs if the opposing lineup is empty and we field — `currentOpponentBatterId` resolves to null. The hard gate is supposed to prevent this (#1), but defense in depth is worth it.

**Fix:** In the events route, when `event_type === "at_bat"` and the game is past `draft` status, validate the payload: if the PA half indicates the opposing team is batting (need to derive from game state or trust the payload's `opponent_batter_id` presence), require `opponent_batter_id !== null`. Reject with 400 otherwise.

Caveat: the events route currently doesn't replay state — it just persists then calls `rederive`. Either pull the current half from a lightweight query, or trust the AtBatPayload's own fields (`batter_id === null && opponent_batter_id === null` → reject).

**Effort:** ~20 min.

---

## Smaller things

### 10. Ambiguous-match badge not built

**Where:** Schedule upload preview, schedule row UI

**Problem:** Plan called for a "Match opponent?" badge when recognition returns 2+ candidates. I leaned on the existing `OpponentPicker` as fallback (it does search-as-you-type). Functional, but less proactive than the plan described.

**Fix:** When recognition returns `{ kind: "ambiguous", candidates: [...] }`, store those candidates on the preview row and render a small inline pill with a dropdown. Or skip — the OpponentPicker is fine.

**Effort:** ~1 hr if you want it; otherwise close as won't-do.

---

### 11. `OpposingBatterPanel` refetches on every batter change

**Where:** `src/components/score/OpposingBatterPanel.tsx:25`

**Problem:** No client-side cache. Cycling through their 9-deep lineup means 9 fetches per cycle.

**Fix:** Lift the cache to LiveScoring (a `Map<opponentPlayerId, OpposingBatterProfile>`) and pass the entry as a prop, refetching only on cache miss. Or use SWR / React Query. Or accept it (each fetch is small and the network is on a WiFi tablet).

**Effort:** ~20 min for the manual Map cache.

---

### 12. No way to edit a typo in an opponent player's name

**Where:** Nowhere — gap.

**Problem:** Once an opponent_player is typed in (or pulled), there's no UI to fix a typo from anywhere in the app. The Opponents page is read-only. The plan said "mid-game lineup edits mutate the row" but those edits don't exist (#2).

**Fix:** This naturally falls out of #2. The mid-game edit dialog will also serve as the post-game fix-typo surface (open the same dialog from the Opponents page).

**Effort:** Covered by #2.

---

## Context for picking this up cold

**5 commits in `main` (unpushed):**
- `1f86bb0` Phase 1: schema + replay
- `dc19c86` Phase 2: pre-game UX
- `63bf1eb` Phase 3: auto-recognition
- `46308e6` Phase 4: live side panel
- `66278a2` Phase 5: Opponents tab

**4 migrations to apply** (in order) to Supabase before running the feature:
1. `20260512120000_opponent_players.sql`
2. `20260512130000_get_public_roster_rpc.sql`
3. `20260512140000_upsert_opponent_players_rpc.sql`
4. `20260512150000_recognize_opponent_team_rpc.sql`

**Tests:** 163/163 passing as of `66278a2`. Production build is clean.

**Files most worth reading first:**
- `~/.claude/plans/yes-talk-through-atomic-flame.md` (the plan)
- `src/lib/scoring/types.ts` (the data model)
- `src/lib/scoring/replay.ts` (the engine)
- `src/app/s/[school]/[team]/score/[gameId]/page.tsx` (the pre-game form)
- `src/components/scoring/LiveScoring.tsx` (where mid-game edits would go)

**Memory notes worth checking:**
- `~/.claude/projects/-Users-trey-Desktop-coach-s-corner-stats/memory/opponent_tracking_decision.md`
- `~/.claude/projects/-Users-trey-Desktop-coach-s-corner-stats/memory/tablet_pwa_v1_design.md` (the prior design, now partially superseded)
