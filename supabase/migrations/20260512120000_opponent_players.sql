-- ============================================================================
-- Opponent player tracking — Phase 1 schema.
--
-- Reverses the v1 tablet-design decision that "opponent batters are NOT
-- tracked individually." Coaches now want game logs, stats, and live in-game
-- spray/history for opposing players. See plan:
--   /Users/trey/.claude/plans/yes-talk-through-atomic-flame.md
--
-- Ownership model: each team owns its own ledger. Stats team A records
-- (including opponent player stats) stay in team A's account forever — they
-- never propagate to team B's account, even when team B is also a Statly
-- tenant and the games are linked via game_links. opponent_players therefore
-- is school-scoped, not a global registry.
--
-- This migration:
--   1. Creates `opponent_players` (school-scoped opposing-player identity)
--   2. Adds `at_bats.opponent_batter_id` (parallel to batter_id, mutually
--      exclusive via CHECK).
--   3. Adds `opponent_player_id` to `game_opponent_pitchers` so pitcher
--      identity migrates to opponent_players. Backfills existing rows.
--   4. Adds `schools.is_public_roster` (opt-out toggle; defaults TRUE).
--   5. Rebuilds `game_events.event_type` CHECK to include
--      `opposing_lineup_edit`.
-- ============================================================================

-- ---- opponent_players ------------------------------------------------------

