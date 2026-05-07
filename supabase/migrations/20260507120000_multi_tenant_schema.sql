-- ============================================================================
-- Multi-tenant schema refactor.
--
-- Moves from a single-team data model to:
--   schools  →  teams  →  team_seasons (implicit: season_year on a team)
--                ↓
--             roster_entries (player on a team for a season, with jersey)
--                ↓
--             players (persistent identity, scoped to a school)
--
-- Memberships:
--   school_admins (school-wide access — ADs)
--   team_members  (per-team access — coaches, scorers)
--
-- RLS: replaces global is_coach() with is_team_member(team_id) and
-- is_school_admin(school_id). Public-read carve-outs come in a later PR
-- when the public Scores page lands.
--
-- Existing data was throwaway — this migration drops the old tables and
-- recreates with the new shape. The `glossary` content and helper functions
-- (season_year_for, is_season_closed) are preserved.
-- ============================================================================

-- ---- Drop old tables (data was throwaway) ----------------------------------

DROP TABLE IF EXISTS public.stat_snapshots CASCADE;
DROP TABLE IF EXISTS public.csv_uploads    CASCADE;
DROP TABLE IF EXISTS public.games          CASCADE;
DROP TABLE IF EXISTS public.players        CASCADE;
DROP TABLE IF EXISTS public.coaches        CASCADE;

DROP FUNCTION IF EXISTS public.is_coach() CASCADE;

-- ---- Tenants ---------------------------------------------------------------

CREATE TABLE public.schools (
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
CREATE TRIGGER schools_updated_at BEFORE UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.teams (
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
CREATE INDEX teams_school_idx ON public.teams (school_id);
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- Memberships -----------------------------------------------------------

CREATE TABLE public.school_admins (
  school_id  UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, user_id)
);

CREATE TABLE public.team_members (
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'coach' CHECK (role IN ('coach', 'scorer', 'assistant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- ---- Players (persistent identity, school-scoped) --------------------------

CREATE TABLE public.players (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  grad_year   SMALLINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, first_name, last_name)
);
CREATE INDEX players_school_idx ON public.players (school_id);
CREATE TRIGGER players_updated_at BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Roster entry: which team a player is on for a specific season, plus that
-- season's jersey number. A player can be on multiple teams (varsity + JV
-- mid-season call-up scenarios) so we don't constrain to one entry per
-- (player, season).
CREATE TABLE public.roster_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_year   SMALLINT NOT NULL,
  jersey_number TEXT,
  position      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, season_year, player_id)
);
CREATE INDEX roster_entries_team_season_idx ON public.roster_entries (team_id, season_year);
CREATE INDEX roster_entries_player_idx      ON public.roster_entries (player_id);

-- ---- Stats / games / uploads (now team-scoped) -----------------------------

CREATE TABLE public.stat_snapshots (
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
CREATE INDEX stat_snapshots_team_season_idx ON public.stat_snapshots (team_id, season_year);
CREATE INDEX stat_snapshots_player_idx      ON public.stat_snapshots (player_id, upload_date DESC);

CREATE TABLE public.games (
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
  -- Forward-looking fields for the Scores page (PR C):
  is_final       BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX games_team_date_idx ON public.games (team_id, game_date);
CREATE INDEX games_finalized_idx ON public.games (is_final, game_date) WHERE is_final = TRUE;
CREATE TRIGGER games_updated_at BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.csv_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_year  SMALLINT NOT NULL,
  upload_date  DATE NOT NULL,
  filename     TEXT,
  player_count INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX csv_uploads_team_idx ON public.csv_uploads (team_id, upload_date DESC);

-- ============================================================================
-- RLS policies
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

-- Helper functions (SECURITY DEFINER so RLS doesn't recurse into membership tables)

CREATE OR REPLACE FUNCTION public.is_school_admin(p_school UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_admins
    WHERE school_id = p_school AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(p_team UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

-- schools: members of a school (admins or any team member) can read it; only admins can write.
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

-- teams: school admins or team members
CREATE POLICY "teams read by members" ON public.teams
  FOR SELECT USING (public.is_team_member(id) OR public.is_school_admin(school_id));
CREATE POLICY "teams write by school admin" ON public.teams
  FOR ALL USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));

-- school_admins: visible to admins of the same school; writable only by existing admins.
CREATE POLICY "school_admins manage by admins" ON public.school_admins
  FOR ALL USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));
-- Allow a user to read their own membership rows so the app can discover their schools.
CREATE POLICY "school_admins read own" ON public.school_admins
  FOR SELECT USING (user_id = auth.uid());

-- team_members: managed by school admins; readable by team members for that team.
CREATE POLICY "team_members manage by school admin" ON public.team_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND public.is_school_admin(t.school_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND public.is_school_admin(t.school_id))
  );
CREATE POLICY "team_members read own team" ON public.team_members
  FOR SELECT USING (public.is_team_member(team_id) OR user_id = auth.uid());

-- players: scoped to a school; readable/writable by anyone with team access at that school.
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

-- roster_entries / stat_snapshots / games / csv_uploads: scoped to team.
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
-- Demo seed: gives treyschill@gmail.com a school + team to work in until the
-- self-serve signup flow lands. Idempotent: re-running this migration won't
-- duplicate. The user's auth.users.id may not exist yet at migration time —
-- the seed handles that gracefully (NULL → skip the membership insert).
-- ============================================================================

DO $$
DECLARE
  v_user_id UUID;
  v_school_id UUID;
  v_team_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = 'treyschill@gmail.com' LIMIT 1;

  -- Demo school (idempotent on slug).
  INSERT INTO public.schools (slug, name, short_name)
  VALUES ('demo', 'Demo School', 'DS')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_school_id;

  -- Demo team (idempotent on (school, slug)).
  INSERT INTO public.teams (school_id, slug, name, sport, level)
  VALUES (v_school_id, 'varsity-baseball', 'Varsity Baseball', 'baseball', 'varsity')
  ON CONFLICT (school_id, slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_team_id;

  -- Membership rows (only if the user has signed up at least once).
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.school_admins (school_id, user_id, role)
    VALUES (v_school_id, v_user_id, 'owner')
    ON CONFLICT (school_id, user_id) DO NOTHING;

    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (v_team_id, v_user_id, 'coach')
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;
END $$;
