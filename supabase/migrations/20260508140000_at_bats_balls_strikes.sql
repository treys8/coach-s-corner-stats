-- Per-at-bat balls and strikes counts. Source for pitcher-level
-- aggregates (total balls / strikes / pitches thrown). Pitch-by-pitch
-- detail (a `pitches` table) is still deferred per the v1 design.

ALTER TABLE public.at_bats
  ADD COLUMN IF NOT EXISTS balls   smallint NOT NULL DEFAULT 0 CHECK (balls   BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS strikes smallint NOT NULL DEFAULT 0 CHECK (strikes BETWEEN 0 AND 3);