CREATE TABLE public.opponent_players (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- The opposing Statly team when the opponent is also a tenant. Null when
  -- the coach typed the opponent in ad-hoc or the opposing school isn't on
  -- Statly. Used by the soft-identity unique index below to keep manual
  -- "Smith #12" records separate from tenant-linked rows.
  opponent_team_id    UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  -- Source row when copied from another tenant's roster via
  -- get_public_roster(). Lets us refresh-from-source later without losing
  -- our own annotations / at_bat references.
  external_player_id  UUID REFERENCES public.players(id) ON DELETE SET NULL,
  first_name          TEXT,
  last_name           TEXT,
  jersey_number       TEXT,
  bats                TEXT,
  throws              TEXT,
  grad_year           SMALLINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX opponent_players_school_idx       ON public.opponent_players (school_id);
CREATE INDEX opponent_players_school_team_idx  ON public.opponent_players (school_id, opponent_team_id);
CREATE INDEX opponent_players_external_idx     ON public.opponent_players (external_player_id) WHERE external_player_id IS NOT NULL;

-- Soft identity: prevent duplicates by (school, lowercase last name, jersey,
-- opponent_team_id). Ad-hoc rows (opponent_team_id NULL) bucket together via
-- the COALESCE sentinel '__manual__' so two manual "Smith #12" entries don't
-- collide with a future tenant-linked "Smith #12".
CREATE UNIQUE INDEX opponent_players_soft_identity_idx
  ON public.opponent_players (
    school_id,
    lower(COALESCE(last_name, '')),
    COALESCE(jersey_number, ''),
    COALESCE(opponent_team_id::text, '__manual__')
  );

CREATE TRIGGER opponent_players_updated_at BEFORE UPDATE ON public.opponent_players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- RLS: school-scoped (mirrors the players policy pattern) ---------------

ALTER TABLE public.opponent_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opponent_players read by school members" ON public.opponent_players
  FOR SELECT USING (
    public.is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = public.opponent_players.school_id
        AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "opponent_players write by school members" ON public.opponent_players
  FOR ALL USING (
    public.is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = public.opponent_players.school_id
        AND tm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = public.opponent_players.school_id
        AND tm.user_id = auth.uid()
    )
  );

-- ---- at_bats.opponent_batter_id --------------------------------------------

ALTER TABLE public.at_bats
  ADD COLUMN opponent_batter_id UUID REFERENCES public.opponent_players(id) ON DELETE SET NULL;

CREATE INDEX at_bats_opp_batter_idx
  ON public.at_bats (opponent_batter_id)
  WHERE opponent_batter_id IS NOT NULL;

-- Mutual exclusion: a PA is either ours (batter_id set) or theirs
-- (opponent_batter_id set), never both. Legacy opponent PAs predate the
-- column and have both NULL — the `<= 1` form accommodates that without
-- requiring a backfill sweep.
ALTER TABLE public.at_bats
  ADD CONSTRAINT at_bats_batter_xor_opponent_chk
  CHECK ((batter_id IS NOT NULL)::int + (opponent_batter_id IS NOT NULL)::int <= 1);

-- ---- game_opponent_pitchers → opponent_players linkage ---------------------
--
-- Existing data: game_opponent_pitchers rows hold {game_id, name} entered by
-- coaches during prior live games. Migrate each to an opponent_players row
-- (last_name only; no jersey/team_id) so opposing pitchers and batters share
-- the same identity table going forward. game_opponent_pitchers stays in
-- place for now as a compatibility shim — at_bats.opponent_pitcher_id still
-- points at it. Phase 1.5 migration will retarget that FK to opponent_players
-- and drop game_opponent_pitchers.

ALTER TABLE public.game_opponent_pitchers
  ADD COLUMN opponent_player_id UUID REFERENCES public.opponent_players(id) ON DELETE SET NULL;

DO $$
DECLARE
  r RECORD;
  v_school_id UUID;
  v_opponent_player_id UUID;
BEGIN
  FOR r IN
    SELECT gop.id AS gop_id, gop.name, t.school_id
      FROM public.game_opponent_pitchers gop
      JOIN public.games g ON g.id = gop.game_id
      JOIN public.teams t ON t.id = g.team_id
     WHERE gop.opponent_player_id IS NULL
  LOOP
    -- Soft-identity upsert: re-running this migration on a DB that already
    -- backfilled some rows finds the same opponent_players row instead of
    -- creating a duplicate.
    INSERT INTO public.opponent_players (school_id, last_name)
    VALUES (r.school_id, r.name)
    ON CONFLICT (
      school_id,
      lower(COALESCE(last_name, '')),
      COALESCE(jersey_number, ''),
      COALESCE(opponent_team_id::text, '__manual__')
    )
    DO UPDATE SET updated_at = now()
    RETURNING id INTO v_opponent_player_id;

    UPDATE public.game_opponent_pitchers
       SET opponent_player_id = v_opponent_player_id
     WHERE id = r.gop_id;
  END LOOP;
END $$;

-- ---- schools.is_public_roster ----------------------------------------------
--
-- Default TRUE = opt-out: opposing coaches can pull this school's current
-- roster via get_public_roster() RPC. Admins can flip to FALSE in Settings
-- to hide. See 20260512130000_get_public_roster_rpc.sql.

ALTER TABLE public.schools
  ADD COLUMN is_public_roster BOOLEAN NOT NULL DEFAULT TRUE;

-- ---- game_events.event_type CHECK: add 'opposing_lineup_edit' --------------
--
-- Rebuild the constraint (pattern from
-- 20260511140000_restore_defensive_conference_to_event_check.sql). Idempotent:
-- locates the existing CHECK by name pattern and drops before recreating.

DO $$
DECLARE
  cn TEXT;
BEGIN
  SELECT conname INTO cn
    FROM pg_constraint c
    JOIN pg_class t      ON t.oid = c.conrelid
    JOIN pg_namespace n  ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'game_events'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%event_type%';

  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.game_events DROP CONSTRAINT %I', cn);
  END IF;

  ALTER TABLE public.game_events
    ADD CONSTRAINT game_events_event_type_check
    CHECK (event_type IN (
      'at_bat',
      'pitch',
      'stolen_base',
      'caught_stealing',
      'pickoff',
      'wild_pitch',
      'passed_ball',
      'balk',
      'error_advance',
      'substitution',
      'pitching_change',
      'position_change',
      'game_started',
      'inning_end',
      'game_finalized',
      'correction',
      'defensive_conference',
      'opposing_lineup_edit'
    ));
END $$;
