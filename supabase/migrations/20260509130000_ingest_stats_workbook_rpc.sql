-- Atomic stats-workbook ingestion. Replaces a 3-step JS dance (upsert_roster
-- RPC → csv_uploads insert → stat_snapshots upsert) that had no rollback —
-- a snapshot insert error left orphan csv_uploads rows and committed any
-- typo'd player names from the roster step. Now one transaction.
--
-- Also tightens the surrounding constraints:
--   * stat_snapshots.upload_id was a bare UUID; now FK → csv_uploads(id) ON
--     DELETE SET NULL so deleting an audit row no longer leaves dangling refs.
--   * csv_uploads gets a partial unique index on (team_id, upload_date) where
--     filename IS NOT NULL so retries don't pile up duplicate audit rows.
--
-- The RPC mirrors public.upsert_roster (20260508230000):
--   * SECURITY DEFINER so RLS doesn't prevent it from updating the tables it
--     gates manually.
--   * Re-asserts the same membership check the table policies use.
--   * Hard-codes p_has_number=false / p_has_position=false / p_has_grad_year=false
--     for the player upsert — stats workbooks must never overwrite jersey or
--     position values set via the dedicated roster upload.
--
-- p_replace=false makes the RPC raise an exception (SQLSTATE 'STATS') when an
-- xlsx snapshot already exists for (team, upload_date). The client converts
-- that into a confirm dialog and retries with p_replace=true.

-- ---- Pre-flight: tighten constraints ---------------------------------------

-- The FK is safe: existing rows either have NULL upload_id (tablet-sourced) or
-- a uuid that points at a still-existing csv_uploads row (xlsx-sourced via
-- the prior 3-step flow that always created the audit row first).
ALTER TABLE public.stat_snapshots
  ADD CONSTRAINT stat_snapshots_upload_id_fkey
  FOREIGN KEY (upload_id) REFERENCES public.csv_uploads(id) ON DELETE SET NULL;

-- Dedupe retries of the same upload (same team, same date, with a filename).
-- NULL filename rows (legacy / non-xlsx audit) are not deduped.
CREATE UNIQUE INDEX csv_uploads_team_date_uniq
  ON public.csv_uploads (team_id, upload_date)
  WHERE filename IS NOT NULL;

-- ---- ingest_stats_workbook --------------------------------------------------

CREATE OR REPLACE FUNCTION public.ingest_stats_workbook(
  p_school      UUID,
  p_team        UUID,
  p_upload_date DATE,
  p_filename    TEXT,
  p_players     JSONB,
  p_replace     BOOLEAN
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

  -- Required so the csv_uploads upsert below (which infers the partial unique
  -- index `csv_uploads_team_date_uniq WHERE filename IS NOT NULL`) actually
  -- dedupes on retry. A NULL filename would silently bypass the constraint.
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

  -- Server-side season-closed check. Defence in depth: the client also checks,
  -- but a bad client could otherwise sneak past. A season "closes" on May 31
  -- of its calendar year (matches isSeasonClosed in src/lib/season.ts).
  v_season_year := public.season_year_for(p_upload_date);
  IF CURRENT_DATE > make_date(v_season_year::INT, 5, 31) THEN
    RAISE EXCEPTION 'season % is closed', v_season_year;
  END IF;

  -- Overwrite gate. Raises SQLSTATE 'P0001' (default) with stable message
  -- prefix the client matches on.
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

  -- Roster entries (this season) are upserted with neither jersey nor position
  -- so existing roster-upload values survive intact. We still want a roster
  -- row to exist so the roster page lists the player.
  INSERT INTO public.roster_entries AS r (player_id, team_id, season_year, jersey_number, position)
  SELECT i.pid, p_team, v_season_year, NULL, NULL
    FROM _incoming i
   WHERE i.pid IS NOT NULL
  ON CONFLICT (team_id, season_year, player_id) DO NOTHING;

  -- ---- csv_uploads audit row --------------------------------------------

  -- Upsert by the partial unique index so retries are idempotent.
  INSERT INTO public.csv_uploads AS u (team_id, upload_date, filename, player_count)
  VALUES (p_team, p_upload_date, p_filename, (SELECT count(*)::INT FROM _incoming WHERE pid IS NOT NULL))
  ON CONFLICT (team_id, upload_date) WHERE filename IS NOT NULL
  DO UPDATE SET filename     = EXCLUDED.filename,
                player_count = EXCLUDED.player_count
  RETURNING id INTO v_upload_id;

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
  UUID, UUID, DATE, TEXT, JSONB, BOOLEAN
) TO authenticated;
