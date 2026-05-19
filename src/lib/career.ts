// Career aggregation: collapse multiple per-week snapshots into a single
// section view. Counting stats sum; key rate stats are recomputed from those
// sums (career AVG = career H / career AB, never the average of seasonal AVGs).
//
// IP is in baseball notation (7.1 = 7⅓ innings, 7.2 = 7⅔). To sum it
// correctly we convert each snapshot to outs first, sum, and convert back.

import { sectionOf, type Section, type SnapshotStats } from "@/lib/snapshots";
import { SUM_STATS } from "@/lib/aggregate";
import { deriveBattingRates, safeDiv } from "@/lib/stats/derived";
import {
  eraFromOuts,
  ipToOuts,
  outsToIp,
  whipFromOuts,
} from "@/lib/stats/innings-pitched";

export type SectionAgg = Record<string, number>;

export interface CareerSnapshotInput {
  upload_date: string;
  stats: SnapshotStats;
}

export interface SeasonSnapshotInput extends CareerSnapshotInput {
  season_year: number;
}

export interface PlayerSeasonSnapshotInput extends SeasonSnapshotInput {
  player_id: string;
}

export interface SeasonAgg {
  season_year: number;
  agg: SectionAgg;
}

export interface PlayerSeasonAgg {
  player_id: string;
  season_year: number;
  agg: SectionAgg;
}

/**
 * Sum the counting stats and recompute key rate stats for one section
 * across the given snapshots. Snapshots from any season are folded
 * together; the caller can pre-filter if it wants a single-season view.
 */
export function aggregateCareer(
  snapshots: CareerSnapshotInput[],
  section: Section,
): SectionAgg {
  const summed: SectionAgg = {};
  let outsTotal = 0;
  let ipSeen = false;

  for (const snap of snapshots) {
    const block = sectionOf(snap.stats, section);
    for (const [k, v] of Object.entries(block)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (k === "IP" && section === "pitching") {
        outsTotal += ipToOuts(v);
        ipSeen = true;
        continue;
      }
      if (SUM_STATS[section].has(k)) {
        summed[k] = (summed[k] ?? 0) + v;
      }
    }
  }

  // Rates are only emitted when the section actually has data — keeps the
  // returned object empty for a "no batting" career (pure pitcher etc.) so
  // the UI can fall back to its empty-state hint.
  if (section === "batting" && (summed.AB ?? 0) > 0) {
    const rates = deriveBattingRates({
      AB: summed.AB ?? 0,
      H: summed.H ?? 0,
      HR: summed.HR ?? 0,
      SO: summed.SO ?? 0,
      BB: summed.BB ?? 0,
      HBP: summed.HBP ?? 0,
      SF: summed.SF ?? 0,
      TB: summed.TB ?? 0,
      PA: summed.PA ?? 0,
      PS: summed.PS ?? 0,
      "2S+3": summed["2S+3"] ?? 0,
      "6+": summed["6+"] ?? 0,
      SB: summed.SB ?? 0,
      CS: summed.CS ?? 0,
    });
    summed.AVG = rates.AVG;
    summed.OBP = rates.OBP;
    summed.SLG = rates.SLG;
    summed.OPS = rates.OPS;
    summed.BABIP = rates.BABIP;
    summed["C%"] = rates["C%"];
    summed["BB/K"] = rates["BB/K"];
    summed["AB/HR"] = rates["AB/HR"];
    summed["PS/PA"] = rates["PS/PA"];
    summed["2S+3%"] = rates["2S+3%"];
    summed["6+%"] = rates["6+%"];
    summed["SB%"] = rates["SB%"];
  } else if (section === "pitching" && outsTotal > 0) {
    if (ipSeen) summed.IP = outsToIp(outsTotal);
    summed.ERA = eraFromOuts(summed.ER ?? 0, outsTotal);
    summed.WHIP = whipFromOuts((summed.BB ?? 0) + (summed.H ?? 0), outsTotal);
    if ((summed.BB ?? 0) > 0) summed["K/BB"] = safeDiv(summed.SO ?? 0, summed.BB);
  } else if (section === "fielding" && (summed.TC ?? 0) > 0) {
    summed.FPCT = safeDiv((summed.PO ?? 0) + (summed.A ?? 0), summed.TC);
  }

  return summed;
}

/**
 * Group snapshots by season_year and aggregate each season independently
 * via aggregateCareer. Returns rows sorted by season ascending.
 */
export function aggregateBySeason(
  snapshots: SeasonSnapshotInput[],
  section: Section,
): SeasonAgg[] {
  const byYear = new Map<number, SeasonSnapshotInput[]>();
  for (const s of snapshots) {
    if (!byYear.has(s.season_year)) byYear.set(s.season_year, []);
    byYear.get(s.season_year)!.push(s);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season_year, list]) => ({
      season_year,
      agg: aggregateCareer(list, section),
    }));
}

/**
 * Group snapshots by (player_id, season_year) and aggregate each bucket via
 * aggregateCareer. One row per player-season — used to rank single-season
 * performances across all players for season-records leaderboards.
 */
export function aggregatePlayerSeasons(
  snapshots: PlayerSeasonSnapshotInput[],
  section: Section,
): PlayerSeasonAgg[] {
  const buckets = new Map<string, PlayerSeasonSnapshotInput[]>();
  for (const s of snapshots) {
    const key = `${s.player_id}|${s.season_year}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(s);
  }
  const rows: PlayerSeasonAgg[] = [];
  for (const [key, list] of buckets) {
    const [player_id, yearStr] = key.split("|");
    rows.push({
      player_id,
      season_year: Number(yearStr),
      agg: aggregateCareer(list, section),
    });
  }
  return rows;
}
