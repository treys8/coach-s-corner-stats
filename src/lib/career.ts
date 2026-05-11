// Career aggregation: collapse multiple per-week snapshots into a single
// section view. Counting stats sum; key rate stats are recomputed from those
// sums (career AVG = career H / career AB, never the average of seasonal AVGs).
//
// IP is in baseball notation (7.1 = 7⅓ innings, 7.2 = 7⅔). To sum it
// correctly we convert each snapshot to outs first, sum, and convert back.

import { sectionOf, type Section, type SnapshotStats } from "@/lib/snapshots";
import { SUM_STATS } from "@/lib/aggregate";

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

function ipToOuts(ip: number): number {
  if (!Number.isFinite(ip) || ip < 0) return 0;
  const whole = Math.floor(ip);
  const frac = Math.round((ip - whole) * 10);
  return whole * 3 + (frac === 1 ? 1 : frac === 2 ? 2 : 0);
}

function outsToIp(outs: number): number {
  const whole = Math.floor(outs / 3);
  const rem = outs % 3;
  return whole + rem / 10;
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

  if (section === "batting") {
    const ab = summed.AB ?? 0;
    const h  = summed.H  ?? 0;
    const hr = summed.HR ?? 0;
    const so = summed.SO ?? 0;
    const bb = summed.BB ?? 0;
    const hbp = summed.HBP ?? 0;
    const sf = summed.SF ?? 0;
    const tb = summed.TB ?? 0;
    const pa = summed.PA ?? 0;
    const ps = summed.PS ?? 0;
    const twoS3 = summed["2S+3"] ?? 0;
    const sixPlus = summed["6+"] ?? 0;
    const sb = summed.SB ?? 0;
    const cs = summed.CS ?? 0;

    if (ab > 0) summed.AVG = h / ab;
    if (ab > 0) summed.SLG = tb / ab;
    const obpDenom = ab + bb + hbp + sf;
    if (obpDenom > 0) summed.OBP = (h + bb + hbp) / obpDenom;
    if (summed.OBP !== undefined && summed.SLG !== undefined) {
      summed.OPS = summed.OBP + summed.SLG;
    }
    const babipDen = ab - so - hr + sf;
    if (babipDen > 0) summed.BABIP = (h - hr) / babipDen;
    if (ab > 0) summed["C%"] = (ab - so) / ab;
    if (hr > 0) summed["AB/HR"] = ab / hr;
    if (so > 0) summed["BB/K"] = bb / so;
    if (pa > 0) {
      summed["PS/PA"] = ps / pa;
      summed["2S+3%"] = twoS3 / pa;
      summed["6+%"] = sixPlus / pa;
    }
    if (sb + cs > 0) summed["SB%"] = sb / (sb + cs);
  } else if (section === "pitching") {
    if (ipSeen) summed.IP = outsToIp(outsTotal);
    const ipReal = outsTotal / 3;
    const er = summed.ER ?? 0;
    const bb = summed.BB ?? 0;
    const h  = summed.H  ?? 0;
    const so = summed.SO ?? 0;

    if (ipReal > 0) summed.ERA = (er * 9) / ipReal;
    if (ipReal > 0) summed.WHIP = (bb + h) / ipReal;
    if (bb > 0) summed["K/BB"] = so / bb;
  } else if (section === "fielding") {
    const tc = summed.TC ?? 0;
    const po = summed.PO ?? 0;
    const a  = summed.A  ?? 0;
    if (tc > 0) summed.FPCT = (po + a) / tc;
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
