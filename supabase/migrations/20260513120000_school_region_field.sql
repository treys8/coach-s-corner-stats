-- ============================================================================
-- Optional `region` column on schools.
--
-- Region is a fourth, fully-optional classification axis (the first three
-- being association, classification, division). It's nullable and never
-- required by the Settings UI — only association + classification are
-- mandatory when publishing scores.
-- ============================================================================

ALTER TABLE public.schools
  ADD COLUMN region TEXT;
