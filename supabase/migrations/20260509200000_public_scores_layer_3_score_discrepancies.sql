-- Public scores rollout — Step 7 (Layer 3): score discrepancies table.
-- See docs/public-scores-architecture.md.
--
-- One row per game_link tracks the disagreement lifecycle. Both sides' scores
-- are stored in the canonical home/visitor frame so the trigger can update
-- them without re-deriving the mapping each time.
--
-- Lifecycle (enforced by the trigger in the next migration):
--   - Created when both sides have non-null scores that disagree.
--   - resolved_at set to now() when scores agree.
--   - resolved_at cleared (re-opened) on later disagreement; opened_at stays
--     to track when the dispute first appeared.
--   - home_self_confirmed / visitor_self_confirmed flags cleared automatically
--     whenever that side's score column changes.
--
-- The CHECK constraint guards a logically impossible row: an OPEN dispute
-- where the two perspectives actually agree. The partial unique index caps
-- one open row per link.

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
  ON public.score_discrepancies (game_link_id)
  WHERE resolved_at IS NULL;

-- Supports the dashboard query: list open disputes for the current user's
-- team. Filtered to open rows since resolved history is rarely surfaced.
CREATE INDEX score_discrepancies_open_idx
  ON public.score_discrepancies (game_link_id)
  WHERE resolved_at IS NULL;

ALTER TABLE public.score_discrepancies ENABLE ROW LEVEL SECURITY;

-- Read by either side's team members. Disputes are never publicly visible:
-- the home team's number is what /scores shows during a dispute, and the
-- mismatch itself stays between the two coaches.
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

-- No INSERT/UPDATE/DELETE policy — writes go through the detection trigger
-- (SECURITY DEFINER) and the confirm_my_score RPC.
