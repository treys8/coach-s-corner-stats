// Per-batter stat rollup over derived at-bats. The server-side replay
// calls this on game finalize and writes the result into stat_snapshots.
//
// Field names mirror what xlsx-uploaded stats use (see team/page.tsx and
// player/[id]/page.tsx for the read side) so existing readers light up
// without changes.

import type { AtBatResult, Base, Bases, DerivedAtBat, PitchPayload, RunnerAdvance } from "../types";
import { safeDiv } from "./shared";

export interface BattingLine {
  AB: number;
  H: number;
  "1B": number;
  "2B": number;
  "3B": number;
  HR: number;
  BB: number;
  SO: number;
  "K-L": number;
  HBP: number;
  SF: number;
  /** Sacrifice bunt — counted separately from SF; both are PA-not-AB. */
  SH: number;
  /** Catcher's interference — PA-not-AB; batter awarded first base. */
  CI: number;
  ROE: number;
  FC: number;
  GIDP: number;
  GITP: number;
  RBI: number;
  R: number;
  PA: number;
  TB: number;
  XBH: number;
  PS: number;
  "2S+3": number;
  "6+": number;
  LOB: number;
  "2OUTRBI": number;
  SB: number;
  CS: number;
  PIK: number;
  AVG: number;
  OBP: number;
  SLG: number;
  OPS: number;
  BABIP: number;
  "BA/RISP": number;
  "BB/K": number;
  "C%": number;
  "PS/PA": number;
  "2S+3%": number;
  "6+%": number;
  "SB%": number;
  "AB/HR": number;
}

/** Per-runner running-event log surfaced from ReplayState. Optional —
 *  callers that only have at_bats can omit it and SB/CS/PIK will be 0. */
export interface RunnerEventLog {
  stolen_bases: { runner_id: string | null }[];
  caught_stealing: { runner_id: string | null }[];
  pickoffs: { runner_id: string | null }[];
}

const EMPTY_RUNNER_EVENTS: RunnerEventLog = {
  stolen_bases: [],
  caught_stealing: [],
  pickoffs: [],
};

const HIT_RESULTS: ReadonlySet<AtBatResult> = new Set(["1B", "2B", "3B", "HR"]);
const WALK_RESULTS: ReadonlySet<AtBatResult> = new Set(["BB", "IBB"]);
const STRIKEOUT_RESULTS: ReadonlySet<AtBatResult> = new Set(["K_swinging", "K_looking"]);
// Results that don't count toward AB. PA-but-not-AB plus DP/TP which DO count
// as AB (PG-style). PDF §3: BB/IBB/HBP/SAC/SF/CI all count as PA, not AB.
const NON_AB_RESULTS: ReadonlySet<AtBatResult> = new Set([
  "BB",
  "IBB",
  "HBP",
  "SAC",
  "SF",
  "CI",
]);

function emptyBatting(): BattingLine {
  return {
    AB: 0, H: 0, "1B": 0, "2B": 0, "3B": 0, HR: 0,
    BB: 0, SO: 0, "K-L": 0, HBP: 0, SF: 0, SH: 0, CI: 0,
    ROE: 0, FC: 0, GIDP: 0, GITP: 0,
    RBI: 0, R: 0, PA: 0,
    TB: 0, XBH: 0,
    PS: 0, "2S+3": 0, "6+": 0,
    LOB: 0, "2OUTRBI": 0,
    SB: 0, CS: 0, PIK: 0,
    AVG: 0, OBP: 0, SLG: 0, OPS: 0,
    BABIP: 0, "BA/RISP": 0, "BB/K": 0, "C%": 0,
    "PS/PA": 0, "2S+3%": 0, "6+%": 0, "SB%": 0, "AB/HR": 0,
  };
}

