-- Phase 3: NFHS defensive-conference tracking (PDF §28.9; NFHS 3-4-1).
-- Adds 'defensive_conference' to game_events.event_type CHECK constraint.
-- Mirrors the dynamic-rename pattern from 20260510130000_pitch_event_type.sql.

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
      'pitch',
      'defensive_conference'
    ));
END
$$;
