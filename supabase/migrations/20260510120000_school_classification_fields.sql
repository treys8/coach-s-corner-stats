-- ============================================================================
-- School classification fields: association / classification / division.
--
-- Drives filters on the public Scores page so visitors can narrow by
-- governing body (e.g., MAIS, MHSAA), enrollment classification (6A..1A),
-- and division (I, II, III).
--
-- Columns are nullable: existing schools default public_scores_enabled to
-- TRUE and don't yet have these set. The "required to enable public scores"
-- rule is enforced in the Settings UI so existing rows aren't blocked from
-- unrelated edits.
-- ============================================================================

ALTER TABLE public.schools
  ADD COLUMN association    TEXT,
  ADD COLUMN classification TEXT,
  ADD COLUMN division       TEXT;
