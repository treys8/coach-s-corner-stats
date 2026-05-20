// Client helpers for the manual season-archive feature. The auto May-31
// closure is computed locally from the date; manual locks live in the
// `season_locks` table and need a tiny round-trip per team.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SeasonLockRow {
  season_year: number;
  locked_at: string;
  locked_by: string | null;
}

// Fetch every manually-locked season for a team. Returns a Map keyed by
// season_year so callers can both:
//   - membership-check via `locks.has(season)` for the UI gate, and
//   - look up `locked_at` to render "closed manually on …" copy.
// Errors swallow to an empty map — the worst that happens is auto-close
// alone gates the UI (existing behavior).
export async function fetchTeamSeasonLocks(
  supabase: SupabaseClient,
  teamId: string,
): Promise<Map<number, SeasonLockRow>> {
  const { data, error } = await supabase
    .from("season_locks")
    .select("season_year, locked_at, locked_by")
    .eq("team_id", teamId);
  if (error || !data) return new Map();
  const map = new Map<number, SeasonLockRow>();
  for (const row of data as SeasonLockRow[]) {
    map.set(row.season_year, row);
  }
  return map;
}

// Convenience accessor — UI code that only needs the boolean set for
// `isSeasonLockedFor` doesn't need to drag the full row map around.
export function lockedYearsSet(locks: Map<number, SeasonLockRow>): Set<number> {
  return new Set(locks.keys());
}
