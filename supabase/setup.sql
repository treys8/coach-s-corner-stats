-- ============================================================================
-- Statly — fresh-database setup
--
-- Paste this whole file into a NEW Supabase project's SQL Editor and run it.
-- Result: full schema, RLS, helper functions, glossary, and a demo school
-- assigned to treyschill@gmail.com.
--
-- For existing projects already running the v1 (single-team) schema, run
-- supabase/migrations/20260507120000_multi_tenant_schema.sql instead — it
-- drops the v1 tables and creates the v2 shape.
-- ============================================================================

-- ---- Helper functions -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Seasons run Feb 1 – May 31. Off-season dates roll back to the most recent
-- season year (Jun–Dec → that calendar year, Jan → prior calendar year).
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

CREATE OR REPLACE FUNCTION public.is_season_closed(yr smallint)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (CURRENT_DATE > make_date(yr::int, 5, 31));
$$;

-- ---- Glossary (global stat reference) ---------------------------------------

CREATE TABLE IF NOT EXISTS public.glossary (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  abbreviation TEXT NOT NULL UNIQUE,
  definition   TEXT NOT NULL,
  category     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.glossary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "glossary public read" ON public.glossary;
CREATE POLICY "glossary public read" ON public.glossary FOR SELECT USING (TRUE);

-- ---- Tenants ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.schools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name            TEXT NOT NULL,
  short_name      TEXT,
  logo_url        TEXT,
  primary_color   TEXT,
  secondary_color TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS schools_updated_at ON public.schools;
CREATE TRIGGER schools_updated_at BEFORE UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name        TEXT NOT NULL,
  sport       TEXT NOT NULL CHECK (sport IN ('baseball', 'softball')),
  level       TEXT NOT NULL CHECK (level IN ('varsity', 'jv', 'freshman', 'middle_school')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, slug)
);
CREATE INDEX IF NOT EXISTS teams_school_idx ON public.teams (school_id);
DROP TRIGGER IF EXISTS teams_updated_at ON public.teams;
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- Memberships ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_admins (
  school_id  UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'coach' CHECK (role IN ('coach', 'scorer', 'assistant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- ---- Players ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.players (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  grad_year   SMALLINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, first_name, last_name)
);
CREATE INDEX IF NOT EXISTS players_school_idx ON public.players (school_id);
DROP TRIGGER IF EXISTS players_updated_at ON public.players;
CREATE TRIGGER players_updated_at BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.roster_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_year   SMALLINT NOT NULL,
  jersey_number TEXT,
  position      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, season_year, player_id)
);
CREATE INDEX IF NOT EXISTS roster_entries_team_season_idx ON public.roster_entries (team_id, season_year);
CREATE INDEX IF NOT EXISTS roster_entries_player_idx      ON public.roster_entries (player_id);

-- ---- Stats / games / uploads ------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stat_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season_year SMALLINT NOT NULL,
  upload_date DATE NOT NULL,
  upload_id   UUID,
  stats       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, player_id, upload_date)
);
CREATE INDEX IF NOT EXISTS stat_snapshots_team_season_idx ON public.stat_snapshots (team_id, season_year);
CREATE INDEX IF NOT EXISTS stat_snapshots_player_idx      ON public.stat_snapshots (player_id, upload_date DESC);

