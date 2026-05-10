-- Phase 5: NFHS league configuration on teams.
--
-- Adds:
--   - league_type: 'mlb' | 'nfhs' (default 'mlb' for backward compat)
--   - nfhs_state: state code for state-specific pitch-limit configs
--   - pitch_limits: per-team JSONB override of the default state limits
--
-- The default rules table lives in code (`src/lib/scoring/pitch-limits.ts`)
-- so coaches don't have to maintain JSONB to use the standard NFHS rules.
-- pitch_limits is only set when a team needs to override.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS league_type TEXT NOT NULL DEFAULT 'mlb'
    CHECK (league_type IN ('mlb', 'nfhs'));

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS nfhs_state TEXT;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS pitch_limits JSONB;
