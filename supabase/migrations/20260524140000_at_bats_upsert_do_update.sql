-- at_bats correction upsert: overwrite instead of swallowing.
--
-- Before: the at_bats INSERT inside write_derived_state used
-- `ON CONFLICT (event_id) DO NOTHING`. Replay-derived state is supposed
-- to be authoritative — the latest derivation should always win — but
-- when a correction superseded a prior play and the RPC re-derived, the
-- second upsert no-op'd against the existing row keyed on event_id. The
-- at_bats row continued to reflect the original play. The "edit last
-- play" flow visibly succeeded (live state + games row updated) while
-- the canonical at_bats record silently kept the stale values.
--
-- After: switch to `ON CONFLICT (event_id) DO UPDATE SET ...` with every
-- projected column listed. Idempotent re-derivations remain cheap (same
-- values overwritten with same values) and corrections now persist.
--
-- Signature is unchanged from 20260524130000_write_derived_state_concurrency
-- (UUID, JSONB, INTEGER) so a plain CREATE OR REPLACE suffices. The
-- concurrency guard (FOR UPDATE + p_expected_last_seq check) is preserved
-- verbatim — only the at_bats ON CONFLICT clause changes.

CREATE OR REPLACE FUNCTION public.write_derived_state(
  p_game_id           UUID,
  p_derived           JSONB,
  p_expected_last_seq INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_team_id    UUID;
  v_live       JSONB := p_derived -> 'live';
  v_abs        JSONB := p_derived -> 'at_bats';
  v_game       JSONB := p_derived -> 'game_update';
  v_actual_seq INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE serializes concurrent write_derived_state calls per game.
  -- Without it, two callers could both pass the seq check below and then
  -- both proceed to write, with the second one clobbering the first.
  SELECT g.team_id INTO v_team_id
    FROM public.games g
   WHERE g.id = p_game_id
   FOR UPDATE;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'game not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_team_member(v_team_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Concurrency guard. If the caller's state was computed against an old
  -- max(seq), another writer has interleaved — abort and let the caller
  -- retry with a fresh replay. ERRCODE 40001 maps to
  -- serialization_failure, which Postgres clients (and our retry harness)
  -- treat as a transient retryable failure.
  IF p_expected_last_seq IS NOT NULL THEN
    SELECT COALESCE(MAX(ge.sequence_number), 0)
      INTO v_actual_seq
      FROM public.game_events ge
     WHERE ge.game_id = p_game_id;
    IF v_actual_seq <> p_expected_last_seq THEN
      RAISE EXCEPTION
        'concurrency_conflict: expected last_seq=% but actual=%',
        p_expected_last_seq, v_actual_seq
        USING ERRCODE = '40001';
    END IF;
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
  --
  -- DO UPDATE (not DO NOTHING) so that re-derivations triggered by a
  -- correction overwrite the stale row keyed on event_id. Replay output
  -- is always authoritative.

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
    ON CONFLICT (event_id) DO UPDATE SET
      inning              = EXCLUDED.inning,
      half                = EXCLUDED.half,
      batting_order       = EXCLUDED.batting_order,
      batter_id           = EXCLUDED.batter_id,
      opponent_batter_id  = EXCLUDED.opponent_batter_id,
      pitcher_id          = EXCLUDED.pitcher_id,
      opponent_pitcher_id = EXCLUDED.opponent_pitcher_id,
      result              = EXCLUDED.result,
      rbi                 = EXCLUDED.rbi,
      pitch_count         = EXCLUDED.pitch_count,
      balls               = EXCLUDED.balls,
      strikes             = EXCLUDED.strikes,
      spray_x             = EXCLUDED.spray_x,
      spray_y             = EXCLUDED.spray_y,
      fielder_position    = EXCLUDED.fielder_position,
      runs_scored_on_play = EXCLUDED.runs_scored_on_play,
      outs_recorded       = EXCLUDED.outs_recorded,
      description         = EXCLUDED.description;
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

GRANT EXECUTE ON FUNCTION public.write_derived_state(UUID, JSONB, INTEGER) TO authenticated;
