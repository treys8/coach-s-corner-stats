-- ============================================================================
-- recognize_opponent_team — cross-tenant team lookup for schedule entries.
--
-- Given freeform opponent text (e.g. "Lamar"), find Statly teams in OTHER
-- schools that match the name (or short_name), case-insensitive, with the
-- same sport + level as the caller's team. Excludes schools that have
-- opted out of discovery (`is_discoverable = false`).
--
-- SECURITY DEFINER because the `teams` RLS policy only exposes teams whose
-- school the caller is a member of; we need to surface other schools'
-- public-facing teams for matching. The caller must be authenticated and
-- a member of the team they're scheduling on (we re-assert below).
--
-- Returns 0..N rows. The caller (schedule UI) decides what to do:
--   - 0 → leave games.opponent_team_id NULL
--   - 1 → unambiguous; auto-set opponent_team_id
--   - >1 → ambiguous; show candidate picker
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recognize_opponent_team(
  p_my_team_id   UUID,
  p_opponent_text TEXT
)
RETURNS TABLE (
  team_id     UUID,
  school_id   UUID,
  school_name TEXT,
  short_name  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_my_team   public.teams;
  v_needle    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT * INTO v_my_team FROM public.teams WHERE id = p_my_team_id;
  IF v_my_team.id IS NULL OR NOT public.is_team_member(p_my_team_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_needle := lower(btrim(coalesce(p_opponent_text, '')));
  IF v_needle = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT t.id, s.id, s.name, s.short_name
      FROM public.teams t
      JOIN public.schools s ON s.id = t.school_id
     WHERE t.sport = v_my_team.sport
       AND t.level = v_my_team.level
       AND s.id <> v_my_team.school_id
       AND s.is_discoverable = TRUE
       AND (lower(s.name) = v_needle OR lower(s.short_name) = v_needle);
END;
$$;

GRANT EXECUTE ON FUNCTION public.recognize_opponent_team(UUID, TEXT) TO authenticated;
