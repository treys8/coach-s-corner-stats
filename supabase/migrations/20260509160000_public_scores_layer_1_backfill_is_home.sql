-- Public scores rollout — Step 3: backfill `is_home` and lock it NOT NULL.
-- See docs/public-scores-architecture.md.
--
-- Mapping per the architecture doc:
--   location = 'home'    → is_home = TRUE
--   location = 'away'    → is_home = FALSE
--   location = 'neutral' → is_home = TRUE
--                          (the coach-claims-home default; new neutral games
--                           created via the schedule form already capture an
--                           explicit choice from the coach.)

UPDATE public.games
SET is_home = CASE location
  WHEN 'home' THEN TRUE
  WHEN 'away' THEN FALSE
  ELSE TRUE
END
WHERE is_home IS NULL;

ALTER TABLE public.games ALTER COLUMN is_home SET NOT NULL;
