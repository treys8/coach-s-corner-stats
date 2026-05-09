-- Public scores rollout — Step 4 (Layer 4): privacy posture.
-- See docs/public-scores-architecture.md.
--
-- Three new flags:
--   schools.is_discoverable        — controls whether the school's teams show
--                                    up in opponent-picker results across
--                                    other schools. Existing FK lookups still
--                                    work; this only affects the search picker.
--   schools.public_scores_enabled  — when FALSE, none of the school's games
--                                    appear on /scores even when finalized.
--                                    Stronger opt-out than discoverability.
--   school_admins.allow_coach_contact — per-admin opt-in for exposing contact
--                                       info on cross-account discrepancy
--                                       banners (step 7). Default FALSE.
--
-- Public-read RLS on games + game_live_state must additionally require the
-- team's school has `public_scores_enabled = TRUE` so toggling that flag off
-- immediately removes a school's games from /scores.

ALTER TABLE public.schools
  ADD COLUMN is_discoverable        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN public_scores_enabled  BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.school_admins
  ADD COLUMN allow_coach_contact BOOLEAN NOT NULL DEFAULT FALSE;

-- ---- Public-read RLS: gate on public_scores_enabled ------------------------

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

DROP POLICY IF EXISTS "game_live_state public read live or final" ON public.game_live_state;
CREATE POLICY "game_live_state public read live or final" ON public.game_live_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.games g
      JOIN public.teams t   ON t.id = g.team_id
      JOIN public.schools s ON s.id = t.school_id
      WHERE g.id = public.game_live_state.game_id
        AND g.status IN ('in_progress', 'final')
        AND s.public_scores_enabled = TRUE
    )
  );
