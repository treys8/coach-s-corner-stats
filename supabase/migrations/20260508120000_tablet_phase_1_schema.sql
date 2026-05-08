-- ============================================================================
-- Tablet PWA Phase 1 — schema for live in-game scoring.
--
-- Source of truth: append-only `game_events` keyed for idempotency on
-- (game_id, client_event_id), with monotonic per-game sequence numbers.
-- Corrections are new events of type='correction' that supersede prior ones.
--
-- Derived tables (server-written by the replay engine, never by users):
--   at_bats          — one row per PA, computed from events
--   game_live_state  — denormalized one row per game; powers /scores
--
-- Lookup table:
--   game_opponent_pitchers — cross-PA name continuity for opposing pitchers
--
-- All event types from the v1 design are accepted by the CHECK constraint
-- (Phase 1 only emits a subset; remainder light up in Phase 3 with no schema
-- change).
--
-- /scores public read is widened: in_progress games show with a LIVE badge.
-- ============================================================================

-- ---- Append-only event log -------------------------------------------------

CREATE TABLE public.game_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id              UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  client_event_id      TEXT NOT NULL,
  sequence_number      INTEGER NOT NULL,
  event_type           TEXT NOT NULL CHECK (event_type IN (
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
    'correction'
  )),
  payload              JSONB NOT NULL,
  supersedes_event_id  UUID REFERENCES public.game_events(id) ON DELETE SET NULL,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, client_event_id),
  UNIQUE (game_id, sequence_number)
);
CREATE INDEX game_events_game_seq_idx ON public.game_events (game_id, sequence_number);

-- ---- Game lifecycle status -------------------------------------------------
-- `is_final` already exists on games; add `status` for the draft → in_progress
-- → final transition and `is_live` derived for clarity in policies.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'final'));

-- Backfill: any existing finalized games keep their state.
UPDATE public.games SET status = 'final' WHERE is_final = TRUE AND status = 'draft';

-- Keep `status` and `is_final` in sync so existing /scores queries still work.
CREATE OR REPLACE FUNCTION public.games_sync_status_is_final()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'final' THEN
    NEW.is_final := TRUE;
    IF NEW.finalized_at IS NULL THEN NEW.finalized_at := now(); END IF;
  ELSE
    NEW.is_final := FALSE;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS games_sync_status_is_final ON public.games;
CREATE TRIGGER games_sync_status_is_final
  BEFORE INSERT OR UPDATE OF status ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.games_sync_status_is_final();

-- ---- Derived: at_bats ------------------------------------------------------

CREATE TABLE public.at_bats (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id               UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  event_id              UUID NOT NULL REFERENCES public.game_events(id) ON DELETE CASCADE,
  inning                SMALLINT NOT NULL CHECK (inning > 0),
  half                  TEXT NOT NULL CHECK (half IN ('top', 'bottom')),
  batting_order         SMALLINT,
  batter_id             UUID REFERENCES public.players(id) ON DELETE SET NULL,
  pitcher_id            UUID REFERENCES public.players(id) ON DELETE SET NULL,
  opponent_pitcher_id   UUID,  -- FK added below after game_opponent_pitchers exists
  result                TEXT NOT NULL,
  rbi                   SMALLINT NOT NULL DEFAULT 0,
  pitch_count           SMALLINT NOT NULL DEFAULT 0,
  spray_x               REAL,
  spray_y               REAL,
  fielder_position      TEXT,
  runs_scored_on_play   SMALLINT NOT NULL DEFAULT 0,
  outs_recorded         SMALLINT NOT NULL DEFAULT 0 CHECK (outs_recorded BETWEEN 0 AND 3),
  description           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);
CREATE INDEX at_bats_game_idx    ON public.at_bats (game_id, inning, half);
CREATE INDEX at_bats_batter_idx  ON public.at_bats (batter_id) WHERE batter_id IS NOT NULL;
CREATE INDEX at_bats_pitcher_idx ON public.at_bats (pitcher_id) WHERE pitcher_id IS NOT NULL;

-- ---- Lookup: opposing pitchers (cross-PA name continuity within a game) ----

CREATE TABLE public.game_opponent_pitchers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, name)
);

ALTER TABLE public.at_bats
  ADD CONSTRAINT at_bats_opponent_pitcher_fk
  FOREIGN KEY (opponent_pitcher_id)
  REFERENCES public.game_opponent_pitchers(id) ON DELETE SET NULL;

-- ---- Denormalized live state (one row per game; powers /scores) ------------

CREATE TABLE public.game_live_state (
  game_id          UUID PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
  inning           SMALLINT NOT NULL DEFAULT 1,
  half             TEXT NOT NULL DEFAULT 'top' CHECK (half IN ('top', 'bottom')),
  outs             SMALLINT NOT NULL DEFAULT 0 CHECK (outs BETWEEN 0 AND 3),
  runner_first     UUID REFERENCES public.players(id) ON DELETE SET NULL,
  runner_second    UUID REFERENCES public.players(id) ON DELETE SET NULL,
  runner_third     UUID REFERENCES public.players(id) ON DELETE SET NULL,
  team_score       SMALLINT NOT NULL DEFAULT 0,
  opponent_score   SMALLINT NOT NULL DEFAULT 0,
  last_play_text   TEXT,
  last_event_at    TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER game_live_state_updated_at BEFORE UPDATE ON public.game_live_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.game_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.at_bats                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_opponent_pitchers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_live_state         ENABLE ROW LEVEL SECURITY;

-- game_events: team members of the game's team can read/write. Service role
-- bypasses RLS so the replay engine can also read for derivation.
CREATE POLICY "game_events by team member" ON public.game_events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_id AND public.is_team_member(g.team_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_id AND public.is_team_member(g.team_id)
    )
  );

-- game_opponent_pitchers: same as game_events.
CREATE POLICY "game_opponent_pitchers by team member" ON public.game_opponent_pitchers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_id AND public.is_team_member(g.team_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_id AND public.is_team_member(g.team_id)
    )
  );

-- at_bats: team-member read; no client-side write (service role only).
CREATE POLICY "at_bats read by team member" ON public.at_bats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_id AND public.is_team_member(g.team_id)
    )
  );

-- at_bats: public read for finalized games (will support box scores on /scores).
CREATE POLICY "at_bats public read finalized" ON public.at_bats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_id AND g.is_final = TRUE
    )
  );

-- game_live_state: team-member read.
CREATE POLICY "game_live_state read by team member" ON public.game_live_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_id AND public.is_team_member(g.team_id)
    )
  );

-- game_live_state: public read whenever the game is in_progress or final
-- (drives the LIVE tile and the final scoreboard).
CREATE POLICY "game_live_state public read live or final" ON public.game_live_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_id AND g.status IN ('in_progress', 'final')
    )
  );

-- ---- Widen /scores public read to include in_progress -----------------------

DROP POLICY IF EXISTS "games public read finalized" ON public.games;
CREATE POLICY "games public read live or finalized" ON public.games
  FOR SELECT USING (status IN ('in_progress', 'final'));
