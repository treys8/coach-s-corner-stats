-- Stronger player identity key. The previous `lower(first) / lower(last)`
-- functional unique index only caught casing. Whitespace, copy-paste artifacts,
-- straight-vs-curly apostrophes, NFKC-equivalent characters, and trailing
-- punctuation all still forked players, so a coach pasting "Smith " into one
-- upload and "Smith" into the next would create two ids and split the season's
-- stats across them.
--
-- This migration:
--   1. Adds a SQL function normalize_player_name(text) that lowers, NFKC-
--      normalizes, strips quotes/apostrophes, collapses internal whitespace,
--      and trims leading/trailing space + trailing dots/commas. IMMUTABLE so
--      it can drive a functional unique index.
--   2. Pre-merges any duplicate players the stronger key surfaces, mirroring
--      the dedup recipe from 20260508220000 (pre-delete the rows whose UPDATE
--      would collide on roster_entries' and stat_snapshots' own uniques, then
--      repoint every player FK, then delete the loser players). Also handles
--      opponent_players.external_player_id, added 2026-05-12 after the prior
--      dedup migration ran.
--   3. Drops the lower(...) unique index and creates the normalize_player_name
--      one in its place.
--   4. Replaces ingest_stats_workbook and upsert_roster so their ON CONFLICT
--      target and _incoming pid-resolution UPDATE both use the new key.
--
-- Per CLAUDE auto-memory [[migration_deployment_workflow]] this is applied by
-- pasting into the Dashboard SQL Editor — not via `supabase db push`. The
-- team's drop-and-recreate deploy style means we don't need to worry about
-- online-migration concerns (no CONCURRENTLY etc.).

-- ---- normalize_player_name --------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_player_name(name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  -- Canonical key for player-name identity matching. Returns NULL on NULL
  -- input (STRICT). Steps:
  --   1. NFKC unicode fold ("Ｊａｎｅ" → "Jane", "ﬁ" → "fi")
  --   2. lowercase
  --   3. strip straight/curly apostrophes and quote marks ("O'Brien" =
  --      "obrien" = "OBrien"); chosen because coaches inconsistently type
  --      apostrophes and we'd rather over-merge than fork.
  --   4. collapse runs of whitespace (incl. tabs/newlines) to a single space
  --   5. btrim leading/trailing space + trailing ".", "," so "Bobby Jr." and
  --      "Bobby Jr" key the same.
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        lower(normalize(name, NFKC)),
        '[''"`’ʼ‘”“]', '', 'g'
      ),
      '\s+', ' ', 'g'
    ),
    E' \t\n.,'
  );
$$;

COMMENT ON FUNCTION public.normalize_player_name(TEXT) IS
  'Canonical key for player-name identity matching. Used by the players functional unique index and by the upsert_roster / ingest_stats_workbook RPCs.';

-- ---- Dedup -----------------------------------------------------------------

