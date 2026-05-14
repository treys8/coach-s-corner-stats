-- Add `umpire_call` to the game_events.event_type CHECK constraint.
--
-- First v2-UX migration. Models umpire calls (IFR, obstruction, batter /
-- runner / spectator / coach interference) as a modifier event consumed by
-- the next play-resolving event (at_bat / stolen_base / error_advance /
-- etc). The engine tracks pending calls in ReplayState.pending_umpire_calls
-- and clears them when consumed. Locked design at
-- /docs/live-scoring/schema-deltas-v2.md §3.
--
-- Idempotent: drops the existing CHECK (whatever the prior allow-list was)
-- and rebuilds with the canonical v2 list. Mirrors the DROP-then-ADD
-- pattern from 20260511140000_restore_defensive_conference_to_event_check.sql.

DO $$
DECLARE
  cn TEXT;
BEGIN
  SELECT conname INTO cn
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'game_events'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%event_type%';

  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.game_events DROP CONSTRAINT %I', cn);
  END IF;

  ALTER TABLE public.game_events
    ADD CONSTRAINT game_events_event_type_check
    CHECK (event_type IN (
      'at_bat',
      'pitch',
      'stolen_base',
      'caught_stealing',
      'pickoff',
      'wild_pitch',
      'passed_ball',
      'balk',
      'error_advance',
      'substitution',
      'pitching_change',
      'position_change',
      'game_started',
      'inning_end',
      'game_finalized',
      'correction',
      'defensive_conference',
      'opposing_lineup_edit',
      'umpire_call'
    ));
END $$;
