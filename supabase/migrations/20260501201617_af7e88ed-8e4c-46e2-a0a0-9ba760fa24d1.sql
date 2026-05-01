-- Season helper: a "season year" is the calendar year of Feb 1 – May 31.
-- Dates outside that window are tagged with the nearest preceding season year.
CREATE OR REPLACE FUNCTION public.season_year_for(d date)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM d) >= 2 AND (EXTRACT(MONTH FROM d) < 6 OR (EXTRACT(MONTH FROM d) = 5 AND EXTRACT(DAY FROM d) <= 31))
      THEN EXTRACT(YEAR FROM d)::smallint
    WHEN EXTRACT(MONTH FROM d) < 2
      THEN (EXTRACT(YEAR FROM d) - 1)::smallint
    ELSE EXTRACT(YEAR FROM d)::smallint
  END;
$$;

-- Returns true if a given season year is closed (after May 31 of that year).
CREATE OR REPLACE FUNCTION public.is_season_closed(yr smallint)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (CURRENT_DATE > make_date(yr::int, 5, 31));
$$;

-- Add season_year columns
ALTER TABLE public.players      ADD COLUMN IF NOT EXISTS season_year smallint;
ALTER TABLE public.csv_uploads  ADD COLUMN IF NOT EXISTS season_year smallint;
ALTER TABLE public.stat_snapshots ADD COLUMN IF NOT EXISTS season_year smallint;
ALTER TABLE public.games        ADD COLUMN IF NOT EXISTS season_year smallint;

-- Backfill from existing dates / current date for players
UPDATE public.csv_uploads   SET season_year = public.season_year_for(upload_date) WHERE season_year IS NULL;
UPDATE public.stat_snapshots SET season_year = public.season_year_for(upload_date) WHERE season_year IS NULL;
UPDATE public.games         SET season_year = public.season_year_for(game_date)   WHERE season_year IS NULL;
UPDATE public.players       SET season_year = public.season_year_for(CURRENT_DATE) WHERE season_year IS NULL;

-- Make required going forward
ALTER TABLE public.csv_uploads    ALTER COLUMN season_year SET NOT NULL;
ALTER TABLE public.stat_snapshots ALTER COLUMN season_year SET NOT NULL;
ALTER TABLE public.games          ALTER COLUMN season_year SET NOT NULL;
ALTER TABLE public.players        ALTER COLUMN season_year SET NOT NULL;

-- Players are unique per season (so a new season can re-add a name)
-- Drop old unique on (first_name,last_name) if it exists
DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'public.players'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(first_name, last_name)%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.players DROP CONSTRAINT %I', c);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS players_unique_per_season
  ON public.players (season_year, first_name, last_name);

-- Snapshots are unique per (player, upload_date) already; keep that.
CREATE INDEX IF NOT EXISTS stat_snapshots_season_idx ON public.stat_snapshots (season_year);
CREATE INDEX IF NOT EXISTS players_season_idx        ON public.players (season_year);
CREATE INDEX IF NOT EXISTS games_season_idx          ON public.games (season_year);
CREATE INDEX IF NOT EXISTS csv_uploads_season_idx    ON public.csv_uploads (season_year);
