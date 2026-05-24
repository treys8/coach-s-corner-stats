-- ============================================================================
-- upsert_opponent_players: align ON CONFLICT with the 5-column soft-identity
-- index introduced in 20260519120006_opponent_players_identity_index.sql.
--
-- That migration added COALESCE(external_player_id::text, '__manual__') to the
-- unique index so manual rows and externally-linked copies can coexist. The
-- RPC's ON CONFLICT clause was not updated at the time, so Postgres can no
-- longer match the inference list to any unique constraint and fails with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" the moment a pre-game opposing lineup is saved.
--
-- The resolve UPDATE that maps inserted rows back to their client_ref is
-- widened by the same column for the same reason — two opponent_players rows
-- can now share (school, last, jersey, team) when one is manual and one is
-- external, and we must pick the row we actually upserted.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_opponent_players(
  p_school UUID,
  p_rows   JSONB
)
RETURNS TABLE (
  client_ref          TEXT,
  opponent_player_id  UUID
)
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

  IF NOT (
    public.is_school_admin(p_school)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = p_school AND tm.user_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  CREATE TEMP TABLE _incoming (
    client_ref         TEXT,
    opponent_team_id   UUID,
    external_player_id UUID,
    first_name         TEXT,
    last_name          TEXT,
    jersey_number      TEXT,
    bats               TEXT,
    throws             TEXT,
    grad_year          SMALLINT,
    pid                UUID
  ) ON COMMIT DROP;

  INSERT INTO _incoming (
    client_ref, opponent_team_id, external_player_id,
    first_name, last_name, jersey_number, bats, throws, grad_year
  )
  SELECT
    e->>'client_ref',
    NULLIF(e->>'opponent_team_id', '')::UUID,
    NULLIF(e->>'external_player_id', '')::UUID,
    NULLIF(e->>'first_name', ''),
    NULLIF(e->>'last_name', ''),
    NULLIF(e->>'jersey_number', ''),
    NULLIF(e->>'bats', ''),
    NULLIF(e->>'throws', ''),
    NULLIF(e->>'grad_year', '')::SMALLINT
  FROM jsonb_array_elements(p_rows) e
  WHERE COALESCE(e->>'jersey_number', '') <> ''
     OR COALESCE(e->>'last_name', '') <> '';

  INSERT INTO public.opponent_players AS op (
    school_id, opponent_team_id, external_player_id,
    first_name, last_name, jersey_number, bats, throws, grad_year
  )
  SELECT
    p_school, i.opponent_team_id, i.external_player_id,
    i.first_name, i.last_name, i.jersey_number, i.bats, i.throws, i.grad_year
  FROM _incoming i
  ON CONFLICT (
    school_id,
    lower(COALESCE(last_name, '')),
    COALESCE(jersey_number, ''),
    COALESCE(opponent_team_id::text, '__manual__'),
    COALESCE(external_player_id::text, '__manual__')
  )
  DO UPDATE SET
    first_name         = COALESCE(EXCLUDED.first_name,         op.first_name),
    last_name          = COALESCE(EXCLUDED.last_name,          op.last_name),
    jersey_number      = COALESCE(EXCLUDED.jersey_number,      op.jersey_number),
    bats               = COALESCE(EXCLUDED.bats,               op.bats),
    throws             = COALESCE(EXCLUDED.throws,             op.throws),
    grad_year          = COALESCE(EXCLUDED.grad_year,          op.grad_year),
    external_player_id = COALESCE(EXCLUDED.external_player_id, op.external_player_id),
    updated_at         = now();

  UPDATE _incoming i
     SET pid = op.id
    FROM public.opponent_players op
   WHERE op.school_id = p_school
     AND lower(COALESCE(op.last_name, '')) = lower(COALESCE(i.last_name, ''))
     AND COALESCE(op.jersey_number, '') = COALESCE(i.jersey_number, '')
     AND COALESCE(op.opponent_team_id::text, '__manual__') = COALESCE(i.opponent_team_id::text, '__manual__')
     AND COALESCE(op.external_player_id::text, '__manual__') = COALESCE(i.external_player_id::text, '__manual__');

  RETURN QUERY
    SELECT i.client_ref, i.pid
      FROM _incoming i
     WHERE i.pid IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_opponent_players(UUID, JSONB) TO authenticated;
