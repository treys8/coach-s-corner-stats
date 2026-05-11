// Leaderboard rules for the team totals page. Rate stats (AVG, ERA, etc.)
// require a minimum sample size before a player qualifies — otherwise a 1-for-1
// hitter would top the AVG board.
import { RATE_STATS } from "@/lib/aggregate";
import { sectionOf, type Section, type SnapshotStats } from "@/lib/snapshots";

export const MIN_AB = 5;
export const MIN_IP = 3;

export interface LeaderboardRow {
  player_id: string;
  value: number;
}

/**
 * Build a leaderboard for one section + stat from a map of each player's
 * latest snapshot. Rate stats apply a minimum AB / IP qualifier; counting
 * stats and unknown stats are included whenever they're a finite number.
 */
export const buildLeaderboard = (
  latestByPlayer: Record<string, { stats: SnapshotStats }>,
  section: Section,
  stat: string,
): LeaderboardRow[] => {
  const isBattingRate = section === "batting" && RATE_STATS.batting.includes(stat);
  const isPitchingRate = section === "pitching" && RATE_STATS.pitching.includes(stat);
  const rows: LeaderboardRow[] = [];
  for (const [pid, snap] of Object.entries(latestByPlayer)) {
    const block = sectionOf(snap.stats, section);
    const v = block[stat];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;

    if (isBattingRate) {
      const ab = sectionOf(snap.stats, "batting")["AB"];
      if (typeof ab !== "number" || ab < MIN_AB) continue;
    }
    if (isPitchingRate) {
      const ip = sectionOf(snap.stats, "pitching")["IP"];
      if (typeof ip !== "number" || ip < MIN_IP) continue;
    }
    rows.push({ player_id: pid, value: v });
  }
  return rows;
};

/** Human-readable note describing the qualifier (or null if no qualifier applies). */
export const qualifierNote = (section: Section, stat: string): string | null => {
  if (section === "batting" && RATE_STATS.batting.includes(stat)) return `Min ${MIN_AB} AB to qualify`;
  if (section === "pitching" && RATE_STATS.pitching.includes(stat)) return `Min ${MIN_IP} IP to qualify`;
  return null;
};
