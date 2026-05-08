-- Add source + game_id to stat_snapshots so tablet-finalized games can roll
-- per-player rows into the same table the xlsx upload writes to. Existing
-- rows get source='xlsx' via the column default.
--
-- The unique key gains game_id (NULL for xlsx, set for tablet) so that:
--   * xlsx keeps weekly upsert semantics keyed on (team, player, upload_date)
--     with game_id NULL — NULLS NOT DISTINCT makes "two NULLs conflict" so
--     the existing onConflict path keeps working.
--   * Tablet doubleheaders on the same date stay distinct via game_id.

ALTER TABLE public.stat_snapshots
  ADD COLUMN source TEXT NOT NULL DEFAULT 'xlsx'
    CHECK (source IN ('xlsx', 'tablet')),
  ADD COLUMN game_id UUID NULL
    REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE public.stat_snapshots
  DROP CONSTRAINT stat_snapshots_team_id_player_id_upload_date_key;

ALTER TABLE public.stat_snapshots
  ADD CONSTRAINT stat_snapshots_team_id_player_id_upload_date_game_id_key
  UNIQUE NULLS NOT DISTINCT (team_id, player_id, upload_date, game_id);

CREATE INDEX stat_snapshots_game_idx
  ON public.stat_snapshots (game_id)
  WHERE game_id IS NOT NULL;
