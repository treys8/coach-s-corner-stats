-- Atomic derived-state writes.
--
-- Before: rederive() in src/lib/scoring/server.ts wrote game_live_state,
-- at_bats, and games via three concurrent admin-client calls in Promise.all.
-- Promise.all rejects on the first error, but every started write commits
-- regardless — so a CHECK or FK violation on one table left the public
-- scoreboard inconsistent across the other two.
--
-- After: this RPC folds the three derived writes into one Postgres
-- transaction. Either all three commit or none do. Failures bubble up as a
-- single Postgres error; the user retries the tap, the next call rederives
-- from event state, and the system converges.
--
-- Atomicity scope: this RPC covers the three derived tables only. Event
-- inserts remain in apply_game_events (the prior RPC), called immediately
-- before this one from applyEvent. A failure between the two leaves events
-- committed but derived state stale — the same retry behavior the
-- pre-refactor code already relied on (rederive is idempotent).
--
-- The TS replay engine remains the source of truth for state transitions;
-- this RPC is a thin persistence layer. Derived rows are looked up by
-- (game_id, client_event_id) since the TS may pass a state computed with
-- synthetic event ids before the corresponding game_events row is read back.

CREATE OR REPLACE FUNCTION public.write_derived_state(
  p_game_id  UUID,
  p_derived  JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_team_id UUID;
  v_live    JSONB := p_derived -> 'live';
  v_abs     JSONB := p_derived -> 'at_bats';
  v_game    JSONB := p_derived -> 'game_update';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT g.team_id INTO v_team_id
    FROM public.games g
    WHERE g.id = p_game_id;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'game not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_team_member(v_team_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ---- game_live_state ----------------------------------------------------

  IF v_live IS NOT NULL AND v_live <> 'null'::jsonb THEN
    INSERT INTO public.game_live_state (
      game_id, inning, half, outs,
      runner_first, runner_second, runner_third,
      team_score, opponent_score,
      last_play_text, last_event_at
    )
    VALUES (
      p_game_id,
      (v_live->>'inning')::SMALLINT,
      v_live->>'half',
      (v_live->>'outs')::SMALLINT,
      NULLIF(v_live->>'runner_first',  '')::UUID,
      NULLIF(v_live->>'runner_second', '')::UUID,
      NULLIF(v_live->>'runner_third',  '')::UUID,
      (v_live->>'team_score')::SMALLINT,
      (v_live->>'opponent_score')::SMALLINT,
      v_live->>'last_play_text',
      NULLIF(v_live->>'last_event_at', '')::TIMESTAMPTZ
    )
    ON CONFLICT (game_id) DO UPDATE SET
      inning          = EXCLUDED.inning,
      half            = EXCLUDED.half,
      outs            = EXCLUDED.outs,
      runner_first    = EXCLUDED.runner_first,
      runner_second   = EXCLUDED.runner_second,
      runner_third    = EXCLUDED.runner_third,
      team_score      = EXCLUDED.team_score,
      opponent_score  = EXCLUDED.opponent_score,
      last_play_text  = EXCLUDED.last_play_text,
      last_event_at   = EXCLUDED.last_event_at;
  END IF;

  -- ---- at_bats ------------------------------------------------------------
  -- Each at_bat row in p_derived->at_bats carries the originating event's
  -- client_event_id; the real event_id is resolved via game_events. This
  -- lets TS build the derived payload from a state computed before events
  -- are read back from the DB.

  IF v_abs IS NOT NULL AND v_abs <> 'null'::jsonb AND jsonb_array_length(v_abs) > 0 THEN
    INSERT INTO public.at_bats (
      game_id, event_id, inning, half, batting_order,
      batter_id, opponent_batter_id, pitcher_id, opponent_pitcher_id,
      result, rbi, pitch_count, balls, strikes,
      spray_x, spray_y, fielder_position,
      runs_scored_on_play, outs_recorded, description
    )
    SELECT
      p_game_id,
      ge.id,
      (ab->>'inning')::SMALLINT,
      ab->>'half',
      NULLIF(ab->>'batting_order','')::SMALLINT,
      NULLIF(ab->>'batter_id','')::UUID,
      NULLIF(ab->>'opponent_batter_id','')::UUID,
      NULLIF(ab->>'pitcher_id','')::UUID,
      NULLIF(ab->>'opponent_pitcher_id','')::UUID,
      ab->>'result',
      COALESCE((ab->>'rbi')::SMALLINT, 0),
      COALESCE((ab->>'pitch_count')::SMALLINT, 0),
      COALESCE((ab->>'balls')::SMALLINT, 0),
      COALESCE((ab->>'strikes')::SMALLINT, 0),
      NULLIF(ab->>'spray_x','')::REAL,
      NULLIF(ab->>'spray_y','')::REAL,
      NULLIF(ab->>'fielder_position',''),
      COALESCE((ab->>'runs_scored_on_play')::SMALLINT, 0),
      COALESCE((ab->>'outs_recorded')::SMALLINT, 0),
      ab->>'description'
    FROM jsonb_array_elements(v_abs) ab
    JOIN public.game_events ge
      ON ge.game_id = p_game_id
     AND ge.client_event_id = ab->>'client_event_id'
    ON CONFLICT (event_id) DO NOTHING;
  END IF;

  -- ---- games status / score / result --------------------------------------

  IF v_game IS NOT NULL AND v_game <> 'null'::jsonb THEN
    UPDATE public.games
       SET status         = COALESCE(v_game->>'status', status),
           team_score     = CASE WHEN v_game ? 'team_score'
                                 THEN (v_game->>'team_score')::INTEGER
                                 ELSE team_score END,
           opponent_score = CASE WHEN v_game ? 'opponent_score'
                                 THEN (v_game->>'opponent_score')::INTEGER
                                 ELSE opponent_score END,
           result         = CASE WHEN v_game ? 'result'
                                 THEN v_game->>'result'
                                 ELSE result END
     WHERE id = p_game_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_derived_state(UUID, JSONB) TO authenticated;
