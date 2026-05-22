-- ============================================================================
-- Player grade: per-season school-year level (7th, 8th, Freshman, Sophomore,
-- Junior, Senior). Lives on roster_entries because a player's grade changes
-- each season; the players table's `grad_year` is the permanent 4-digit
-- graduation year and is a distinct concept.
--
-- Companion changes:
--   * upsert_roster gains p_has_grade (column-presence semantics, mirrors
--     p_has_number / p_has_position / p_has_grad_year).
--   * archive_team_season_with_rollover: atomic season-end flow that inserts
--     next-season roster_entries with advanced grades AND locks the closing
--     season in one transaction. Existing archive_team_season is preserved
--     for callers that don't roll the roster forward.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enum: school-year level. Order matches the natural advance order, so a
-- future "next grade by ordering" query is straightforward if we want it.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.player_grade AS ENUM (
    '7th', '8th', 'Freshman', 'Sophomore', 'Junior', 'Senior'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Nullable: existing roster_entries pre-date this column and the UI nags
-- coaches to backfill. New entries inserted by upsert_roster / inline edit
-- will set it.
ALTER TABLE public.roster_entries
  ADD COLUMN IF NOT EXISTS grade public.player_grade;

-- ----------------------------------------------------------------------------
-- Replace upsert_roster to accept p_has_grade. Drop-and-recreate because the
-- parameter list is part of the function identity and ON CONFLICT DO UPDATE
-- needs the new column included.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_roster(
  UUID, UUID, SMALLINT, JSONB, BOOLEAN, BOOLEAN, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.upsert_roster(
  p_school        UUID,
  p_team          UUID,
  p_season        SMALLINT,
  p_players       JSONB,
  p_has_number    BOOLEAN,
  p_has_position  BOOLEAN,
  p_has_grad_year BOOLEAN,
  p_has_grade     BOOLEAN
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
    grade      public.player_grade,
    pid        UUID
  ) ON COMMIT DROP;

  INSERT INTO _incoming (first, last, number, position, grad_year, grade)
  SELECT
    e->>'first',
    e->>'last',
    NULLIF(e->>'number', ''),
    NULLIF(e->>'position', ''),
    NULLIF(e->>'grad_year', '')::SMALLINT,
    NULLIF(e->>'grade', '')::public.player_grade
  FROM jsonb_array_elements(p_players) e
  WHERE COALESCE(e->>'first', '') <> '' AND COALESCE(e->>'last', '') <> '';

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

  UPDATE _incoming i
     SET pid = pl.id
    FROM public.players pl
   WHERE pl.school_id = p_school
     AND lower(pl.first_name) = lower(i.first)
     AND lower(pl.last_name)  = lower(i.last);

  INSERT INTO public.roster_entries AS r
    (player_id, team_id, season_year, jersey_number, position, grade)
  SELECT
    i.pid,
    p_team,
    p_season,
    CASE WHEN p_has_number   THEN i.number   ELSE NULL END,
    CASE WHEN p_has_position THEN i.position ELSE NULL END,
    CASE WHEN p_has_grade    THEN i.grade    ELSE NULL END
  FROM _incoming i
  WHERE i.pid IS NOT NULL
  ON CONFLICT (team_id, season_year, player_id)
  DO UPDATE SET
    jersey_number = CASE WHEN p_has_number   THEN EXCLUDED.jersey_number ELSE r.jersey_number END,
    position      = CASE WHEN p_has_position THEN EXCLUDED.position      ELSE r.position      END,
    grade         = CASE WHEN p_has_grade    THEN EXCLUDED.grade         ELSE r.grade         END;

  RETURN QUERY
    SELECT i.pid AS player_id, i.first AS first_name, i.last AS last_name
      FROM _incoming i
     WHERE i.pid IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_roster(
  UUID, UUID, SMALLINT, JSONB, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;

-- ----------------------------------------------------------------------------
-- Inline grade setter: lets the team roster page write a single player's
-- grade without re-uploading the whole roster file. Constrained to the
-- caller's team membership AND to seasons that aren't locked.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_roster_entry_grade(
  p_team_id     UUID,
  p_season_year SMALLINT,
  p_player_id   UUID,
  p_grade       public.player_grade
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_team_member(p_team_id) THEN
    RAISE EXCEPTION 'forbidden: not a team member' USING ERRCODE = '42501';
  END IF;
  IF public.is_team_season_manually_locked(p_team_id, p_season_year) THEN
    RAISE EXCEPTION 'season % is archived for this team', p_season_year
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.roster_entries
     SET grade = p_grade
   WHERE team_id = p_team_id
     AND season_year = p_season_year
     AND player_id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no roster entry for player % on team % in %',
      p_player_id, p_team_id, p_season_year;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_roster_entry_grade(UUID, SMALLINT, UUID, public.player_grade) FROM public;
GRANT EXECUTE ON FUNCTION public.set_roster_entry_grade(UUID, SMALLINT, UUID, public.player_grade) TO authenticated;

-- ----------------------------------------------------------------------------
-- archive_team_season_with_rollover: end the season AND seed next season's
-- roster in one transaction. The dialog computes the proposed advances on
-- the client (with coach overrides), then sends them here.
--
-- p_rollover JSONB shape: [{ "player_id": uuid, "next_grade": player_grade }]
-- Players omitted from the array — or with next_grade = null — are NOT added
-- to the next season's roster (graduated, cut, transferred, etc.).
--
-- Guards: every player_id must already be a roster_entry for (p_team_id,
-- p_season_year). Prevents the client from smuggling arbitrary players into
-- next season.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_team_season_with_rollover(
  p_team_id     UUID,
  p_season_year SMALLINT,
  p_rollover    JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_season SMALLINT := p_season_year + 1;
BEGIN
  IF NOT public.is_team_member(p_team_id) THEN
    RAISE EXCEPTION 'forbidden: not a team member' USING ERRCODE = '42501';
  END IF;

  -- Materialize the rollover payload so we can validate + insert from it.
  CREATE TEMP TABLE _rollover (
    player_id  UUID NOT NULL,
    next_grade public.player_grade
  ) ON COMMIT DROP;

  INSERT INTO _rollover (player_id, next_grade)
  SELECT
    (e->>'player_id')::UUID,
    NULLIF(e->>'next_grade', '')::public.player_grade
  FROM jsonb_array_elements(COALESCE(p_rollover, '[]'::JSONB)) e
  WHERE COALESCE(e->>'player_id', '') <> '';

  -- Reject any rollover player that wasn't actually on this team's closing
  -- roster — prevents arbitrary inserts via this RPC.
  IF EXISTS (
    SELECT 1 FROM _rollover ro
    WHERE NOT EXISTS (
      SELECT 1 FROM public.roster_entries re
      WHERE re.team_id = p_team_id
        AND re.season_year = p_season_year
        AND re.player_id = ro.player_id
    )
  ) THEN
    RAISE EXCEPTION 'rollover contains a player not on the % roster', p_season_year
      USING ERRCODE = '22023';
  END IF;

  -- Insert next-season rows for players whose next_grade is non-null. Don't
  -- copy jersey or position — coach assigns fresh next season.
  INSERT INTO public.roster_entries AS r
    (player_id, team_id, season_year, grade)
  SELECT ro.player_id, p_team_id, v_next_season, ro.next_grade
  FROM _rollover ro
  WHERE ro.next_grade IS NOT NULL
  ON CONFLICT (team_id, season_year, player_id)
  DO UPDATE SET grade = EXCLUDED.grade;

  -- Finally, lock the closing season. Same insert as archive_team_season().
  INSERT INTO public.season_locks (team_id, season_year, locked_by)
  VALUES (p_team_id, p_season_year, auth.uid())
  ON CONFLICT (team_id, season_year) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_team_season_with_rollover(UUID, SMALLINT, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.archive_team_season_with_rollover(UUID, SMALLINT, JSONB) TO authenticated;