export function rollupBatting(
  atBats: DerivedAtBat[],
  runnerEvents: RunnerEventLog = EMPTY_RUNNER_EVENTS,
): Map<string, BattingLine> {
  const out = new Map<string, BattingLine>();
  const ensure = (id: string): BattingLine => {
    let line = out.get(id);
    if (!line) {
      line = emptyBatting();
      out.set(id, line);
    }
    return line;
  };

  // Per-batter RISP accumulators (kept out of BattingLine since we don't
  // surface H_RISP / AB_RISP individually).
  const rispH = new Map<string, number>();
  const rispAB = new Map<string, number>();
  const incRisp = (id: string, h: number, ab: number) => {
    rispH.set(id, (rispH.get(id) ?? 0) + h);
    rispAB.set(id, (rispAB.get(id) ?? 0) + ab);
  };

  // Half-tracking for LOB / 2OUTRBI. We walk PAs in order; at each PA we
  // know `outs_in_half` BEFORE applying this PA's outs (gives outs_before
  // for 2OUTRBI). When the half changes between consecutive PAs OR the
  // post-PA outs reach 3, the half-ending PA's batter is credited with
  // any runners still on base.
  let halfKey: string | null = null;
  let outsInHalf = 0;
  let lastBatterIdInHalf: string | null = null;
  let lastRunnersOnAfter = 0;

  for (let i = 0; i < atBats.length; i++) {
    const ab = atBats[i];
    const thisHalfKey = `${ab.inning}-${ab.half}`;
    if (thisHalfKey !== halfKey) {
      // New half started. If the previous half ended without hitting 3
      // outs (walk-off / game end), flush its LOB now.
      if (halfKey !== null && lastBatterIdInHalf && lastRunnersOnAfter > 0 && outsInHalf < 3) {
        ensure(lastBatterIdInHalf).LOB += lastRunnersOnAfter;
      }
      halfKey = thisHalfKey;
      outsInHalf = 0;
      lastBatterIdInHalf = null;
      lastRunnersOnAfter = 0;
    }

    const outsBefore = outsInHalf;
    const advances = ab.runner_advances ?? [];
    const runnersOnAfter = countRunnersAfter(ab.bases_before, advances);

    if (ab.batter_id) {
      const line = ensure(ab.batter_id);
      line.PA += 1;
      if (!NON_AB_RESULTS.has(ab.result)) line.AB += 1;
      if (HIT_RESULTS.has(ab.result)) {
        line.H += 1;
        if (ab.result === "1B") line["1B"] += 1;
        else if (ab.result === "2B") line["2B"] += 1;
        else if (ab.result === "3B") line["3B"] += 1;
        else if (ab.result === "HR") line.HR += 1;
      } else if (WALK_RESULTS.has(ab.result)) {
        line.BB += 1;
      } else if (STRIKEOUT_RESULTS.has(ab.result)) {
        line.SO += 1;
        if (ab.result === "K_looking") line["K-L"] += 1;
      } else if (ab.result === "HBP") {
        line.HBP += 1;
      } else if (ab.result === "SF") {
        line.SF += 1;
      } else if (ab.result === "SAC") {
        line.SH += 1;
      } else if (ab.result === "CI") {
        line.CI += 1;
      } else if (ab.result === "E") {
        line.ROE += 1;
      } else if (ab.result === "FC") {
        line.FC += 1;
      } else if (ab.result === "DP") {
        line.GIDP += 1;
      } else if (ab.result === "TP") {
        line.GITP += 1;
      }
      line.RBI += ab.rbi ?? 0;

      // Pitch-discipline counts derived from the per-PA trail.
      const pitches = ab.pitches ?? [];
      line.PS += pitches.length;
      if (pitches.length >= 6) line["6+"] += 1;
      if (sawThreePitchesAfterTwoStrikes(pitches)) line["2S+3"] += 1;

      // RISP at the start of the PA.
      const onSecond = ab.bases_before?.second != null;
      const onThird = ab.bases_before?.third != null;
      if (onSecond || onThird) {
        const isHit = HIT_RESULTS.has(ab.result);
        const isAB = !NON_AB_RESULTS.has(ab.result);
        incRisp(ab.batter_id, isHit ? 1 : 0, isAB ? 1 : 0);
      }

      if (outsBefore === 2) {
        line["2OUTRBI"] += ab.rbi ?? 0;
      }

      lastBatterIdInHalf = ab.batter_id;
    } else {
      // Opposing-team PA — don't credit LOB to anyone on our side, but
      // still track half-end transitions.
      lastBatterIdInHalf = null;
    }
    lastRunnersOnAfter = runnersOnAfter;

    outsInHalf += ab.outs_recorded ?? 0;
    if (outsInHalf >= 3) {
      // Half ended via the 3rd out on this PA. Credit LOB to the batter
      // who made the half-ending out, if any runners are still on.
      if (lastBatterIdInHalf && runnersOnAfter > 0) {
        ensure(lastBatterIdInHalf).LOB += runnersOnAfter;
      }
      // Reset so subsequent same-half PAs (shouldn't exist, but defensive)
      // don't double-credit.
      lastBatterIdInHalf = null;
      lastRunnersOnAfter = 0;
    }

    // R per scoring runner: an advance with to='home' credits the runner
    // who scored. Independent of who batted — a runner advanced by another
    // batter's hit gets the R, the batter gets the RBI.
    for (const adv of advances) {
      if (adv.to !== "home" || !adv.player_id) continue;
      ensure(adv.player_id).R += 1;
    }
  }

  // Trailing flush: the game ended (or the at_bats array did) with a half
  // still open and runners on. Credit LOB to that half's last batter.
  if (lastBatterIdInHalf && lastRunnersOnAfter > 0 && outsInHalf < 3) {
    ensure(lastBatterIdInHalf).LOB += lastRunnersOnAfter;
  }

  // Per-runner SB / CS / PIK from the non-PA event log.
  for (const ev of runnerEvents.stolen_bases) {
    if (ev.runner_id) ensure(ev.runner_id).SB += 1;
  }
  for (const ev of runnerEvents.caught_stealing) {
    if (ev.runner_id) ensure(ev.runner_id).CS += 1;
  }
  for (const ev of runnerEvents.pickoffs) {
    if (ev.runner_id) ensure(ev.runner_id).PIK += 1;
  }

  for (const [id, line] of out.entries()) {
    line.TB = line["1B"] + 2 * line["2B"] + 3 * line["3B"] + 4 * line.HR;
    line.XBH = line["2B"] + line["3B"] + line.HR;
    line.AVG = safeDiv(line.H, line.AB);
    const obpDen = line.AB + line.BB + line.HBP + line.SF;
    line.OBP = safeDiv(line.H + line.BB + line.HBP, obpDen);
    line.SLG = safeDiv(line.TB, line.AB);
    line.OPS = line.OBP + line.SLG;
    line.BABIP = safeDiv(line.H - line.HR, line.AB - line.SO - line.HR + line.SF);
    line["BA/RISP"] = safeDiv(rispH.get(id) ?? 0, rispAB.get(id) ?? 0);
    line["BB/K"] = safeDiv(line.BB, line.SO);
    line["C%"] = safeDiv(line.AB - line.SO, line.AB);
    line["PS/PA"] = safeDiv(line.PS, line.PA);
    line["2S+3%"] = safeDiv(line["2S+3"], line.PA);
    line["6+%"] = safeDiv(line["6+"], line.PA);
    line["SB%"] = safeDiv(line.SB, line.SB + line.CS);
    line["AB/HR"] = safeDiv(line.AB, line.HR);
  }
  return out;
}

