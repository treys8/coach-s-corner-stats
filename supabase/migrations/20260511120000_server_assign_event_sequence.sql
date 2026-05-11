-- Server-assigned game_events.sequence_number.
--
-- Before: the tablet computed `nextSeq = lastSeq + 1` from its local snapshot
-- and sent it with the event. Two clients (or a fast double-tap that arrived
-- before the local snapshot refreshed) would compute the same value and one
-- would fail the UNIQUE(game_id, sequence_number) constraint with a 500.
-- This was tolerable when each PA produced one event; pitch-by-pitch scoring
-- multiplies events ~3-4x and makes the race condition routine.
--
-- After: clients omit sequence_number. A BEFORE INSERT trigger takes a
-- per-game advisory lock and assigns MAX(sequence_number)+1 atomically.
-- Concurrent inserts for the same game serialize through the lock;
-- inserts for different games don't contend.

ALTER TABLE public.game_events ALTER COLUMN sequence_number DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_game_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Per-game serialization. hashtext gives us a stable int4; the prefix
  -- avoids colliding with advisory locks taken elsewhere on the same id.
  PERFORM pg_advisory_xact_lock(hashtext('game_events:' || NEW.game_id::text));

  SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO NEW.sequence_number
    FROM public.game_events
    WHERE game_id = NEW.game_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS game_events_assign_sequence ON public.game_events;
CREATE TRIGGER game_events_assign_sequence
BEFORE INSERT ON public.game_events
FOR EACH ROW
EXECUTE FUNCTION public.assign_game_event_sequence();

-- Note: BEFORE INSERT triggers see prior committed rows but NOT other
-- pending rows from the same multi-row INSERT statement. We always insert
-- one event per request, so this is fine. If we ever bulk-insert events
-- (e.g., backfill), call a different code path that assigns sequence
-- numbers explicitly under the same lock.
