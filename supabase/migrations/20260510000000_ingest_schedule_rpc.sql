-- Atomic schedule import. Mirrors ingest_stats_workbook (20260509130000) for
-- gating + transactional shape. Used by /upload/schedule.
--
-- p_games is a JSONB array; each element:
--   { game_date, game_time?, opponent, opponent_team_id?, location,
--     is_home, game_sequence?, notes? }
--
-- p_on_conflict is forced by the client (no default — the UI requires the user
-- to pick) and accepts:
--   'error'   — abort with code SCHED_CONFLICTS:<count> if any (team, date,
--               sequence) already exists; nothing is written.
--   'skip'    — keep existing rows untouched; insert only the new ones.
--   'replace' — UPDATE existing rows in place with the incoming values.
--
-- The conflict key is (team_id, game_date, game_sequence). Doubleheader leg 1
-- and leg 2 are treated as independent rows for conflict purposes.
--
-- Conflict detection is done explicitly with a JOIN (not via a unique
-- constraint + ON CONFLICT). The legacy games table never had a unique
-- index on this triple, and adding one retroactively could fail on schools
-- that already inserted two rows for a doubleheader date before the
-- public-scores rollout introduced the game_sequence column. Manual handling
-- avoids that risk.
--
-- Returns a single (inserted, updated, skipped, conflict_dates) tuple.

CREATE OR REPLACE FUNCTION public.ingest_schedule(
  p_school      UUID,
  p_team        UUID,
  p_games       JSONB,
  p_on_conflict TEXT
)
RETURNS TABLE (inserted INT, updated INT, skipped INT, conflict_dates DATE[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_inserted  INT := 0;
  v_updated   INT := 0;
  v_skipped   INT := 0;
  v_conflict_count INT := 0;
  v_conflicts DATE[] := '{}';
  v_min_year  SMALLINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF p_on_conflict NOT IN ('error', 'skip', 'replace') THEN
    RAISE EXCEPTION 'invalid p_on_conflict (%): must be error|skip|replace', p_on_conflict;
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

  -- Stage incoming rows. Filter out malformed entries server-side (defence in
  -- depth — the client preview already validates).
  CREATE TEMP TABLE _incoming (
    game_date        DATE,
    game_time        TIME,
    opponent         TEXT,
    opponent_team_id UUID,
    location         TEXT,
    is_home          BOOLEAN,
    game_sequence    SMALLINT,
    notes            TEXT,
    has_conflict     BOOLEAN DEFAULT FALSE
  ) ON COMMIT DROP;

  INSERT INTO _incoming (
    game_date, game_time, opponent, opponent_team_id,
    location, is_home, game_sequence, notes
  )
  SELECT
    (e->>'game_date')::DATE,
    NULLIF(e->>'game_time','')::TIME,
    btrim(e->>'opponent'),
    NULLIF(e->>'opponent_team_id','')::UUID,
    e->>'location',
    (e->>'is_home')::BOOLEAN,
    COALESCE((e->>'game_sequence')::SMALLINT, 1),
    NULLIF(btrim(e->>'notes'), '')
  FROM jsonb_array_elements(p_games) e
  WHERE e->>'game_date' IS NOT NULL
    AND COALESCE(btrim(e->>'opponent'), '') <> '';

  -- Mirror the games-table CHECKs so bad input fails fast with a clear msg.
  IF EXISTS (SELECT 1 FROM _incoming WHERE location NOT IN ('home','away','neutral')) THEN
    RAISE EXCEPTION 'invalid location (must be home|away|neutral)';
  END IF;
  IF EXISTS (SELECT 1 FROM _incoming WHERE game_sequence NOT BETWEEN 1 AND 2) THEN
    RAISE EXCEPTION 'invalid game_sequence (must be 1 or 2)';
  END IF;

  -- Closed-season check on the earliest incoming date. Earlier years are also
  -- closed if that one is. Matches isSeasonClosed in src/lib/season.ts.
  SELECT min(public.season_year_for(game_date)) INTO v_min_year FROM _incoming;
  IF v_min_year IS NOT NULL AND CURRENT_DATE > make_date(v_min_year::INT, 5, 31) THEN
    RAISE EXCEPTION 'season % is closed', v_min_year;
  END IF;

  -- Mark which incoming rows already have a matching existing game.
  UPDATE _incoming i
     SET has_conflict = TRUE
    FROM public.games g
   WHERE g.team_id       = p_team
     AND g.game_date     = i.game_date
     AND g.game_sequence = i.game_sequence;

  SELECT count(*) FILTER (WHERE has_conflict),
         COALESCE(array_agg(DISTINCT game_date ORDER BY game_date)
                  FILTER (WHERE has_conflict), '{}')
    INTO v_conflict_count, v_conflicts
    FROM _incoming;

  IF p_on_conflict = 'error' AND v_conflict_count > 0 THEN
    -- Stable prefix the client matches on. The count is the number of conflict
    -- rows, not just distinct dates (two doubleheader legs = two conflicts).
    RAISE EXCEPTION 'SCHED_CONFLICTS:%', v_conflict_count;
  END IF;

  -- Replace path: UPDATE the existing rows that conflict.
  IF p_on_conflict = 'replace' AND v_conflict_count > 0 THEN
    WITH upd AS (
      UPDATE public.games g
         SET game_time        = i.game_time,
             opponent         = i.opponent,
             opponent_team_id = i.opponent_team_id,
             location         = i.location,
             is_home          = i.is_home,
             notes            = i.notes
        FROM _incoming i
       WHERE g.team_id       = p_team
         AND g.game_date     = i.game_date
         AND g.game_sequence = i.game_sequence
         AND i.has_conflict
      RETURNING 1
    )
    SELECT count(*) INTO v_updated FROM upd;
  END IF;

  -- Insert path: rows without a conflict get inserted regardless of mode.
  WITH ins AS (
    INSERT INTO public.games (
      team_id, game_date, game_time, opponent, opponent_team_id,
      location, is_home, game_sequence, notes
    )
    SELECT p_team, i.game_date, i.game_time, i.opponent, i.opponent_team_id,
           i.location, i.is_home, i.game_sequence, i.notes
      FROM _incoming i
     WHERE NOT i.has_conflict
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  -- Skipped count = rows that conflicted but weren't replaced.
  IF p_on_conflict = 'skip' THEN
    v_skipped := v_conflict_count;
  END IF;

  RETURN QUERY SELECT v_inserted, v_updated, v_skipped, v_conflicts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ingest_schedule(UUID, UUID, JSONB, TEXT) TO authenticated;
