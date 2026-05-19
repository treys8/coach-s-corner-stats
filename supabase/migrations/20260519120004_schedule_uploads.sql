-- Upload idempotency for the schedule CSV flow. Without an audit table, a
-- second commit of the same file inserts duplicate games whenever the first
-- pass already replaced its conflicts (post-replace, the next pass finds
-- no conflicts and inserts fresh rows).
--
-- Adds `schedule_uploads` keyed on (team_id, content_hash). The RPC
-- short-circuits when the same hash is seen again, returning a synthetic
-- result snapshot so the client can display "this upload is already on
-- file" rather than mutating games again.

CREATE TABLE public.schedule_uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  content_hash  TEXT NOT NULL,
  on_conflict_mode TEXT NOT NULL CHECK (on_conflict_mode IN ('error','skip','replace')),
  inserted      INT NOT NULL,
  updated       INT NOT NULL,
  skipped       INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (team_id, content_hash)
);

CREATE INDEX schedule_uploads_team_idx
  ON public.schedule_uploads (team_id, created_at DESC);

ALTER TABLE public.schedule_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule_uploads by team member" ON public.schedule_uploads
  FOR ALL USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

-- ---- ingest_schedule — content-hash aware --------------------------------

CREATE OR REPLACE FUNCTION public.ingest_schedule(
  p_school        UUID,
  p_team          UUID,
  p_games         JSONB,
  p_on_conflict   TEXT,
  p_content_hash  TEXT DEFAULT NULL
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
  v_prior     public.schedule_uploads%ROWTYPE;
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

  -- Idempotency short-circuit. Same (team, hash) was already imported;
  -- return the prior counts so the client can render "already on file".
  IF p_content_hash IS NOT NULL AND p_content_hash <> '' THEN
    SELECT * INTO v_prior
      FROM public.schedule_uploads
     WHERE team_id = p_team
       AND content_hash = p_content_hash;
    IF FOUND THEN
      RETURN QUERY SELECT v_prior.inserted, v_prior.updated, v_prior.skipped, '{}'::DATE[];
      RETURN;
    END IF;
  END IF;

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

  IF EXISTS (SELECT 1 FROM _incoming WHERE location NOT IN ('home','away','neutral')) THEN
    RAISE EXCEPTION 'invalid location (must be home|away|neutral)';
  END IF;
  IF EXISTS (SELECT 1 FROM _incoming WHERE game_sequence NOT BETWEEN 1 AND 2) THEN
    RAISE EXCEPTION 'invalid game_sequence (must be 1 or 2)';
  END IF;

  SELECT min(public.season_year_for(game_date)) INTO v_min_year FROM _incoming;
  IF v_min_year IS NOT NULL AND CURRENT_DATE > make_date(v_min_year::INT, 5, 31) THEN
    RAISE EXCEPTION 'season % is closed', v_min_year;
  END IF;

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
    RAISE EXCEPTION 'SCHED_CONFLICTS:%', v_conflict_count;
  END IF;

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

  IF p_on_conflict = 'skip' THEN
    v_skipped := v_conflict_count;
  END IF;

  -- Record this upload so a retry with the same hash short-circuits above.
  IF p_content_hash IS NOT NULL AND p_content_hash <> '' THEN
    INSERT INTO public.schedule_uploads
      (team_id, content_hash, on_conflict_mode, inserted, updated, skipped, created_by)
    VALUES
      (p_team, p_content_hash, p_on_conflict, v_inserted, v_updated, v_skipped, v_uid)
    ON CONFLICT (team_id, content_hash) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_inserted, v_updated, v_skipped, v_conflicts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ingest_schedule(UUID, UUID, JSONB, TEXT, TEXT) TO authenticated;

-- Drop the prior 4-arg signature so every call carries a content_hash.
DROP FUNCTION IF EXISTS public.ingest_schedule(UUID, UUID, JSONB, TEXT);
