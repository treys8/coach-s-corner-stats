-- Public scores rollout — Step 5 (Layer 2): cross-account game linking.
-- See docs/public-scores-architecture.md.
--
-- Adds:
--   - public.game_links             — at most one link per game on either side.
--   - game_match_candidates(uuid)   — RLS bridge so a coach can see candidate
--                                     games on the opposing team's account.
--   - confirm_game_link(uuid, uuid) — only insert path into game_links.
--   - unlink_games(uuid)            — either side's coach can break a link.
--
-- Row writes go exclusively through the SECURITY DEFINER RPCs. The visitor's
-- coach cannot directly INSERT a row that names the home team's game id under
-- normal RLS (they don't own that game), so confirmation has to be a RPC. The
-- candidates RPC exists for the same reason inverted: a coach can't SELECT
-- another school's draft game directly, but the matching flow needs to surface
-- exactly enough metadata (id, date, time, sequence, status, is_home) to drive
-- a confirmation banner — never scores or stats.
--
-- Layer-5 RLS for game_links is included here. score_discrepancies (layer 3)
-- ships in a later step and brings its own RLS.

-- ---------- Table -----------------------------------------------------------

CREATE TABLE public.game_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_game_id    UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  visitor_game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  confirmed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (home_game_id),
  UNIQUE (visitor_game_id)
);

CREATE INDEX game_links_home_idx    ON public.game_links (home_game_id);
CREATE INDEX game_links_visitor_idx ON public.game_links (visitor_game_id);

-- ---------- RLS -------------------------------------------------------------

ALTER TABLE public.game_links ENABLE ROW LEVEL SECURITY;

-- Read: either side's team members. Writes intentionally have no policy —
-- INSERT/DELETE are routed through SECURITY DEFINER RPCs below.
CREATE POLICY "game_links read by either side" ON public.game_links
  FOR SELECT USING (
    public.is_team_member((SELECT team_id FROM public.games WHERE id = home_game_id))
    OR public.is_team_member((SELECT team_id FROM public.games WHERE id = visitor_game_id))
  );

-- ---------- RPCs ------------------------------------------------------------

-- Returns the opposing team's matching games for a date. SECURITY DEFINER so
-- the caller can see across-account drafts (which RLS would otherwise hide),
-- but only after we re-check authorization against their own game.
CREATE OR REPLACE FUNCTION public.game_match_candidates(
  p_my_game_id UUID
) RETURNS TABLE (
  candidate_game_id UUID,
  game_date         DATE,
  game_time         TIME,
  game_sequence     SMALLINT,
  status            TEXT,
  is_home           BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my public.games;
BEGIN
  SELECT * INTO v_my FROM public.games WHERE id = p_my_game_id;
  IF v_my.id IS NULL OR NOT public.is_team_member(v_my.team_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_my.opponent_team_id IS NULL THEN
    RETURN; -- free-text opponent; no candidates by definition
  END IF;

  RETURN QUERY
    SELECT g.id, g.game_date, g.game_time, g.game_sequence, g.status, g.is_home
    FROM public.games g
    WHERE g.team_id = v_my.opponent_team_id
      AND g.opponent_team_id = v_my.team_id
      AND g.game_date = v_my.game_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.game_match_candidates(UUID) TO authenticated;

-- Inserts the link row. Sanity-checks reciprocity, date, and home/visitor
-- designation. Either side's coach can confirm.
CREATE OR REPLACE FUNCTION public.confirm_game_link(
  p_home_game_id    UUID,
  p_visitor_game_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home    public.games;
  v_visitor public.games;
  v_id      UUID;
BEGIN
  SELECT * INTO v_home    FROM public.games WHERE id = p_home_game_id;
  SELECT * INTO v_visitor FROM public.games WHERE id = p_visitor_game_id;

  IF v_home.id IS NULL OR v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'game not found';
  END IF;

  IF NOT (
    public.is_team_member(v_home.team_id)
    OR public.is_team_member(v_visitor.team_id)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF v_home.opponent_team_id    <> v_visitor.team_id
  OR v_visitor.opponent_team_id <> v_home.team_id
  OR v_home.game_date           <> v_visitor.game_date THEN
    RAISE EXCEPTION 'games do not match';
  END IF;

  -- Exactly one side must be is_home = TRUE. Caught here so the UI can show a
  -- concrete "both schools have this marked home" message rather than a unique
  -- index violation.
  IF v_home.is_home IS NOT TRUE OR v_visitor.is_home IS NOT FALSE THEN
    RAISE EXCEPTION 'home/visitor designation conflict';
  END IF;

  INSERT INTO public.game_links (home_game_id, visitor_game_id, confirmed_by)
  VALUES (v_home.id, v_visitor.id, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_game_link(UUID, UUID) TO authenticated;

-- Either side's coach can break a link unilaterally. Idempotent on missing id.
CREATE OR REPLACE FUNCTION public.unlink_games(p_link_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.game_links;
BEGIN
  SELECT * INTO v_link FROM public.game_links WHERE id = p_link_id;
  IF v_link.id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.is_team_member((SELECT team_id FROM public.games WHERE id = v_link.home_game_id))
    OR public.is_team_member((SELECT team_id FROM public.games WHERE id = v_link.visitor_game_id))
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM public.game_links WHERE id = p_link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlink_games(UUID) TO authenticated;
