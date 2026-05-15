-- Add `advance_on_throw` to the game_events.event_type CHECK constraint.
--
-- Punch-list item #3 from the real-game fixture initiative: a first-class
-- event for a runner taking an extra base "on the throw" with no error
-- charged (judgment-call advance — e.g., RF throws to 3rd trying to nab
-- the lead runner; trail runner takes home from 2nd). Previously encoded
-- as `error_advance` with an empty `error_fielder_position`, which leaked
-- error semantics onto a non-error advance. Engine treatment: earned-run,
-- no taint, no fielder-error attribution (WP/balk-style).
--
-- Mirrors the DROP-then-ADD pattern from
-- 20260514130000_league_rules_and_suspended_status.sql.

DO $$
DECLARE
  cn TEXT;
BEGIN
  SELECT conname INTO cn
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
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
      'advance_on_throw',
      'substitution',
      'pitching_change',
      'position_change',
      'game_started',
      'inning_end',
      'game_finalized',
      'correction',
      'defensive_conference',
      'opposing_lineup_edit',
      'umpire_call',
      'game_suspended'
    ));
END $$;
