-- Add 'pitch' as a valid event_type on game_events.
--
-- This is the foundation of the GameChanger-style pitch-by-pitch flow: each
-- pitch becomes its own event. The terminal pitch of a plate appearance
-- (kind=in_play, hbp, intentional_walk, ...) carries result + spray +
-- fielder + runner advances and the replay engine derives a row in `at_bats`
-- from it. Older `at_bat` events keep working unchanged; the two coexist
-- so games scored under the old model still replay correctly.

ALTER TABLE public.game_events DROP CONSTRAINT IF EXISTS game_events_event_type_check;
ALTER TABLE public.game_events ADD CONSTRAINT game_events_event_type_check
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
    'correction'
  ));