CREATE TABLE IF NOT EXISTS public.games (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_year    SMALLINT NOT NULL,
  game_date      DATE NOT NULL,
  game_time      TIME,
  opponent       TEXT NOT NULL,
  location       TEXT NOT NULL DEFAULT 'home' CHECK (location IN ('home', 'away', 'neutral')),
  team_score     INTEGER,
  opponent_score INTEGER,
  result         TEXT CHECK (result IS NULL OR result IN ('W', 'L', 'T')),
  notes          TEXT,
  is_final       BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_team_date_idx ON public.games (team_id, game_date);
CREATE INDEX IF NOT EXISTS games_finalized_idx ON public.games (is_final, game_date) WHERE is_final = TRUE;
DROP TRIGGER IF EXISTS games_updated_at ON public.games;
CREATE TRIGGER games_updated_at BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.csv_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_year  SMALLINT NOT NULL,
  upload_date  DATE NOT NULL,
  filename     TEXT,
  player_count INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS csv_uploads_team_idx ON public.csv_uploads (team_id, upload_date DESC);

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.schools         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_admins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stat_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_uploads     ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_school_admin(p_school UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_admins
    WHERE school_id = p_school AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(p_team UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.school_admins sa ON sa.school_id = t.school_id
    WHERE t.id = p_team AND sa.user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_school_admin(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_member(UUID)  TO anon, authenticated;

DROP POLICY IF EXISTS "schools read by members"       ON public.schools;
DROP POLICY IF EXISTS "schools write by admins"       ON public.schools;
DROP POLICY IF EXISTS "teams read by members"         ON public.teams;
DROP POLICY IF EXISTS "teams write by school admin"   ON public.teams;
DROP POLICY IF EXISTS "school_admins manage by admins" ON public.school_admins;
DROP POLICY IF EXISTS "school_admins read own"        ON public.school_admins;
DROP POLICY IF EXISTS "team_members manage by school admin" ON public.team_members;
DROP POLICY IF EXISTS "team_members read own team"    ON public.team_members;
DROP POLICY IF EXISTS "players read by school members" ON public.players;
DROP POLICY IF EXISTS "players write by school members" ON public.players;
DROP POLICY IF EXISTS "roster_entries by team member" ON public.roster_entries;
DROP POLICY IF EXISTS "stat_snapshots by team member" ON public.stat_snapshots;
DROP POLICY IF EXISTS "games by team member"          ON public.games;
DROP POLICY IF EXISTS "csv_uploads by team member"    ON public.csv_uploads;

CREATE POLICY "schools read by members" ON public.schools
  FOR SELECT USING (
    public.is_school_admin(id)
    OR EXISTS (
      SELECT 1 FROM public.teams t JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = public.schools.id AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "schools write by admins" ON public.schools
  FOR ALL USING (public.is_school_admin(id))
  WITH CHECK (public.is_school_admin(id));

CREATE POLICY "teams read by members" ON public.teams
  FOR SELECT USING (public.is_team_member(id) OR public.is_school_admin(school_id));
CREATE POLICY "teams write by school admin" ON public.teams
  FOR ALL USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));

CREATE POLICY "school_admins manage by admins" ON public.school_admins
  FOR ALL USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));
CREATE POLICY "school_admins read own" ON public.school_admins
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "team_members manage by school admin" ON public.team_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND public.is_school_admin(t.school_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND public.is_school_admin(t.school_id))
  );
CREATE POLICY "team_members read own team" ON public.team_members
  FOR SELECT USING (public.is_team_member(team_id) OR user_id = auth.uid());

CREATE POLICY "players read by school members" ON public.players
  FOR SELECT USING (
    public.is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = public.players.school_id AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "players write by school members" ON public.players
  FOR ALL USING (
    public.is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = public.players.school_id AND tm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = public.players.school_id AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "roster_entries by team member" ON public.roster_entries
  FOR ALL USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

CREATE POLICY "stat_snapshots by team member" ON public.stat_snapshots
  FOR ALL USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

CREATE POLICY "games by team member" ON public.games
  FOR ALL USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

CREATE POLICY "csv_uploads by team member" ON public.csv_uploads
  FOR ALL USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

-- ============================================================================
-- Self-serve signup helper: creates a school + admin row in one transaction
-- as the calling auth.uid(). SECURITY DEFINER so it bypasses RLS on the
-- bootstrap (the user isn't an admin yet at the moment of creation).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_school(p_slug TEXT, p_name TEXT)
RETURNS public.schools
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_school public.schools;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  INSERT INTO public.schools (slug, name)
  VALUES (p_slug, p_name)
  RETURNING * INTO v_school;

  INSERT INTO public.school_admins (school_id, user_id, role)
  VALUES (v_school.id, v_user_id, 'owner');

  RETURN v_school;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_school(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- Demo seed: gives treyschill@gmail.com a school + team to start with.
-- Idempotent. Until self-serve signup ships, this is how the dev account
-- gets a working tenant.
-- ============================================================================

DO $$
DECLARE
  v_user_id UUID;
  v_school_id UUID;
  v_team_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = 'treyschill@gmail.com' LIMIT 1;

  INSERT INTO public.schools (slug, name, short_name)
  VALUES ('demo', 'Demo School', 'DS')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_school_id;

  INSERT INTO public.teams (school_id, slug, name, sport, level)
  VALUES (v_school_id, 'varsity-baseball', 'Varsity Baseball', 'baseball', 'varsity')
  ON CONFLICT (school_id, slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_team_id;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.school_admins (school_id, user_id, role)
    VALUES (v_school_id, v_user_id, 'owner')
    ON CONFLICT (school_id, user_id) DO NOTHING;

    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (v_team_id, v_user_id, 'coach')
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;
END $$;
