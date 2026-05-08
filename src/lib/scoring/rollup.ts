// Pure stat rollup over derived at-bats. The server-side replay calls this
// on game finalize and writes the result into stat_snapshots.
//
// Field names mirror what xlsx-uploaded stats use (see team/page.tsx and
// player/[id]/page.tsx for the read side) so existing readers light up
// without changes.
//
// Out of scope here: per-batter R and per-pitcher ER. Both need runner-
// origin attribution that the replay engine doesn't expose yet.

import type { AtBatResult, DerivedAtBat } from "./types";

export interface BattingLine {
  AB: number;
  H: number;
  "1B": number;
  "2B": number;
  "3B": number;
  HR: number;
  BB: number;
  SO: number;
  HBP: number;
  SF: number;
  RBI: number;
  PA: number;
  AVG: number;
  OBP: number;
  SLG: number;
  OPS: number;
}

export interface PitchingLine {
  BF: number;
  outs: number;
  IP: number; // baseball convention: e.g., 7 outs => 2.1, 9 outs => 3.0
  H: number;
  BB: number;
  SO: number;
  HR: number;
}

const HIT_RESULTS: ReadonlySet<AtBatResult> = new Set(["1B", "2B", "3B", "HR"]);
const WALK_RESULTS: ReadonlySet<AtBatResult> = new Set(["BB", "IBB"]);
const STRIKEOUT_RESULTS: ReadonlySet<AtBatResult> = new Set(["K_swinging", "K_looking"]);
// Results that don't count toward AB. PA-but-not-AB plus DP/TP which DO count
// as AB (PG-style). Note: SF and SAC are PA-but-not-AB; HBP and walks too.
const NON_AB_RESULTS: ReadonlySet<AtBatResult> = new Set([
  "BB",
  "IBB",
  "HBP",
  "SAC",
  "SF",
]);

function emptyBatting(): BattingLine {
  return {
    AB: 0, H: 0, "1B": 0, "2B": 0, "3B": 0, HR: 0,
    BB: 0, SO: 0, HBP: 0, SF: 0, RBI: 0, PA: 0,
    AVG: 0, OBP: 0, SLG: 0, OPS: 0,
  };
}

function emptyPitching(): PitchingLine {
  return { BF: 0, outs: 0, IP: 0, H: 0, BB: 0, SO: 0, HR: 0 };
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function outsToIP(outs: number): number {
  // Baseball innings-pitched convention: integer + tenths-as-thirds.
  // 7 outs => 2.1, 9 outs => 3.0, 10 outs => 3.1.
  return Math.floor(outs / 3) + (outs % 3) / 10;
}

export function rollupBatting(atBats: DerivedAtBat[]): Map<string, BattingLine> {
  const out = new Map<string, BattingLine>();
  for (const ab of atBats) {
    if (!ab.batter_id) continue; // opponent PA — not our batter
    let line = out.get(ab.batter_id);
    if (!line) {
      line = emptyBatting();
      out.set(ab.batter_id, line);
    }
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
    } else if (ab.result === "HBP") {
      line.HBP += 1;
    } else if (ab.result === "SF") {
      line.SF += 1;
    }
    line.RBI += ab.rbi ?? 0;
  }
  for (const line of out.values()) {
    line.AVG = safeDiv(line.H, line.AB);
    const obpDen = line.AB + line.BB + line.HBP + line.SF;
    line.OBP = safeDiv(line.H + line.BB + line.HBP, obpDen);
    const tb = line["1B"] + 2 * line["2B"] + 3 * line["3B"] + 4 * line.HR;
    line.SLG = safeDiv(tb, line.AB);
    line.OPS = line.OBP + line.SLG;
  }
  return out;
}

export function rollupPitching(atBats: DerivedAtBat[]): Map<string, PitchingLine> {
  const out = new Map<string, PitchingLine>();
  for (const ab of atBats) {
    if (!ab.pitcher_id) continue; // not one of our pitchers (or our half batting)
    let line = out.get(ab.pitcher_id);
    if (!line) {
      line = emptyPitching();
      out.set(ab.pitcher_id, line);
    }
    line.BF += 1;
    line.outs += ab.outs_recorded ?? 0;
    if (HIT_RESULTS.has(ab.result)) {
      line.H += 1;
      if (ab.result === "HR") line.HR += 1;
    } else if (WALK_RESULTS.has(ab.result)) {
      line.BB += 1;
    } else if (STRIKEOUT_RESULTS.has(ab.result)) {
      line.SO += 1;
    }
  }
  for (const line of out.values()) {
    line.IP = outsToIP(line.outs);
  }
  return out;
}
