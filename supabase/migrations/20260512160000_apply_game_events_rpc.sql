-- Atomic batched insert of game_events for the live scoring tablet.
--
-- A single PA tap can now persist 1, 2, or 3 events in one transaction:
--   * a pitch
--   * + the closing at_bat (when the pitch closes the PA: 3-ball, 2-strike
--     decisive, HBP)
--   * + an inning_end (when the closing PA brings outs to 3)
--
-- Before: the tablet chained 2–3 sequential POSTs, with a latent half-state
-- bug if any but the first failed (pitch persists, follow-on AB never lands).
-- After: the server emits the whole chain and calls this function once.
-- Failure of any insert rolls back the entire batch.
--
-- SECURITY DEFINER is required so the function can both authoritatively
-- insert game_events (bypassing the RLS write policy for atomicity across
-- multiple rows in one transaction) and trigger the sequence-assignment
-- BEFORE INSERT trigger from a context where SELECT on game_events is
-- allowed. The RLS write policy ('game_events by team member') is therefore
-- replaced inside this function by an explicit is_team_member check on the
-- game's team. Direct client INSERTs still go through the RLS policy.
--
-- Idempotency: per-event UNIQUE(game_id, client_event_id) collisions are
-- caught and the prior row is returned with was_duplicate=TRUE. A retry of
-- a partially-applied batch is therefore safe.

CREATE OR REPLACE FUNCTION public.apply_game_events(
  p_game_id UUID,
  p_events  JSONB
)
RETURNS TABLE (
  id                   UUID,
  game_id              UUID,
  client_event_id      TEXT,
  sequence_number      INTEGER,
  event_type           TEXT,
  payload              JSONB,
  supersedes_event_id  UUID,
  created_by           UUID,
  created_at           TIMESTAMPTZ,
  was_duplicate        BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_team_id UUID;
  v_event   JSONB;
  v_row     public.game_events%ROWTYPE;
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

  -- Manual auth gate replacing the RLS write policy this DEFINER context
  -- bypasses. Mirrors `game_events by team member` on the underlying table.
  IF NOT public.is_team_member(v_team_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    BEGIN
      INSERT INTO public.game_events (
        game_id,
        client_event_id,
        event_type,
        payload,
        supersedes_event_id,
        created_by
      )
      VALUES (
        p_game_id,
        v_event->>'client_event_id',
        v_event->>'event_type',
        v_event->'payload',
        NULLIF(v_event->>'supersedes_event_id', '')::UUID,
        v_uid
      )
      RETURNING * INTO v_row;

      id                  := v_row.id;
      game_id             := v_row.game_id;
      client_event_id     := v_row.client_event_id;
      sequence_number     := v_row.sequence_number;
      event_type          := v_row.event_type;
      payload             := v_row.payload;
      supersedes_event_id := v_row.supersedes_event_id;
      created_by          := v_row.created_by;
      created_at          := v_row.created_at;
      was_duplicate       := FALSE;
      RETURN NEXT;

    EXCEPTION WHEN unique_violation THEN
      -- Prior row with the same client_event_id exists. Return it so the
      -- caller can fold an authoritative copy without aborting the rest of
      -- the chain. Re-replay downstream is safe (rederive is idempotent).
      SELECT * INTO v_row
        FROM public.game_events ge
       WHERE ge.game_id = p_game_id
         AND ge.client_event_id = v_event->>'client_event_id';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'unique_violation but no prior row for client_event_id=%',
          v_event->>'client_event_id';
      END IF;

      id                  := v_row.id;
      game_id             := v_row.game_id;
      client_event_id     := v_row.client_event_id;
      sequence_number     := v_row.sequence_number;
      event_type          := v_row.event_type;
      payload             := v_row.payload;
      supersedes_event_id := v_row.supersedes_event_id;
      created_by          := v_row.created_by;
      created_at          := v_row.created_at;
      was_duplicate       := TRUE;
      RETURN NEXT;
    END;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_game_events(UUID, JSONB) TO authenticated;
