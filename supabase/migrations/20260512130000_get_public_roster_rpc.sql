-- ============================================================================
-- get_public_roster(team_id, season_year) — cross-tenant roster read.
--
-- SECURITY DEFINER bridge that lets the coach scoring a game pull the
-- opposing Statly team's roster into their own opponent_players table when
-- pre-game lineup picker uses the "Pull from Statly" source.
--
-- Returns the (first_name, last_name, jersey_number, position, bats, throws,
-- grad_year) of every roster_entries row for (team_id, season_year), joined
-- to players for identity. Names + numbers are the same data /scores already
-- surfaces in box scores once games are finalized; per-school opt-out via
-- schools.is_public_roster lets admins hide.
--
-- Caller authorization: any authenticated user (no team-membership check).
-- The coach pulling the roster is by definition on a *different* tenant, so
-- requiring is_team_member(p_team_id) would defeat the purpose. The privacy
-- toggle lives at the source: opponent_players.school_id.is_public_roster.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_roster(
  p_team_id     UUID,
  p_season_year SMALLINT
) RETURNS TABLE (
  external_player_id UUID,
  first_name         TEXT,
  last_name          TEXT,
  jersey_number      TEXT,
  position           TEXT,
  grad_year          SMALLINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_school_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT t.school_id INTO v_school_id
    FROM public.teams t
   WHERE t.id = p_team_id;

  IF v_school_id IS NULL THEN
    RETURN; -- unknown team
  END IF;

  -- Honour the source school's opt-out.
  IF NOT EXISTS (
    SELECT 1 FROM public.schools s
     WHERE s.id = v_school_id AND s.is_public_roster = TRUE
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT p.id           AS external_player_id,
           p.first_name,
           p.last_name,
           re.jersey_number,
           re.position,
           p.grad_year
      FROM public.roster_entries re
      JOIN public.players p ON p.id = re.player_id
     WHERE re.team_id = p_team_id
       AND re.season_year = p_season_year
     ORDER BY
       NULLIF(regexp_replace(COALESCE(re.jersey_number, ''), '\D', '', 'g'), '')::INT NULLS LAST,
       p.last_name,
       p.first_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_roster(UUID, SMALLINT) TO authenticated;
