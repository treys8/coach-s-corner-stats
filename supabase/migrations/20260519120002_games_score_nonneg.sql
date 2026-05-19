-- games.team_score / opponent_score had no CHECK; a stray client write or bad
-- RPC arg could land a negative score, which then feeds `result` derivation
-- and the public /scores page. Allow NULL (finalize-only field) but block
-- negatives.
--
-- Pre-flight: refuse to apply if existing rows already violate the new check.

DO $$
DECLARE
  v_offenders INT;
BEGIN
  SELECT count(*) INTO v_offenders
    FROM public.games
   WHERE team_score < 0 OR opponent_score < 0;

  IF v_offenders > 0 THEN
    RAISE EXCEPTION
      'games_score_nonneg migration would reject % existing row(s) with a negative score. Investigate and correct before re-running.',
      v_offenders;
  END IF;
END $$;

ALTER TABLE public.games
  ADD CONSTRAINT games_team_score_nonneg
    CHECK (team_score IS NULL OR team_score >= 0),
  ADD CONSTRAINT games_opponent_score_nonneg
    CHECK (opponent_score IS NULL OR opponent_score >= 0);
