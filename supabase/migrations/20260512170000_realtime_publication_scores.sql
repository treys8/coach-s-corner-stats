-- Spectator Realtime on /scores.
--
-- /scores already reads game_live_state (in_progress | final) and games
-- (in_progress | final) through public-read RLS policies. To push score
-- updates to anonymous viewers in real time, both tables need to be in the
-- `supabase_realtime` publication. No RLS change is required — Realtime
-- subscribers receive the same row visibility they would on a SELECT.
--
-- We deliberately do NOT add game_events to the publication: the public
-- surface invariant ([[public_surface]]) keeps event-level data behind the
-- authenticated `/s/...` routes. Spectators get score / inning / heartbeat
-- updates via game_live_state; a per-game public live view would be a
-- separate feature requiring its own RLS audit.
--
-- DO blocks make the migration idempotent across environments where the
-- publication may already include these tables.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_live_state;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication does not exist; skipping';
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication does not exist; skipping';
END
$$;
