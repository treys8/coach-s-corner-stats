-- Public scores rollout — Step 8: soft re-link prompt for free-text opponents.
-- See docs/public-scores-architecture.md.
--
-- When a school joins Statly, historical games on other coaches' schedules
-- entered with the matching free-text opponent can be retroactively linked.
-- Two helper RPCs:
--
--   find_relink_suggestions(p_team_id) — list of (game, candidate team)
--     pairs where the caller's free-text opponent matches a discoverable
--     school. Cheap to call on schedule load; returns nothing when there's
--     no work to do.
--
--   apply_relink(p_game_ids, p_target_team_id) — sets opponent_team_id on
--     the named games after the coach approves. The cross-account game
--     pairing (game_links) still requires the opposing coach to confirm
--     separately via the existing flow.
--
-- Matching is conservative (case-insensitive equality on school name or
-- short_name). Fuzzier matching is deferred until usage shows it's needed —
-- a false positive here silently rewrites a coach's data, so caution wins.
-- Sport equivalence is enforced so a baseball game can't suggest a softball
-- team at the same school.

CREATE OR REPLACE FUNCTION public.find_relink_suggestions(p_team_id UUID)
RETURNS TABLE (
  game_id                     UUID,
  game_date                   DATE,
  game_time                   TIME,
  opponent_text               TEXT,
  candidate_school_id         UUID,
  candidate_school_name       TEXT,
  candidate_school_short_name TEXT,
  candidate_team_id           UUID,
  candidate_team_name         TEXT,
  candidate_team_level        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sport TEXT;
BEGIN
  IF NOT public.is_team_member(p_team_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT sport::text INTO v_sport FROM public.teams WHERE id = p_team_id;
  IF v_sport IS NULL THEN
    RAISE EXCEPTION 'team not found';
  END IF;

  RETURN QUERY
    SELECT
      g.id,
      g.game_date,
      g.game_time,
      g.opponent,
      s.id,
      s.name,
      s.short_name,
      t.id,
      t.name,
      t.level::text
    FROM public.games g
    JOIN public.schools s
      ON s.is_discoverable = TRUE
     AND (
          lower(s.name) = lower(g.opponent)
       OR (s.short_name IS NOT NULL AND lower(s.short_name) = lower(g.opponent))
     )
    JOIN public.teams t
      ON t.school_id = s.id
     AND t.sport::text = v_sport
     AND t.id <> p_team_id
    WHERE g.team_id = p_team_id
      AND g.opponent_team_id IS NULL
    ORDER BY g.game_date DESC, s.name, t.level;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_relink_suggestions(UUID) TO authenticated;

-- Applies a relink to a set of games. Authorization: caller must be a team
-- member of EVERY game's team (paranoid: in practice they all share p_team_id
-- from the suggestions RPC, but the UI could send a forged list).
CREATE OR REPLACE FUNCTION public.apply_relink(
  p_game_ids        UUID[],
  p_target_team_id  UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target  public.teams;
  v_count   INTEGER;
  v_unauthorized INTEGER;
BEGIN
  IF p_game_ids IS NULL OR array_length(p_game_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_target FROM public.teams WHERE id = p_target_team_id;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'target team not found';
  END IF;

  -- Caller must own every game in the list.
  SELECT COUNT(*) INTO v_unauthorized
  FROM public.games g
  WHERE g.id = ANY (p_game_ids)
    AND NOT public.is_team_member(g.team_id);
  IF v_unauthorized > 0 THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Sport equivalence (defense in depth — the suggestions RPC already filters).
  IF EXISTS (
    SELECT 1
    FROM public.games g
    JOIN public.teams mt ON mt.id = g.team_id
    WHERE g.id = ANY (p_game_ids)
      AND mt.sport <> v_target.sport
  ) THEN
    RAISE EXCEPTION 'sport mismatch';
  END IF;

  UPDATE public.games
    SET opponent_team_id = p_target_team_id
    WHERE id = ANY (p_game_ids)
      AND opponent_team_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_relink(UUID[], UUID) TO authenticated;
