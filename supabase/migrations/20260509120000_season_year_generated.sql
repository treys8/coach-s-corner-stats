-- Make season_year a generated column on the three tables that derive it from
-- a date column. Eliminates the JS/SQL drift that was causing legitimate Feb 1
-- uploads to be tagged with the wrong season in negative-offset timezones
-- (the JS `seasonYearFor("YYYY-MM-DD")` parsed UTC midnight then read local
-- month/year, returning prior-year for in-season dates).
--
-- After this migration, callers must stop sending `season_year` in INSERT
-- payloads — Postgres rejects writes to GENERATED ALWAYS columns.
--
-- season_year_for(date) is IMMUTABLE (see 20260506120000), required for STORED
-- generated columns.
--
-- This rewrites every row in the three tables. Safe at current scale; would
-- need batching at meaningful row counts.
--
-- Note: roster_entries.season_year is intentionally NOT generated — it's a
-- manual season identifier with no date column to derive from.

-- DROP COLUMN cascades to indexes that reference the column, so we don't need
-- explicit DROP INDEX statements.

-- ---- stat_snapshots ---------------------------------------------------------
ALTER TABLE public.stat_snapshots DROP COLUMN season_year;
ALTER TABLE public.stat_snapshots
  ADD COLUMN season_year SMALLINT
    GENERATED ALWAYS AS (public.season_year_for(upload_date)) STORED;
CREATE INDEX stat_snapshots_team_season_idx ON public.stat_snapshots (team_id, season_year);

-- ---- csv_uploads ------------------------------------------------------------
ALTER TABLE public.csv_uploads DROP COLUMN season_year;
ALTER TABLE public.csv_uploads
  ADD COLUMN season_year SMALLINT
    GENERATED ALWAYS AS (public.season_year_for(upload_date)) STORED;
CREATE INDEX csv_uploads_season_idx ON public.csv_uploads (season_year);

-- ---- games ------------------------------------------------------------------
ALTER TABLE public.games DROP COLUMN season_year;
ALTER TABLE public.games
  ADD COLUMN season_year SMALLINT
    GENERATED ALWAYS AS (public.season_year_for(game_date)) STORED;
CREATE INDEX games_season_idx ON public.games (season_year);
