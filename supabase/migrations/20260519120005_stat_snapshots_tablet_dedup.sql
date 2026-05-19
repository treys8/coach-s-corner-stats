-- stat_snapshots' unique key is (team_id, player_id, upload_date, game_id)
-- with NULLS NOT DISTINCT (20260508150000). For xlsx rows that's correct:
-- one row per (team, player, upload_date). For tablet rows, the unique-by-
-- upload_date dimension is wrong — a tablet rebuild on a different `now()`
-- could legitimately produce two rows with the same (team, player, game)
-- and different upload_date values, breaking the source-of-truth invariant
-- "one tablet snapshot per (team, player, game)".
--
-- The application code in src/lib/scoring/server.ts already respects this
-- invariant via DELETE-by-(game_id, source='tablet') + INSERT. This index
-- enforces it at the DB level.

CREATE UNIQUE INDEX IF NOT EXISTS stat_snapshots_tablet_unique
  ON public.stat_snapshots (team_id, player_id, game_id)
  WHERE source = 'tablet';
