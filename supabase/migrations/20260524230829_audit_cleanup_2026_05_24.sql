-- Audit cleanup — addresses Supabase advisor findings (read-only audit 2026-05-24)
--   1× ERROR: security_definer_view  (team_season_records)
--   2× WARN:  function_search_path_mutable  (assign_game_event_sequence, normalize_player_name)
--   7× WARN:  auth_rls_initplan  (wrap auth.uid() in subquery so it's evaluated once per query)
--  13× INFO:  unindexed_foreign_keys

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. team_season_records: switch view from SECURITY DEFINER to SECURITY INVOKER.
--    Views default to running as the creator, bypassing the caller's RLS.
--    With security_invoker=true, the view enforces the caller's policies on
--    the underlying games table.
-- ---------------------------------------------------------------------------
ALTER VIEW public.team_season_records SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 2. Pin search_path on functions flagged with mutable search_path.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.assign_game_event_sequence()       SET search_path = public, pg_catalog;
ALTER FUNCTION public.normalize_player_name(name text)   SET search_path = public, pg_catalog;

-- ---------------------------------------------------------------------------
-- 3. RLS initplan optimization.
--    Replace auth.uid() with (select auth.uid()) so Postgres evaluates it once
--    per query instead of once per row. Semantics are identical.
-- ---------------------------------------------------------------------------

-- schools
DROP POLICY "schools read by members" ON public.schools;
CREATE POLICY "schools read by members" ON public.schools
  FOR SELECT TO public
  USING (
    is_school_admin(id)
    OR EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.school_id = schools.id
        AND tm.user_id = (select auth.uid())
    )
  );

-- school_admins
DROP POLICY "school_admins read own" ON public.school_admins;
CREATE POLICY "school_admins read own" ON public.school_admins
  FOR SELECT TO public
  USING (user_id = (select auth.uid()));

-- team_members
DROP POLICY "team_members read own team" ON public.team_members;
CREATE POLICY "team_members read own team" ON public.team_members
  FOR SELECT TO public
  USING (
    is_team_member(team_id)
    OR user_id = (select auth.uid())
  );

-- players (read)
DROP POLICY "players read by school members" ON public.players;
CREATE POLICY "players read by school members" ON public.players
  FOR SELECT TO public
  USING (
    is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.school_id = players.school_id
        AND tm.user_id = (select auth.uid())
    )
  );

-- players (write)
DROP POLICY "players write by school members" ON public.players;
CREATE POLICY "players write by school members" ON public.players
  FOR ALL TO public
  USING (
    is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.school_id = players.school_id
        AND tm.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.school_id = players.school_id
        AND tm.user_id = (select auth.uid())
    )
  );

-- opponent_players (read)
DROP POLICY "opponent_players read by school members" ON public.opponent_players;
CREATE POLICY "opponent_players read by school members" ON public.opponent_players
  FOR SELECT TO public
  USING (
    is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.school_id = opponent_players.school_id
        AND tm.user_id = (select auth.uid())
    )
  );

-- opponent_players (write)
DROP POLICY "opponent_players write by school members" ON public.opponent_players;
CREATE POLICY "opponent_players write by school members" ON public.opponent_players
  FOR ALL TO public
  USING (
    is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.school_id = opponent_players.school_id
        AND tm.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.school_id = opponent_players.school_id
        AND tm.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Covering indexes for unindexed foreign keys.
--    Tables are small today so creation is instant; included for forward
--    perf as data grows (avoids seq-scans on FK lookups and cascade checks).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS at_bats_opponent_pitcher_idx               ON public.at_bats                (opponent_pitcher_id);
CREATE INDEX IF NOT EXISTS game_events_created_by_idx                 ON public.game_events            (created_by);
CREATE INDEX IF NOT EXISTS game_events_supersedes_event_id_idx        ON public.game_events            (supersedes_event_id);
CREATE INDEX IF NOT EXISTS game_lineup_drafts_created_by_idx          ON public.game_lineup_drafts     (created_by);
CREATE INDEX IF NOT EXISTS game_links_confirmed_by_idx                ON public.game_links             (confirmed_by);
CREATE INDEX IF NOT EXISTS game_live_state_runner_first_idx           ON public.game_live_state        (runner_first);
CREATE INDEX IF NOT EXISTS game_live_state_runner_second_idx          ON public.game_live_state        (runner_second);
CREATE INDEX IF NOT EXISTS game_live_state_runner_third_idx           ON public.game_live_state        (runner_third);
CREATE INDEX IF NOT EXISTS game_opponent_pitchers_opponent_player_idx ON public.game_opponent_pitchers (opponent_player_id);
CREATE INDEX IF NOT EXISTS opponent_players_opponent_team_idx         ON public.opponent_players       (opponent_team_id);
CREATE INDEX IF NOT EXISTS schedule_uploads_created_by_idx            ON public.schedule_uploads       (created_by);
CREATE INDEX IF NOT EXISTS season_locks_locked_by_idx                 ON public.season_locks           (locked_by);
CREATE INDEX IF NOT EXISTS stat_snapshots_upload_id_idx               ON public.stat_snapshots         (upload_id);

COMMIT;