/** Count runners on base after applying `advances` to `before`. A runner
 *  whose `to` is "home" or "out" is removed; one whose `to` is a base is
 *  on that base; the batter (from="batter") only adds if their `to` is
 *  a base. Runners present in `before` but absent from `advances` stay
 *  on their original base. */
function countRunnersAfter(before: Bases | null | undefined, advances: RunnerAdvance[]): number {
  const movedFromBase = new Set<Base>();
  let count = 0;
  for (const adv of advances) {
    if (adv.from === "batter") {
      if (adv.to !== "home" && adv.to !== "out") count += 1;
    } else {
      movedFromBase.add(adv.from);
      if (adv.to !== "home" && adv.to !== "out") count += 1;
    }
  }
  if (before) {
    for (const base of ["first", "second", "third"] as const) {
      if (before[base] && !movedFromBase.has(base)) count += 1;
    }
  }
  return count;
}

/** Per-PA pitch-discipline flag: did the batter see 3 or more pitches
 *  AFTER first reaching a 2-strike count? Mirrors the count-from-pitches
 *  rules in replay.ts (fouls only add to strikes when strikes < 2). */
function sawThreePitchesAfterTwoStrikes(pitches: PitchPayload[]): boolean {
  let strikes = 0;
  let pitchesAfterTwoStrikes = 0;
  for (const p of pitches) {
    if (strikes >= 2) pitchesAfterTwoStrikes += 1;
    if (
      p.pitch_type === "called_strike"
      || p.pitch_type === "swinging_strike"
      || p.pitch_type === "foul_tip_caught"
    ) {
      strikes += 1;
    } else if (p.pitch_type === "foul") {
      if (strikes < 2) strikes += 1;
    }
  }
  return pitchesAfterTwoStrikes >= 3;
}
