// Pitcher workload analysis across games. Operates on stat_snapshots
// rows (the persisted per-game pitcher line, see server.ts) and a
// pitch-limit config to answer: is this pitcher eligible to pitch today?
//
// Source of truth for per-game pitch totals is `stats.pitching.pitches`
// in stat_snapshots (set by Phase E's rollupPitching). NFHS Rule 6-2-6
// and PDF §28.8: rest days are mandatory based on pitches thrown that day.

import { DEFAULT_HIGH_SCHOOL_LIMITS, restDaysFor } from "./pitch-limits";
import type { PitchLimitsConfig } from "./pitch-limits";

/** A single per-game pitching snapshot row, stripped to fields we need. */
export interface PitcherWorkloadSnapshot {
  /** ISO date (YYYY-MM-DD) of the game. */
  game_date: string;
  /** Pitches thrown in that game. */
  pitches: number;
}

export interface PitcherWorkloadResult {
  /** Pitches thrown today (asOf date). */
  pitches_today: number;
  /** Most recent prior outing's date, if any. */
  last_outing_date: string | null;
  /** Pitches thrown in the most recent prior outing. */
  last_outing_pitches: number;
  /** Days of rest required from the last outing (per limits config). */
  required_rest_days: number;
  /** Days actually elapsed since last outing (asOf - last_outing_date). */
  elapsed_days: number | null;
  /** True if pitcher is currently INELIGIBLE based on rest days. */
  rest_violation: boolean;
  /** Pitches remaining today before hitting daily max. */
  pitches_remaining_today: number;
}

/**
 * Compute a pitcher's workload state given their snapshot history and
 * the current date. Pure function; consumes pre-fetched snapshots.
 */
export function computePitcherWorkload(
  snapshots: PitcherWorkloadSnapshot[],
  asOfDate: string,
  config: PitchLimitsConfig = DEFAULT_HIGH_SCHOOL_LIMITS,
): PitcherWorkloadResult {
  // Sum pitches per date across snapshots (in case of multiple per day).
  const byDate = new Map<string, number>();
  for (const s of snapshots) {
    byDate.set(s.game_date, (byDate.get(s.game_date) ?? 0) + s.pitches);
  }
  const todayPitches = byDate.get(asOfDate) ?? 0;
  // Last outing = most recent date strictly before asOf with non-zero pitches.
  const priorDates = [...byDate.entries()]
    .filter(([date, p]) => date < asOfDate && p > 0)
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
  const lastOuting = priorDates[0] ?? null;
  const lastDate = lastOuting?.[0] ?? null;
  const lastPitches = lastOuting?.[1] ?? 0;
  const required = lastPitches > 0 ? restDaysFor(lastPitches, config) : 0;
  const elapsed = lastDate ? daysBetween(lastDate, asOfDate) : null;
  const restViolation = elapsed !== null && elapsed < required;
  return {
    pitches_today: todayPitches,
    last_outing_date: lastDate,
    last_outing_pitches: lastPitches,
    required_rest_days: required,
    elapsed_days: elapsed,
    rest_violation: restViolation,
    pitches_remaining_today: Math.max(0, config.max_pitches_per_day - todayPitches),
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / (1000 * 60 * 60 * 24)));
}
