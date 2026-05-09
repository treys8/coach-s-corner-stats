-- Public scores rollout — Step 1 (Layer 1): opponent identity and home/visitor.
-- See docs/public-scores-architecture.md.
--
-- Adds:
--   - opponent_team_id  : nullable FK to teams; NULL for free-text opponents.
--   - is_home           : rules-sense home designation. Nullable in this step;
--                         backfilled and set NOT NULL in step 3.
--   - game_sequence     : doubleheader tiebreaker (1 or 2).
--   - result_type       : regulation | shortened | forfeit | suspended.
-- Index churn:
--   - Adds games_opponent_team_idx (partial, for cross-account matching).
--   - Adds games_status_idx (status, game_date DESC) used by /scores.
--   - Drops games_finalized_idx (keyed on legacy is_final, unused by current
--     code paths now standardized on status).

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
