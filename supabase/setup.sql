-- ============================================================================
-- coach-s-corner-stats — fresh-database setup
-- Paste this whole file into your new Supabase project's SQL Editor and Run.
-- This is the concatenation of supabase/migrations/*.sql in order.
-- After this runs once, RLS is enabled and only emails in public.coaches can
-- read/write data. The bootstrap coach below grants you access on first deploy.
-- ============================================================================


-- ----------------------------------------------------------------------
-- 20260501193235_019d87d8-480b-4771-b5cf-705a6a03271d.sql
-- ----------------------------------------------------------------------

-- Players roster
CREATE TABLE public.players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  jersey_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (first_name, last_name)
);

-- Weekly stat snapshots per player
CREATE TABLE public.stat_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  upload_date DATE NOT NULL,
  upload_id UUID,
  stats JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, upload_date)
);
CREATE INDEX stat_snapshots_player_idx ON public.stat_snapshots (player_id, upload_date DESC);

-- Glossary of stat abbreviations
CREATE TABLE public.glossary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  abbreviation TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schedule
CREATE TABLE public.games (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_date DATE NOT NULL,
  game_time TIME,
  opponent TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'home',
  team_score INTEGER,
  opponent_score INTEGER,
  result TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX games_date_idx ON public.games (game_date);

-- Upload audit
CREATE TABLE public.csv_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  upload_date DATE NOT NULL,
  filename TEXT,
  player_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (open policies for now; will tighten when auth is added)
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stat_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glossary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_uploads ENABLE ROW LEVEL SECURITY;

-- Open policies (temporary until login is wired)
CREATE POLICY "Public read players" ON public.players FOR SELECT USING (true);
CREATE POLICY "Public write players" ON public.players FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read snapshots" ON public.stat_snapshots FOR SELECT USING (true);
CREATE POLICY "Public write snapshots" ON public.stat_snapshots FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read glossary" ON public.glossary FOR SELECT USING (true);
CREATE POLICY "Public write glossary" ON public.glossary FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read games" ON public.games FOR SELECT USING (true);
CREATE POLICY "Public write games" ON public.games FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read uploads" ON public.csv_uploads FOR SELECT USING (true);
CREATE POLICY "Public write uploads" ON public.csv_uploads FOR ALL USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER players_updated_at BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER games_updated_at BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------
-- 20260501193254_858ded4b-3241-482d-9e14-009ac2a03250.sql
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ----------------------------------------------------------------------
-- 20260501194223_01ad5213-7370-4cfb-9b39-f856f716a8d0.sql
-- ----------------------------------------------------------------------

DELETE FROM public.stat_snapshots;
DELETE FROM public.csv_uploads;

-- ----------------------------------------------------------------------
-- 20260501201617_af7e88ed-8e4c-46e2-a0a0-9ba760fa24d1.sql
-- ----------------------------------------------------------------------
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

-- ----------------------------------------------------------------------
-- 20260506120000_simplify_season_year_for.sql
-- ----------------------------------------------------------------------
-- Simplify season_year_for: the original CASE had unreachable branches.
-- A "season year" is the calendar year of Feb 1 – May 31. Dates in Jun–Dec
-- belong to that calendar year's just-closed season; dates in Jan belong to
-- the prior calendar year's season (the year boundary crossed mid-offseason).
CREATE OR REPLACE FUNCTION public.season_year_for(d date)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM d) = 1 THEN (EXTRACT(YEAR FROM d) - 1)::smallint
    ELSE EXTRACT(YEAR FROM d)::smallint
  END;
$$;

-- ----------------------------------------------------------------------
-- 20260506130000_auth_and_rls.sql
-- ----------------------------------------------------------------------
-- Phase 2 auth: replace open RLS with coach-only access.
-- Coaches are identified by the email on their Supabase Auth JWT, matched
-- against an allow-list in public.coaches. Anyone whose email is in the
-- table can read/write everything; anyone else gets nothing.

CREATE TABLE IF NOT EXISTS public.coaches (
  email      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

-- A coach can see their own row (used by the app to confirm authorization).
DROP POLICY IF EXISTS "coaches read self" ON public.coaches;
CREATE POLICY "coaches read self" ON public.coaches
  FOR SELECT USING (lower(email) = lower(auth.jwt() ->> 'email'));

-- is_coach(): true iff the caller's JWT email is in the coaches table.
-- SECURITY DEFINER so it can read public.coaches even when the caller can't.
CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaches
    WHERE lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_coach() TO anon, authenticated;

-- Drop the old wide-open policies.
DROP POLICY IF EXISTS "Public read players"   ON public.players;
DROP POLICY IF EXISTS "Public write players"  ON public.players;
DROP POLICY IF EXISTS "Public read snapshots" ON public.stat_snapshots;
DROP POLICY IF EXISTS "Public write snapshots" ON public.stat_snapshots;
DROP POLICY IF EXISTS "Public read glossary"  ON public.glossary;
DROP POLICY IF EXISTS "Public write glossary" ON public.glossary;
DROP POLICY IF EXISTS "Public read games"     ON public.games;
DROP POLICY IF EXISTS "Public write games"    ON public.games;
DROP POLICY IF EXISTS "Public read uploads"   ON public.csv_uploads;
DROP POLICY IF EXISTS "Public write uploads"  ON public.csv_uploads;

-- Coach-only policies on every data table.
CREATE POLICY "coaches all players"   ON public.players
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());

CREATE POLICY "coaches all snapshots" ON public.stat_snapshots
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());

CREATE POLICY "coaches all glossary"  ON public.glossary
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());

CREATE POLICY "coaches all games"     ON public.games
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());

CREATE POLICY "coaches all uploads"   ON public.csv_uploads
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());

-- Bootstrap: seed the first coach so you aren't locked out on first deploy.
-- Add more coaches later with: INSERT INTO public.coaches (email) VALUES ('them@example.com');
INSERT INTO public.coaches (email) VALUES ('treyschill@gmail.com')
  ON CONFLICT (email) DO NOTHING;
