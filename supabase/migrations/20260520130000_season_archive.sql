-- ============================================================================
-- Season archive: manual "End Season" lock layered on top of the existing
-- May-31 auto-close. A row in `season_locks` freezes writes for a (team,
-- season_year) tuple even before May 31; the auto-close path continues to
-- handle seasons that pass May 31 without a manual archive.
--
-- Companion: team_season_records VIEW for the team W/L surfaces on the
-- team home and records pages.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- season_locks: one row per archived (team, season_year). Writes go through
-- archive_team_season() / unarchive_team_season() so RLS stays simple.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.season_locks (
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_year SMALLINT NOT NULL,
  locked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (team_id, season_year)
);

ALTER TABLE public.season_locks ENABLE ROW LEVEL SECURITY;

-- Members of the team can see whether a season is manually locked.
DROP POLICY IF EXISTS "season_locks read by team member" ON public.season_locks;
CREATE POLICY "season_locks read by team member" ON public.season_locks
  FOR SELECT USING (public.is_team_member(team_id));
-- All writes funnel through the RPCs below — no client INSERT/UPDATE/DELETE.

-- ----------------------------------------------------------------------------
-- Combined predicate: manual lock OR auto May-31. Used by callers that need
-- the full "is this (team, season) editable?" answer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_season_locked(p_team_id UUID, p_year SMALLINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.is_season_closed(p_year)
      OR EXISTS (
        SELECT 1 FROM public.season_locks
         WHERE team_id = p_team_id AND season_year = p_year
      );
$$;

-- Helper used by the restrictive RLS policies below. Kept separate so the
-- predicate is identical across every table without copy-paste drift.
CREATE OR REPLACE FUNCTION public.is_team_season_manually_locked(p_team_id UUID, p_year SMALLINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.season_locks
     WHERE team_id = p_team_id AND season_year = p_year
  );
$$;

-- ----------------------------------------------------------------------------
-- Archive / unarchive RPCs. SECURITY DEFINER so the function can write to
-- season_locks while the underlying client policy is read-only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_team_season(
  p_team_id UUID,
  p_season_year SMALLINT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_team_member(p_team_id) THEN
    RAISE EXCEPTION 'forbidden: not a team member' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.season_locks (team_id, season_year, locked_by)
  VALUES (p_team_id, p_season_year, auth.uid())
  ON CONFLICT (team_id, season_year) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_team_season(UUID, SMALLINT) FROM public;
GRANT EXECUTE ON FUNCTION public.archive_team_season(UUID, SMALLINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.unarchive_team_season(
  p_team_id UUID,
  p_season_year SMALLINT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_team_member(p_team_id) THEN
    RAISE EXCEPTION 'forbidden: not a team member' USING ERRCODE = '42501';
  END IF;
  -- Once May 31 passes, the season is auto-closed and unarchive shouldn't
  -- pretend to "reopen" it — that's a separate decision we deliberately
  -- left out of v1.
  IF public.is_season_closed(p_season_year) THEN
    RAISE EXCEPTION 'cannot unarchive a season past May 31';
  END IF;
  DELETE FROM public.season_locks
   WHERE team_id = p_team_id AND season_year = p_season_year;
END;
$$;

REVOKE ALL ON FUNCTION public.unarchive_team_season(UUID, SMALLINT) FROM public;
GRANT EXECUTE ON FUNCTION public.unarchive_team_season(UUID, SMALLINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- RLS lock-out for client writes. The existing "by team member" policies stay
-- in place (they handle membership); these RESTRICTIVE policies layer on the
-- AND of "not in season_locks". Separate policy per command because:
--   - INSERT uses WITH CHECK against the new row,
--   - UPDATE uses USING (current row) AND WITH CHECK (new row),
--   - DELETE uses USING (current row).
-- ----------------------------------------------------------------------------

-- games: team_id + season_year are columns on the row.
CREATE POLICY "games block insert when locked" ON public.games
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_team_season_manually_locked(team_id, season_year));
CREATE POLICY "games block update when locked" ON public.games
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_team_season_manually_locked(team_id, season_year))
  WITH CHECK (NOT public.is_team_season_manually_locked(team_id, season_year));
CREATE POLICY "games block delete when locked" ON public.games
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_team_season_manually_locked(team_id, season_year));

-- roster_entries: same shape.
CREATE POLICY "roster_entries block insert when locked" ON public.roster_entries
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_team_season_manually_locked(team_id, season_year));
CREATE POLICY "roster_entries block update when locked" ON public.roster_entries
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_team_season_manually_locked(team_id, season_year))
  WITH CHECK (NOT public.is_team_season_manually_locked(team_id, season_year));
CREATE POLICY "roster_entries block delete when locked" ON public.roster_entries
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_team_season_manually_locked(team_id, season_year));

-- stat_snapshots
CREATE POLICY "stat_snapshots block insert when locked" ON public.stat_snapshots
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_team_season_manually_locked(team_id, season_year));
CREATE POLICY "stat_snapshots block update when locked" ON public.stat_snapshots
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_team_season_manually_locked(team_id, season_year))
  WITH CHECK (NOT public.is_team_season_manually_locked(team_id, season_year));
