-- Stage 6a — league_rules table + 'suspended' game status + game_suspended event.
--
-- Three deltas in one migration (locked design at
-- /docs/live-scoring/schema-deltas-v2.md §4-5, §7):
--
--   1. games.status CHECK extension: 'draft' | 'in_progress' | 'final' | 'suspended'.
--      Resume path = any subsequent play-resolving event flips status back to
--      in_progress (engine-side, no schema work). /scores and game_live_state
--      consumers render suspended as in_progress with a banner; stat_snapshots
--      writes stay gated to status='final'.
--
--   2. game_events.event_type CHECK extension: adds 'game_suspended'. Mirrors
--      the DROP-then-ADD pattern from 20260514120000_umpire_call_event_type.sql.
--
--   3. league_rules table — per-(school, season_year) configuration. NFHS
--      defaults ship in code (src/lib/scoring/league-defaults.ts). Game-time
--      lookup walks (school, season_year) → school default (year IS NULL) →
--      NFHS code defaults. teams.league_type / nfhs_state / pitch_limits stay
--      as a per-team override layer for edge cases.

-- ---- 1. games.status CHECK -------------------------------------------------

DO $$
DECLARE
  cn TEXT;
BEGIN
  SELECT conname INTO cn
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'games'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%status%'
     AND pg_get_constraintdef(c.oid) ILIKE '%draft%';

  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.games DROP CONSTRAINT %I', cn);
  END IF;

  ALTER TABLE public.games
    ADD CONSTRAINT games_status_check
    CHECK (status IN ('draft', 'in_progress', 'final', 'suspended'));
END $$;

-- ---- 2. game_events.event_type CHECK ---------------------------------------

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

-- ---- 3. league_rules table -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.league_rules (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- NULL = the school's default row that applies when no season-specific row
  -- exists. season_year is otherwise the calendar year of the spring season.
  season_year                 INT,

  -- Mercy
  mercy_threshold_runs        INT  NOT NULL DEFAULT 10,
  mercy_threshold_inning      INT  NOT NULL DEFAULT 5,
  mercy_threshold_runs_alt    INT,
  mercy_threshold_inning_alt  INT,

  -- Pitch counts
  pitch_count_max             INT  NOT NULL DEFAULT 105,
  -- [{ "pitches": 76, "rest_days": 4 }, ...]
  pitch_count_rest_tiers      JSONB NOT NULL DEFAULT '[]'::jsonb,
  mid_batter_finish           BOOL NOT NULL DEFAULT TRUE,

  -- Substitutions
  courtesy_runner_allowed     BOOL NOT NULL DEFAULT TRUE,
  reentry_starters_only       BOOL NOT NULL DEFAULT TRUE,
  reentry_once_per_starter    BOOL NOT NULL DEFAULT TRUE,

  -- Field
  double_first_base           BOOL NOT NULL DEFAULT FALSE,

  -- Escape hatch for rule variants not yet enumerated.
  extras                      JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (school, season_year). The partial unique index handles the
-- season_year IS NULL default row, since standard UNIQUE treats NULLs as
-- distinct and would let two "default" rows coexist.
CREATE UNIQUE INDEX IF NOT EXISTS league_rules_school_season_uniq
  ON public.league_rules (school_id, season_year)
  WHERE season_year IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS league_rules_school_default_uniq
  ON public.league_rules (school_id)
  WHERE season_year IS NULL;

CREATE INDEX IF NOT EXISTS league_rules_school_idx
  ON public.league_rules (school_id, season_year);

DROP TRIGGER IF EXISTS league_rules_updated_at ON public.league_rules;
CREATE TRIGGER league_rules_updated_at
  BEFORE UPDATE ON public.league_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- RLS: read = any signed-in school member, write = school admin ---------

ALTER TABLE public.league_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "league_rules read by school members" ON public.league_rules;
CREATE POLICY "league_rules read by school members" ON public.league_rules
  FOR SELECT USING (
    public.is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.school_id = public.league_rules.school_id
        AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "league_rules write by school admin" ON public.league_rules;
CREATE POLICY "league_rules write by school admin" ON public.league_rules
  FOR ALL USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));
