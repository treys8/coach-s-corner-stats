-- Atomic roster import: one round-trip that upserts players + roster_entries
-- and returns the resolved player ids. Replaces a 3-step JS dance (upsert
-- players → SELECT all school players → upsert roster_entries) that was
-- racy and could leave orphan player rows on partial failure.
--
-- The p_has_* flags encode column-presence semantics from the upload form:
--   * column absent in file  → preserve existing DB value (skip UPDATE for that column)
--   * column present, blank  → write NULL (clear the field)
-- Stats workbooks have no Position/Grad Year columns, so the stats upload page
-- passes p_has_position=false / p_has_grad_year=false to avoid wiping fields
-- previously set via the roster upload.
--
-- SECURITY DEFINER bypasses RLS, so we re-assert the same gate the policies
-- in 20260507120000_multi_tenant_schema.sql use: caller must be a member of
-- the team or an admin of the school, and the team must belong to the school.

CREATE OR REPLACE FUNCTION public.upsert_roster(
  p_school        UUID,
  p_team          UUID,
  p_season        SMALLINT,
  p_players       JSONB,
  p_has_number    BOOLEAN,
  p_has_position  BOOLEAN,
  p_has_grad_year BOOLEAN
)
RETURNS TABLE (player_id UUID, first_name TEXT, last_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.teams t
     WHERE t.id = p_team AND t.school_id = p_school
  ) THEN
    RAISE EXCEPTION 'team does not belong to school';
  END IF;

  IF NOT (public.is_team_member(p_team) OR public.is_school_admin(p_school)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  CREATE TEMP TABLE _incoming (
    first      TEXT NOT NULL,
    last       TEXT NOT NULL,
    number     TEXT,
    position   TEXT,
    grad_year  SMALLINT,
    pid        UUID
  ) ON COMMIT DROP;

  INSERT INTO _incoming (first, last, number, position, grad_year)
  SELECT
    e->>'first',
    e->>'last',
    NULLIF(e->>'number', ''),
    NULLIF(e->>'position', ''),
    NULLIF(e->>'grad_year', '')::SMALLINT
  FROM jsonb_array_elements(p_players) e
  WHERE COALESCE(e->>'first', '') <> '' AND COALESCE(e->>'last', '') <> '';

  -- Upsert players. ON CONFLICT expression matches the functional unique index
  -- created in 20260508220000_players_case_insensitive_unique.sql.
  INSERT INTO public.players AS p (school_id, first_name, last_name, grad_year)
  SELECT
    p_school,
    i.first,
    i.last,
    CASE WHEN p_has_grad_year THEN i.grad_year ELSE NULL END
  FROM _incoming i
  ON CONFLICT (school_id, lower(first_name), lower(last_name))
  DO UPDATE SET
    grad_year  = CASE WHEN p_has_grad_year THEN EXCLUDED.grad_year ELSE p.grad_year END,
    updated_at = now();

  -- Resolve player ids back into the staging table.
  UPDATE _incoming i
     SET pid = pl.id
    FROM public.players pl
   WHERE pl.school_id = p_school
     AND lower(pl.first_name) = lower(i.first)
     AND lower(pl.last_name)  = lower(i.last);

  -- Upsert roster_entries for this (team, season).
  INSERT INTO public.roster_entries AS r
    (player_id, team_id, season_year, jersey_number, position)
  SELECT
    i.pid,
    p_team,
    p_season,
    CASE WHEN p_has_number   THEN i.number   ELSE NULL END,
    CASE WHEN p_has_position THEN i.position ELSE NULL END
  FROM _incoming i
  WHERE i.pid IS NOT NULL
  ON CONFLICT (team_id, season_year, player_id)
  DO UPDATE SET
    jersey_number = CASE WHEN p_has_number   THEN EXCLUDED.jersey_number ELSE r.jersey_number END,
    position      = CASE WHEN p_has_position THEN EXCLUDED.position      ELSE r.position      END;

  RETURN QUERY
    SELECT i.pid AS player_id, i.first AS first_name, i.last AS last_name
      FROM _incoming i
     WHERE i.pid IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_roster(
  UUID, UUID, SMALLINT, JSONB, BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;