CREATE POLICY "stat_snapshots block delete when locked" ON public.stat_snapshots
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_team_season_manually_locked(team_id, season_year));

-- csv_uploads
CREATE POLICY "csv_uploads block insert when locked" ON public.csv_uploads
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_team_season_manually_locked(team_id, season_year));
CREATE POLICY "csv_uploads block update when locked" ON public.csv_uploads
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_team_season_manually_locked(team_id, season_year))
  WITH CHECK (NOT public.is_team_season_manually_locked(team_id, season_year));
CREATE POLICY "csv_uploads block delete when locked" ON public.csv_uploads
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_team_season_manually_locked(team_id, season_year));

-- game_events: team_id + season_year resolved by joining games via game_id.
-- Wrap the lookup in an inline EXISTS so the predicate works inside USING/CHECK.
CREATE POLICY "game_events block insert when locked" ON public.game_events
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_events.game_id
      AND public.is_team_season_manually_locked(g.team_id, g.season_year)
  ));
CREATE POLICY "game_events block update when locked" ON public.game_events
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_events.game_id
      AND public.is_team_season_manually_locked(g.team_id, g.season_year)
  ))
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_events.game_id
      AND public.is_team_season_manually_locked(g.team_id, g.season_year)
  ));
CREATE POLICY "game_events block delete when locked" ON public.game_events
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_events.game_id
      AND public.is_team_season_manually_locked(g.team_id, g.season_year)
  ));

-- at_bats: existing client policy is read-only (writes happen via service-role
-- replay). Restrictive write policies are redundant and intentionally omitted.

-- ----------------------------------------------------------------------------
-- Trigger-level enforcement. The existing ingest RPCs (ingest_stats_workbook,
-- ingest_schedule, upsert_roster) run SECURITY DEFINER and therefore bypass
-- the RESTRICTIVE policies above for SECURITY DEFINER inserts. Triggers run
-- regardless of RLS, so they're the backstop that actually blocks an upload
-- targeted at a manually-locked season.
--
-- Two trigger functions: one for tables that carry (team_id, season_year)
-- columns directly, one for game_events which resolves them via games.id.
-- Both also reject deletes from a locked tuple.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_season_lock_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.is_team_season_manually_locked(OLD.team_id, OLD.season_year) THEN
      RAISE EXCEPTION 'season % is archived for this team', OLD.season_year
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF public.is_team_season_manually_locked(NEW.team_id, NEW.season_year) THEN
    RAISE EXCEPTION 'season % is archived for this team', NEW.season_year
      USING ERRCODE = '42501';
  END IF;
  -- UPDATE also checks the prior row so you can't escape a locked tuple by
  -- editing team_id or season_year to point away.
  IF TG_OP = 'UPDATE'
     AND public.is_team_season_manually_locked(OLD.team_id, OLD.season_year) THEN
    RAISE EXCEPTION 'season % is archived for this team', OLD.season_year
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_season_lock_via_game_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id UUID;
  v_season  SMALLINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT g.team_id, g.season_year INTO v_team_id, v_season
      FROM public.games g WHERE g.id = OLD.game_id;
  ELSE
    SELECT g.team_id, g.season_year INTO v_team_id, v_season
      FROM public.games g WHERE g.id = NEW.game_id;
  END IF;
  IF v_team_id IS NOT NULL
     AND public.is_team_season_manually_locked(v_team_id, v_season) THEN
    RAISE EXCEPTION 'season % is archived for this team', v_season
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER games_block_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.enforce_season_lock_trg();
CREATE TRIGGER roster_entries_block_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.roster_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_season_lock_trg();
CREATE TRIGGER stat_snapshots_block_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.stat_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_season_lock_trg();
CREATE TRIGGER csv_uploads_block_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.csv_uploads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_season_lock_trg();
CREATE TRIGGER game_events_block_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.game_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_season_lock_via_game_trg();

-- ----------------------------------------------------------------------------
-- Team W/L: derived view over finalized games. RLS inherited from games.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.team_season_records AS
SELECT
  team_id,
  season_year,
  COUNT(*) FILTER (WHERE result = 'W')::INTEGER AS wins,
  COUNT(*) FILTER (WHERE result = 'L')::INTEGER AS losses,
  COUNT(*) FILTER (WHERE result = 'T')::INTEGER AS ties,
  COUNT(*) FILTER (WHERE is_final)::INTEGER     AS games_played
FROM public.games
WHERE is_final = TRUE AND result IS NOT NULL
GROUP BY team_id, season_year;

-- ----------------------------------------------------------------------------
-- Lookup indexes. season_locks PK already covers (team_id, season_year), so
-- the lock-check predicate is index-served. The view aggregates on games
-- which already has games_season_idx + games_team_id_idx from prior migrations.
-- ----------------------------------------------------------------------------

GRANT SELECT ON public.team_season_records TO authenticated, anon;
