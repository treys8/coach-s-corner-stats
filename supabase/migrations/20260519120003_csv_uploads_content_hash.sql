-- Upload idempotency for the stats workbook flow. Without this, a browser
-- retry of the same upload (network blip, refresh after timeout) could
-- silently merge the same stats again. The existing partial unique index on
-- (team_id, upload_date) WHERE filename IS NOT NULL deduped by filename
-- only — re-uploading the same content under a different filename produced
-- duplicate merges.
--
-- Adds `content_hash` (client-supplied SHA-256 of the uploaded buffer) to
-- csv_uploads, and changes the dedup index to (team_id, upload_date,
-- content_hash). The RPC short-circuits when a row with the same triple
-- already exists.

ALTER TABLE public.csv_uploads
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

DROP INDEX IF EXISTS public.csv_uploads_team_date_uniq;

CREATE UNIQUE INDEX csv_uploads_team_date_hash_uniq
  ON public.csv_uploads (team_id, upload_date, content_hash)
  WHERE filename IS NOT NULL AND content_hash IS NOT NULL;

-- Legacy index for rows without content_hash (pre-migration uploads). Keeps
-- the prior filename-based dedup behavior for those rows so a retry of a
-- pre-migration upload still dedupes.
CREATE UNIQUE INDEX csv_uploads_team_date_legacy_uniq
  ON public.csv_uploads (team_id, upload_date)
  WHERE filename IS NOT NULL AND content_hash IS NULL;

-- ---- ingest_stats_workbook — content-hash aware --------------------------

CREATE OR REPLACE FUNCTION public.ingest_stats_workbook(
  p_school        UUID,
  p_team          UUID,
  p_upload_date   DATE,
  p_filename      TEXT,
  p_players       JSONB,
  p_replace       BOOLEAN,
  p_content_hash  TEXT DEFAULT NULL
)
RETURNS TABLE (upload_id UUID, snapshot_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_season_year  SMALLINT;
  v_existing     INT;
  v_upload_id    UUID;
  v_snap_count   INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF p_filename IS NULL OR p_filename = '' THEN
    RAISE EXCEPTION 'filename required';
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

  v_season_year := public.season_year_for(p_upload_date);
  IF CURRENT_DATE > make_date(v_season_year::INT, 5, 31) THEN
    RAISE EXCEPTION 'season % is closed', v_season_year;
  END IF;

  -- Idempotency short-circuit: same (team, date, content) was already
  -- ingested. Return the prior upload row so the client can render a
  -- "this upload is already on file" message. Skip the entire ingest
  -- path; nothing to do.
  IF p_content_hash IS NOT NULL AND p_content_hash <> '' THEN
    SELECT u.id, COALESCE(u.player_count, 0)
      INTO v_upload_id, v_snap_count
      FROM public.csv_uploads u
     WHERE u.team_id      = p_team
       AND u.upload_date  = p_upload_date
       AND u.content_hash = p_content_hash;
    IF v_upload_id IS NOT NULL THEN
      RETURN QUERY SELECT v_upload_id, v_snap_count;
      RETURN;
    END IF;
  END IF;

  IF NOT p_replace THEN
    SELECT count(*) INTO v_existing
      FROM public.stat_snapshots ss
     WHERE ss.team_id     = p_team
       AND ss.upload_date = p_upload_date
       AND ss.source      = 'xlsx'
       AND ss.game_id IS NULL;

    IF v_existing > 0 THEN
      RAISE EXCEPTION 'STATS_OVERWRITE_REQUIRED:%', v_existing;
    END IF;
  END IF;

  -- ---- Player upsert (mirrors upsert_roster, with all has_* flags off) ----

  CREATE TEMP TABLE _incoming (
    first  TEXT NOT NULL,
    last   TEXT NOT NULL,
    stats  JSONB NOT NULL,
    pid    UUID
  ) ON COMMIT DROP;

  INSERT INTO _incoming (first, last, stats)
  SELECT
    e->>'first',
    e->>'last',
    COALESCE(e->'stats', '{}'::jsonb)
  FROM jsonb_array_elements(p_players) e
  WHERE COALESCE(e->>'first', '') <> '' AND COALESCE(e->>'last', '') <> '';

  INSERT INTO public.players AS p (school_id, first_name, last_name)
  SELECT p_school, i.first, i.last
    FROM _incoming i
  ON CONFLICT (school_id, lower(first_name), lower(last_name))
  DO UPDATE SET updated_at = now();

  UPDATE _incoming i
     SET pid = pl.id
    FROM public.players pl
   WHERE pl.school_id = p_school
     AND lower(pl.first_name) = lower(i.first)
     AND lower(pl.last_name)  = lower(i.last);

  INSERT INTO public.roster_entries AS r (player_id, team_id, season_year, jersey_number, position)
  SELECT i.pid, p_team, v_season_year, NULL, NULL
    FROM _incoming i
   WHERE i.pid IS NOT NULL
  ON CONFLICT (team_id, season_year, player_id) DO NOTHING;

  -- ---- csv_uploads audit row --------------------------------------------
  -- Use the hashed unique index when content_hash is provided; otherwise
  -- fall back to the legacy filename-only index for backward compatibility.

  IF p_content_hash IS NOT NULL AND p_content_hash <> '' THEN
    INSERT INTO public.csv_uploads AS u
      (team_id, upload_date, filename, player_count, content_hash)
    VALUES
      (p_team, p_upload_date, p_filename,
       (SELECT count(*)::INT FROM _incoming WHERE pid IS NOT NULL),
       p_content_hash)
    ON CONFLICT (team_id, upload_date, content_hash)
      WHERE filename IS NOT NULL AND content_hash IS NOT NULL
    DO UPDATE SET filename     = EXCLUDED.filename,
                  player_count = EXCLUDED.player_count
    RETURNING id INTO v_upload_id;
  ELSE
    INSERT INTO public.csv_uploads AS u
      (team_id, upload_date, filename, player_count)
    VALUES (p_team, p_upload_date, p_filename,
       (SELECT count(*)::INT FROM _incoming WHERE pid IS NOT NULL))
    ON CONFLICT (team_id, upload_date)
      WHERE filename IS NOT NULL AND content_hash IS NULL
    DO UPDATE SET filename     = EXCLUDED.filename,
                  player_count = EXCLUDED.player_count
    RETURNING id INTO v_upload_id;
  END IF;

  -- ---- stat_snapshots upsert --------------------------------------------

  INSERT INTO public.stat_snapshots AS s
    (team_id, player_id, upload_date, upload_id, stats, source, game_id)
  SELECT p_team, i.pid, p_upload_date, v_upload_id, i.stats, 'xlsx', NULL
    FROM _incoming i
   WHERE i.pid IS NOT NULL
  ON CONFLICT (team_id, player_id, upload_date, game_id)
  DO UPDATE SET stats     = EXCLUDED.stats,
                upload_id = EXCLUDED.upload_id,
                source    = 'xlsx';

  GET DIAGNOSTICS v_snap_count = ROW_COUNT;

  RETURN QUERY SELECT v_upload_id, v_snap_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ingest_stats_workbook(
  UUID, UUID, DATE, TEXT, JSONB, BOOLEAN, TEXT
) TO authenticated;

-- Drop the 6-arg signature now that the 7-arg one is the canonical entry
-- point. Keeping both would let stale clients call the un-hashed path; we
-- want every upload to carry a hash.
DROP FUNCTION IF EXISTS public.ingest_stats_workbook(UUID, UUID, DATE, TEXT, JSONB, BOOLEAN);
