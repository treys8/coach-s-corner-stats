-- Atomic tablet stat_snapshots replace.
--
-- Before: rederive() in src/lib/scoring/server.ts deleted every tablet row
-- for a game and then issued a separate INSERT with the rebuilt per-player
-- rollups. The two calls weren't wrapped in a transaction, so a transient
-- network failure or a CHECK violation on the insert left the game's tablet
-- snapshots wiped — and the rows stayed wiped until the next correction or
-- finalize event triggered another replace pass. Final box scores silently
-- vanished from the team's stats page.
--
-- After: this RPC folds the DELETE and INSERT into one Postgres transaction.
-- Either the prior rows are replaced with the new rollup or nothing changes;
-- partial failure can't strand the table in the wiped-but-not-rebuilt state.
--
-- The RPC has no auth.uid() check because the only caller is rederive() via
-- the admin (service_role) client, which is invoked after the API route has
-- already authenticated and authorized the user. Stat_snapshots' RLS policy
-- is bypassed by service_role anyway; the function exists purely to wrap two
-- writes in one transaction.

CREATE OR REPLACE FUNCTION public.replace_tablet_stat_snapshots(
  p_game_id     UUID,
  p_team_id     UUID  DEFAULT NULL,
  p_upload_date DATE  DEFAULT NULL,
  p_rows        JSONB DEFAULT '[]'::jsonb  -- array of { player_id: UUID, stats: JSONB }
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.stat_snapshots
   WHERE game_id = p_game_id AND source = 'tablet';

  -- The un-finalize / draft case calls this with p_rows = '[]' to clear
  -- stale tablet snapshots without rebuilding. Skip the insert in that
  -- case; the delete-only path is the same atomic transaction.
  IF p_rows IS NOT NULL AND jsonb_array_length(p_rows) > 0 THEN
    IF p_team_id IS NULL OR p_upload_date IS NULL THEN
      RAISE EXCEPTION 'p_team_id and p_upload_date are required when p_rows is non-empty';
    END IF;

    INSERT INTO public.stat_snapshots (
      team_id, player_id, upload_date, game_id, source, upload_id, stats
    )
    SELECT
      p_team_id,
      (r->>'player_id')::UUID,
      p_upload_date,
      p_game_id,
      'tablet',
      NULL,
      r->'stats'
    FROM jsonb_array_elements(p_rows) r;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_tablet_stat_snapshots(
  UUID, UUID, DATE, JSONB
) TO service_role;