DO $$
DECLARE dup RECORD;
BEGIN
  FOR dup IN
    WITH ranked AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY school_id,
                       public.normalize_player_name(first_name),
                       public.normalize_player_name(last_name)
          ORDER BY created_at, id
        ) AS rn,
        first_value(id) OVER (
          PARTITION BY school_id,
                       public.normalize_player_name(first_name),
                       public.normalize_player_name(last_name)
          ORDER BY created_at, id
        ) AS keep_id
      FROM public.players
    )
    SELECT id AS dup_id, keep_id FROM ranked WHERE rn > 1
  LOOP
    -- roster_entries: pre-delete loser rows that would collide on the
    -- (team_id, season_year, player_id) unique when we repoint to the keeper.
    DELETE FROM public.roster_entries re
     WHERE re.player_id = dup.dup_id
       AND EXISTS (
         SELECT 1 FROM public.roster_entries kre
          WHERE kre.player_id   = dup.keep_id
            AND kre.team_id     = re.team_id
            AND kre.season_year = re.season_year
       );

    -- stat_snapshots: same idea, pre-delete losers that would collide on
    -- (team_id, player_id, upload_date, game_id).
    DELETE FROM public.stat_snapshots ss
     WHERE ss.player_id = dup.dup_id
       AND EXISTS (
         SELECT 1 FROM public.stat_snapshots kss
          WHERE kss.player_id   = dup.keep_id
            AND kss.team_id     = ss.team_id
            AND kss.upload_date = ss.upload_date
            AND kss.game_id IS NOT DISTINCT FROM ss.game_id
       );

    UPDATE public.roster_entries   SET player_id          = dup.keep_id WHERE player_id          = dup.dup_id;
    UPDATE public.stat_snapshots   SET player_id          = dup.keep_id WHERE player_id          = dup.dup_id;
    UPDATE public.at_bats          SET batter_id          = dup.keep_id WHERE batter_id          = dup.dup_id;
    UPDATE public.at_bats          SET pitcher_id         = dup.keep_id WHERE pitcher_id         = dup.dup_id;
    UPDATE public.game_live_state  SET runner_first       = dup.keep_id WHERE runner_first       = dup.dup_id;
    UPDATE public.game_live_state  SET runner_second      = dup.keep_id WHERE runner_second      = dup.dup_id;
    UPDATE public.game_live_state  SET runner_third       = dup.keep_id WHERE runner_third       = dup.dup_id;
    UPDATE public.opponent_players SET external_player_id = dup.keep_id WHERE external_player_id = dup.dup_id;

    DELETE FROM public.players WHERE id = dup.dup_id;
  END LOOP;
END $$;

-- ---- Swap the unique index --------------------------------------------------

DROP INDEX IF EXISTS public.players_school_lower_name_uniq;

CREATE UNIQUE INDEX players_school_normalized_name_uniq
  ON public.players (
    school_id,
    public.normalize_player_name(first_name),
    public.normalize_player_name(last_name)
  );

-- ---- Update RPCs to use the new key ----------------------------------------

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

  INSERT INTO public.players AS p (school_id, first_name, last_name, grad_year)
  SELECT
    p_school,
    i.first,
    i.last,
    CASE WHEN p_has_grad_year THEN i.grad_year ELSE NULL END
  FROM _incoming i
  ON CONFLICT (school_id, public.normalize_player_name(first_name), public.normalize_player_name(last_name))
  DO UPDATE SET
    grad_year  = CASE WHEN p_has_grad_year THEN EXCLUDED.grad_year ELSE p.grad_year END,
    updated_at = now();

  UPDATE _incoming i
     SET pid = pl.id
    FROM public.players pl
   WHERE pl.school_id = p_school
     AND public.normalize_player_name(pl.first_name) = public.normalize_player_name(i.first)
     AND public.normalize_player_name(pl.last_name)  = public.normalize_player_name(i.last);

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
  ON CONFLICT (school_id, public.normalize_player_name(first_name), public.normalize_player_name(last_name))
  DO UPDATE SET updated_at = now();

  UPDATE _incoming i
     SET pid = pl.id
    FROM public.players pl
   WHERE pl.school_id = p_school
     AND public.normalize_player_name(pl.first_name) = public.normalize_player_name(i.first)
     AND public.normalize_player_name(pl.last_name)  = public.normalize_player_name(i.last);

  INSERT INTO public.roster_entries AS r (player_id, team_id, season_year, jersey_number, position)
  SELECT i.pid, p_team, v_season_year, NULL, NULL
    FROM _incoming i
   WHERE i.pid IS NOT NULL
  ON CONFLICT (team_id, season_year, player_id) DO NOTHING;

  INSERT INTO public.csv_uploads AS u (team_id, upload_date, filename, player_count)
  VALUES (p_team, p_upload_date, p_filename, (SELECT count(*)::INT FROM _incoming WHERE pid IS NOT NULL))
  ON CONFLICT (team_id, upload_date) WHERE filename IS NOT NULL
  DO UPDATE SET filename     = EXCLUDED.filename,
                player_count = EXCLUDED.player_count
  RETURNING id INTO v_upload_id;

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

GRANT EXECUTE ON FUNCTION public.normalize_player_name(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_roster(UUID, UUID, SMALLINT, JSONB, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_stats_workbook(UUID, UUID, DATE, TEXT, JSONB, BOOLEAN) TO authenticated;
