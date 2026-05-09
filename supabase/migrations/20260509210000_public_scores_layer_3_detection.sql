-- Public scores rollout — Step 7 (Layer 3): discrepancy detection trigger.
-- See docs/public-scores-architecture.md.
--
-- Hook point chosen as a Postgres trigger on games (not an RPC) so every code
-- path that changes a public-visible final score — tablet finalize, manual
-- schedule edits, future ingestion paths — fires it without anyone having to
-- remember. A second trigger on game_links covers the case where two already-
-- finalized games get linked after the fact.
--
-- The bypass GUC `statly.skip_discrepancy_check` short-circuits the trigger
-- for admin imports/backfills; set it inside the transaction:
--   SET LOCAL statly.skip_discrepancy_check = 'on';
--
-- This migration only hooks `games`. The architecture doc allows a parallel
-- hook on `game_live_state` ("final state changes only"); we skip it here
-- because post-finalize edits flow through `games`, and live mid-game score
-- diffs are too noisy to surface as a banner.

-- ---------- Recompute helper ------------------------------------------------

-- Single source of truth for discrepancy lifecycle. Called by the games and
-- game_links triggers below. p_score_changed_side names which account just
-- moved its score (so we can clear that side's self_confirmed flag); pass
-- NULL when nothing score-relevant changed.
CREATE OR REPLACE FUNCTION public._score_discrepancy_recompute_for_link(
  p_link_id              UUID,
  p_score_changed_side   TEXT  -- 'home' | 'visitor' | NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link    public.game_links;
  v_home    public.games;
  v_visitor public.games;
  v_h_h     INTEGER;
  v_h_v     INTEGER;
  v_v_h     INTEGER;
  v_v_v     INTEGER;
  v_have_all BOOLEAN;
  v_agree    BOOLEAN;
  v_disc_id  UUID;
  v_disc_resolved TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_link FROM public.game_links WHERE id = p_link_id;
  IF v_link.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_home    FROM public.games WHERE id = v_link.home_game_id;
  SELECT * INTO v_visitor FROM public.games WHERE id = v_link.visitor_game_id;

  -- Canonical mapping (see docs/public-scores-architecture.md → "Score column
  -- mapping"): each account stores team_score = own team's runs, opponent_score
  -- = the other team's runs. Reproject into home/visitor.
  v_h_h := v_home.team_score;
  v_h_v := v_home.opponent_score;
  v_v_h := v_visitor.opponent_score;
  v_v_v := v_visitor.team_score;

  v_have_all :=
    v_h_h IS NOT NULL AND v_h_v IS NOT NULL
    AND v_v_h IS NOT NULL AND v_v_v IS NOT NULL;

  -- One side hasn't reported a score yet — too early to call a discrepancy.
  -- We deliberately don't auto-resolve here either: if a previously-open
  -- dispute reverts to one-side-null (e.g. a coach clears their score),
  -- leave the row alone until both sides have numbers again.
  IF NOT v_have_all THEN RETURN; END IF;

  v_agree := (v_h_h = v_v_h AND v_h_v = v_v_v);

  SELECT id, resolved_at INTO v_disc_id, v_disc_resolved
  FROM public.score_discrepancies
  WHERE game_link_id = p_link_id
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_disc_id IS NULL THEN
    IF NOT v_agree THEN
      INSERT INTO public.score_discrepancies (
        game_link_id,
        home_acct_home_score, home_acct_visitor_score,
        vis_acct_home_score,  vis_acct_visitor_score
      ) VALUES (p_link_id, v_h_h, v_h_v, v_v_h, v_v_v);
    END IF;
    RETURN;
  END IF;

  IF v_agree THEN
    IF v_disc_resolved IS NULL THEN
      UPDATE public.score_discrepancies
        SET resolved_at = now()
        WHERE id = v_disc_id;
    END IF;
    RETURN;
  END IF;

  -- Disagree. Reopen if previously resolved; refresh scores; clear the
  -- changing side's self_confirmed flag (per the architecture doc).
  UPDATE public.score_discrepancies
    SET resolved_at = NULL,
        home_acct_home_score    = v_h_h,
        home_acct_visitor_score = v_h_v,
        vis_acct_home_score     = v_v_h,
        vis_acct_visitor_score  = v_v_v,
        home_self_confirmed     = CASE
          WHEN p_score_changed_side = 'home'    THEN FALSE
          ELSE home_self_confirmed
        END,
        visitor_self_confirmed  = CASE
          WHEN p_score_changed_side = 'visitor' THEN FALSE
          ELSE visitor_self_confirmed
        END
    WHERE id = v_disc_id;
END;
$$;

-- ---------- Trigger: games AFTER UPDATE -------------------------------------

CREATE OR REPLACE FUNCTION public._score_discrepancy_on_games()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link_id        UUID;
  v_caller_is_home BOOLEAN;
  v_score_changed  BOOLEAN;
  v_side           TEXT;
BEGIN
  -- Admin imports/backfills SET LOCAL statly.skip_discrepancy_check = 'on'.
  IF COALESCE(current_setting('statly.skip_discrepancy_check', true), 'off')
     IN ('on', 'true', '1')
  THEN RETURN NEW; END IF;

  SELECT id, (home_game_id = NEW.id)
    INTO v_link_id, v_caller_is_home
    FROM public.game_links
    WHERE home_game_id = NEW.id OR visitor_game_id = NEW.id;

  IF v_link_id IS NULL THEN RETURN NEW; END IF;

  v_score_changed :=
    OLD.team_score     IS DISTINCT FROM NEW.team_score
    OR OLD.opponent_score IS DISTINCT FROM NEW.opponent_score;

  v_side := CASE
    WHEN v_score_changed AND v_caller_is_home     THEN 'home'
    WHEN v_score_changed AND NOT v_caller_is_home THEN 'visitor'
    ELSE NULL
  END;

  PERFORM public._score_discrepancy_recompute_for_link(v_link_id, v_side);
  RETURN NEW;
END;
$$;

CREATE TRIGGER score_discrepancy_on_games
  AFTER UPDATE OF status, team_score, opponent_score
  ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public._score_discrepancy_on_games();

-- ---------- Trigger: game_links AFTER INSERT --------------------------------
-- Covers the case where two already-finalized games get linked after the
-- fact: the games trigger never fires for that case, so detection has to run
-- when the link itself is created.

CREATE OR REPLACE FUNCTION public._score_discrepancy_on_link_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('statly.skip_discrepancy_check', true), 'off')
     IN ('on', 'true', '1')
  THEN RETURN NEW; END IF;
  PERFORM public._score_discrepancy_recompute_for_link(NEW.id, NULL);
  RETURN NEW;
END;
$$;

CREATE TRIGGER score_discrepancy_on_link_insert
  AFTER INSERT ON public.game_links
  FOR EACH ROW
  EXECUTE FUNCTION public._score_discrepancy_on_link_insert();

-- ---------- RPC: confirm_my_score -------------------------------------------
-- "My score is correct" action from the discrepancy banner. SECURITY DEFINER
-- so we can write into score_discrepancies (which has no write policy);
-- authorization re-checked via is_team_member.

CREATE OR REPLACE FUNCTION public.confirm_my_score(p_link_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link               public.game_links;
  v_caller_is_home     BOOLEAN;
  v_caller_is_visitor  BOOLEAN;
BEGIN
  SELECT * INTO v_link FROM public.game_links WHERE id = p_link_id;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'link not found';
  END IF;

  v_caller_is_home := public.is_team_member(
    (SELECT team_id FROM public.games WHERE id = v_link.home_game_id)
  );
  v_caller_is_visitor := public.is_team_member(
    (SELECT team_id FROM public.games WHERE id = v_link.visitor_game_id)
  );

  IF NOT (v_caller_is_home OR v_caller_is_visitor) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.score_discrepancies
    SET home_self_confirmed    = CASE WHEN v_caller_is_home    THEN TRUE ELSE home_self_confirmed    END,
        visitor_self_confirmed = CASE WHEN v_caller_is_visitor THEN TRUE ELSE visitor_self_confirmed END
    WHERE game_link_id = p_link_id
      AND resolved_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_my_score(UUID) TO authenticated;
