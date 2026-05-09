-- Public scores rollout — Step 6 prep: anon read on game_links.
-- See docs/public-scores-architecture.md.
--
-- The /scores page needs to know which finalized/live games are paired so it
-- can dedupe and render a single canonical home/visitor tile per game. The
-- existing game_links policy only exposes rows to team members on either side,
-- which is correct for the coach-facing surface but blocks anon.
--
-- This adds a second SELECT policy letting anon read a link row only when
-- BOTH linked games are themselves publicly visible — i.e. each side passes
-- the same status + public_scores_enabled gate as the games policy. If either
-- school flips public_scores_enabled = FALSE, the link disappears from /scores
-- automatically.
--
-- The leak surface is small: anyone can already infer two games are the same
-- by matching dates and team rosters; surfacing the FK relationship once both
-- sides are public adds no information that wasn't already derivable.

CREATE POLICY "game_links public read when both sides public" ON public.game_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.games gh
      JOIN public.teams th   ON th.id = gh.team_id
      JOIN public.schools sh ON sh.id = th.school_id
      WHERE gh.id = home_game_id
        AND gh.status IN ('in_progress', 'final')
        AND sh.public_scores_enabled = TRUE
    )
    AND EXISTS (
      SELECT 1
      FROM public.games gv
      JOIN public.teams tv   ON tv.id = gv.team_id
      JOIN public.schools sv ON sv.id = tv.school_id
      WHERE gv.id = visitor_game_id
        AND gv.status IN ('in_progress', 'final')
        AND sv.public_scores_enabled = TRUE
    )
  );
