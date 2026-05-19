// Ranking primitives for the records-page Leaderboard component. Pulled
// out of the component so the qualifier + sort behavior can be unit-tested
// without React/JSDOM.
//
// NOTE: these qualifiers (MIN_AB=50, MIN_IP=20, MIN_TC=20) gate
// SEASON-AGGREGATE leaderboards. `src/lib/team-stats.ts` has a separate,
// looser pair (MIN_AB=5, MIN_IP=3) that gates per-snapshot leaderboards
// on the team totals page. The two are intentionally distinct — please
// don't merge them.

import type { Section } from "@/lib/snapshots";
import type { PlayerSeasonAgg } from "@/lib/career";

export const TOP_N = 5;
export const MIN_AB = 50;
export const MIN_IP = 20;
export const MIN_TC = 20;

export interface BoardConfig {
  stat: string;
  /** Human label override; defaults to the stat key. */
  label?: string;
  /** Sort order: desc = high-to-low (default), asc = low-to-high. */
  dir?: "desc" | "asc";
  /** Optional minimum-counter qualifier (e.g. ≥ 50 AB for AVG). */
  qualifier?: { stat: string; min: number; note: string };
}

export const BOARDS: Record<Section, BoardConfig[]> = {
  batting: [
    { stat: "AVG", qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` } },
    { stat: "OPS", qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` } },
    { stat: "OBP", qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` } },
    { stat: "HR" },
    { stat: "RBI" },
    { stat: "H" },
    { stat: "SB" },
  ],
  pitching: [
    { stat: "ERA", dir: "asc", qualifier: { stat: "IP", min: MIN_IP, note: `Min ${MIN_IP} IP` } },
    { stat: "WHIP", dir: "asc", qualifier: { stat: "IP", min: MIN_IP, note: `Min ${MIN_IP} IP` } },
    { stat: "SO" },
    { stat: "W" },
    { stat: "IP" },
    { stat: "SV" },
  ],
  fielding: [
    { stat: "FPCT", qualifier: { stat: "TC", min: MIN_TC, note: `Min ${MIN_TC} TC` } },
    { stat: "TC" },
    { stat: "A" },
    { stat: "PO" },
    { stat: "E", dir: "asc", label: "Fewest E" },
  ],
};

/**
 * Filter to qualifying rows and sort by the target stat. Caller slices
 * `.slice(0, TOP_N)` for the visible top of the board.
 *
 * Filter rules:
 *   - the target stat must be a finite number
 *   - if a `qualifier` is set, the qualifier stat must be a finite number ≥ min
 */
export function rankLeaderboard(
  rows: PlayerSeasonAgg[],
  cfg: BoardConfig,
): PlayerSeasonAgg[] {
  const dir = cfg.dir ?? "desc";
  const filtered = rows.filter((r) => {
    const v = r.agg[cfg.stat];
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
    if (cfg.qualifier) {
      const q = r.agg[cfg.qualifier.stat];
      if (typeof q !== "number" || q < cfg.qualifier.min) return false;
    }
    return true;
  });
  return [...filtered].sort((a, b) =>
    dir === "desc" ? b.agg[cfg.stat] - a.agg[cfg.stat] : a.agg[cfg.stat] - b.agg[cfg.stat],
  );
}
