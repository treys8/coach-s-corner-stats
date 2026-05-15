// Per-pitcher stat rollup.
//
// R/ER (PDF §17): R is credited to whichever pitcher put the scoring
// runner on base (inherited-runner attribution via source-base
// pitcher_of_record_id). ER excludes runs from runners tainted with
// reached_on_error (PDF §17 criteria 1, 2, 4) and from non-PA events
// sourced from passed_ball or error_advance. WP, balk, and SB-home runs
// stay earned (PDF §14, §23.5).

import type { AtBatResult, DerivedAtBat, NonPaRunSource, ReplayState, RunnerAdvance } from "../types";

export interface PitchingLine {
  BF: number;
  outs: number;
  IP: number; // baseball convention: e.g., 7 outs => 2.1, 9 outs => 3.0
  H: number;
  BB: number;
  SO: number;
  HR: number;
  R: number;
  ER: number;
  ERA: number;
  WHIP: number;
  pitches: number;
  strikes_thrown: number;
  balls_thrown: number;
  strike_pct: number;
  /** PDF §18-19. Set on exactly one pitcher per game (or none if tied). */
  W: number;
  L: number;
  SV: number;
}

const HIT_RESULTS: ReadonlySet<AtBatResult> = new Set(["1B", "2B", "3B", "HR"]);
const WALK_RESULTS: ReadonlySet<AtBatResult> = new Set(["BB", "IBB"]);
const STRIKEOUT_RESULTS: ReadonlySet<AtBatResult> = new Set(["K_swinging", "K_looking"]);

// Non-PA event sources whose runs are EARNED (charged to pitcher's ER).
// Per PDF §14 (WP=earned, PB=unearned), §17 (errors=unearned), §23.5
// (balks=earned), §8 (SB-home=earned). advance_on_throw is a judgment-
// call advance with no error charged — also earned.
const EARNED_NON_PA_SOURCES: ReadonlySet<NonPaRunSource> = new Set([
  "wild_pitch",
  "balk",
  "stolen_base",
  "advance_on_throw",
]);

function emptyPitching(): PitchingLine {
  return {
    BF: 0, outs: 0, IP: 0, H: 0, BB: 0, SO: 0, HR: 0,
    R: 0, ER: 0, ERA: 0, WHIP: 0,
    pitches: 0, strikes_thrown: 0, balls_thrown: 0, strike_pct: 0,
    W: 0, L: 0, SV: 0,
  };
}

function outsToIP(outs: number): number {
  // Baseball innings-pitched convention: integer + tenths-as-thirds.
  // 7 outs => 2.1, 9 outs => 3.0, 10 outs => 3.1.
  return Math.floor(outs / 3) + (outs % 3) / 10;
}

export function rollupPitching(
  atBats: DerivedAtBat[],
  nonPaRuns: ReplayState["non_pa_runs"] = [],
): Map<string, PitchingLine> {
  const out = new Map<string, PitchingLine>();
  const ensure = (id: string): PitchingLine => {
    let line = out.get(id);
    if (!line) {
      line = emptyPitching();
      out.set(id, line);
    }
    return line;
  };
  for (const ab of atBats) {
    if (!ab.pitcher_id) continue; // not one of our pitchers (or our half batting)
    const line = ensure(ab.pitcher_id);
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
    // R / ER: each scoring runner is charged to the pitcher who put them
    // on base (inherited-runner attribution per PDF §17). ER excludes
    // runners tainted with reached_on_error (PDF §17 criteria 1, 2, 4).
    for (const adv of (ab.runner_advances ?? [])) {
      const cls = classifyScoringRunner(ab, adv);
      if (!cls || !cls.pitcher_id) continue;
      const runnerLine = ensure(cls.pitcher_id);
      runnerLine.R += 1;
      if (cls.earned) runnerLine.ER += 1;
    }

    // Pitch trail: count pitches and classify strikes/balls.
    for (const pitch of ab.pitches ?? []) {
      line.pitches += 1;
      if (
        pitch.pitch_type === "ball"
        || pitch.pitch_type === "pitchout"
        || pitch.pitch_type === "intentional_ball"
      ) {
        line.balls_thrown += 1;
      } else if (
        pitch.pitch_type === "called_strike"
        || pitch.pitch_type === "swinging_strike"
        || pitch.pitch_type === "foul"
        || pitch.pitch_type === "foul_tip_caught"
        || pitch.pitch_type === "in_play"
      ) {
        line.strikes_thrown += 1;
      }
    }
  }
  // Non-PA runs: R is always credited; ER only when the source is in
  // EARNED_NON_PA_SOURCES (WP, balk, SB-home). Stage 6b: a run scored
  // at-or-after the phantom 3rd out (OSR 9.16) is unearned regardless of
  // source.
  for (const npr of nonPaRuns) {
    if (!npr.pitcher_id || npr.runs <= 0) continue;
    const line = ensure(npr.pitcher_id);
    line.R += npr.runs;
    if (EARNED_NON_PA_SOURCES.has(npr.source) && !npr.after_phantom_third_out) {
      line.ER += npr.runs;
    }
  }
  for (const line of out.values()) {
    line.IP = outsToIP(line.outs);
    // ERA is per 9 innings; WHIP is walks+hits per inning.
    const innings = line.outs / 3;
    line.ERA = innings > 0 ? (line.ER * 9) / innings : 0;
    line.WHIP = innings > 0 ? (line.BB + line.H) / innings : 0;
    line.strike_pct = line.pitches > 0 ? line.strikes_thrown / line.pitches : 0;
  }
  return out;
}

// Classify a scoring runner from an at-bat advance: who is the pitcher
// of record (for inherited-runner attribution), and is the run earned?
//   - Batter scoring (HR, etc.): use this PA's pitcher_of_record;
//     unearned if the batter himself reached on an error.
//   - Existing runner: use bases_before[from] for both the pitcher and
//     the reached_on_error taint.
//   - K3 with dropped strike on PB or E: ALL runs on the play are
//     unearned (PDF §17 #2/#4) — without the error/PB, the K would
//     have ended the play and no run would have scored.
//   - Stage 6b: any PA flagged `after_phantom_third_out` by OSR 9.16
//     reconstruction is unearned regardless of taint, since the inning
//     would have already ended in the error-free version.
function classifyScoringRunner(
  ab: DerivedAtBat,
  adv: RunnerAdvance,
): { pitcher_id: string | null; earned: boolean } | null {
  if (adv.to !== "home") return null;
  const k3DroppedTaint =
    ab.batter_reached_on_k3 === "E" || ab.batter_reached_on_k3 === "PB";
  const phantomTaint = ab.after_phantom_third_out === true;
  if (adv.from === "batter") {
    const batterReachedOnError = ab.result === "E" || k3DroppedTaint;
    return {
      pitcher_id: ab.pitcher_of_record_id,
      earned: !batterReachedOnError && !phantomTaint,
    };
  }
  const src = ab.bases_before[adv.from];
  if (!src) {
    // Defensive fallback: source base unexpectedly empty. Credit current
    // PA pitcher; assume earned unless this PA was K3-dropped or past
    // phantom 3rd out.
    return {
      pitcher_id: ab.pitcher_of_record_id,
      earned: !k3DroppedTaint && !phantomTaint,
    };
  }
  return {
    pitcher_id: src.pitcher_of_record_id,
    earned: !src.reached_on_error && !k3DroppedTaint && !phantomTaint,
  };
}
