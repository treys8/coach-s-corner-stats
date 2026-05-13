-- ============================================================================
-- game_lineup_drafts — pre-game lineup persistence.
--
-- Coaches set lineups (ours + opposing) on the pre-game form. Before this
-- table, the form lived only in React state: navigating away or switching
-- devices wiped everything. This row holds the full pre-game payload as
-- JSONB so the form can hydrate on mount and survive across devices /
-- coaches.
--
-- Lifecycle: written when a coach hits "Save lineup"; deleted when the
-- game_started event fires (form has served its purpose). ON DELETE CASCADE
-- on game_id ensures deleting a game cleans this up too. Last-write-wins:
-- no per-field merge, no optimistic concurrency.
-- ============================================================================

CREATE TABLE public.game_lineup_drafts (
  game_id     UUID PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
  payload     JSONB NOT NULL,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER game_lineup_drafts_updated_at BEFORE UPDATE ON public.game_lineup_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.game_lineup_drafts ENABLE ROW LEVEL SECURITY;

-- Team members of the game's team can read/write their draft. Matches the
-- pattern used by game_events / game_opponent_pitchers.
CREATE POLICY "game_lineup_drafts by team member" ON public.game_lineup_drafts
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
