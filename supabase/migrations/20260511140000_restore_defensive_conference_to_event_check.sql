-- Restore `defensive_conference` to game_events.event_type CHECK constraint.
--
-- A migration carved out of an in-flight pitch-events branch (file named
-- 20260511130000_add_pitch_event_type.sql, never landed in git) was run
-- manually against the SQL editor. That branch predated #28's defensive_
-- conference work, so its CHECK rebuild dropped 'defensive_conference'
-- from the allow-list. Result: any insert with event_type =
-- 'defensive_conference' fails with 23514 (check_violation) — including
-- the mound-visit button in LiveScoring.tsx.
--
-- This migration rebuilds the constraint with the canonical allow-list,
-- which includes both `pitch` and `defensive_conference`. Idempotent —
-- safe to re-run on any DB regardless of which prior state it's in.

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
      'defensive_conference'
    ));
END $$;
