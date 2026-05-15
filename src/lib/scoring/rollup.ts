// Pure stat rollup over derived at-bats. The server-side replay calls this
// on game finalize and writes the result into stat_snapshots.
//
// Field names mirror what xlsx-uploaded stats use (see team/page.tsx and
// player/[id]/page.tsx for the read side) so existing readers light up
// without changes.
//
// R/ER (PDF §17): R is credited to whichever pitcher put the scoring
// runner on base (inherited-runner attribution via source-base
// pitcher_of_record_id). ER excludes runs from runners tainted with
// reached_on_error (PDF §17 criteria 1, 2, 4) and from non-PA events
// sourced from passed_ball or error_advance. WP, balk, and SB-home runs
// stay earned (PDF §14, §23.5).

import type { AtBatResult, Base, Bases, DerivedAtBat, NonPaRunSource, PitchPayload, ReplayState, RunnerAdvance } from "./types";

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

function emptyPitching(): PitchingLine {
  return {
    BF: 0, outs: 0, IP: 0, H: 0, BB: 0, SO: 0, HR: 0,
    R: 0, ER: 0, ERA: 0, WHIP: 0,
    pitches: 0, strikes_thrown: 0, balls_thrown: 0, strike_pct: 0,
    W: 0, L: 0, SV: 0,
  };
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function outsToIP(outs: number): number {
  // Baseball innings-pitched convention: integer + tenths-as-thirds.
  // 7 outs => 2.1, 9 outs => 3.0, 10 outs => 3.1.
  return Math.floor(outs / 3) + (outs % 3) / 10;
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

// ---- Fielding rollup ------------------------------------------------------
//
// Phase A captured PO/E/DP/TP against the primary `fielder_position`.
// Stage 3 (v2 live scoring) adds drag-chain capture: when `fielder_chain`
// is present on the at_bat, the rollup credits A on every non-terminal
// step and PO on the terminal step (PO collapses to A when the play
// didn't retire anyone). `error_step_index` pulls a single step out of
// the A/PO line and credits it as E. Legacy events without a chain still
// flow through the `fielder_position` path.

export interface FieldingLine {
  TC: number;
  A: number;
  PO: number;
  E: number;
  DP: number;
  TP: number;
  PB: number;
  SB: number;
  SBATT: number;
  CS: number;
  PIK: number;
  CI: number;
  /** Per-position innings (decimal, sum-friendly: outs / 3). Cleanly
   *  additive across games unlike baseball-thirds notation. */
  P: number;
  C: number;
  "1B": number;
  "2B": number;
  "3B": number;
  SS: number;
  LF: number;
  CF: number;
  RF: number;
  Total: number;
  FPCT: number;
  "CS%": number;
}

export interface CatcherEventLog {
  stolen_bases: { catcher_id: string | null }[];
  /** caught_stealing entries may carry a `fielder_chain_player_ids`
   *  snapshot — when present rollupFielding credits A on every non-terminal
   *  step and PO on the terminal step. Catcher CS credit is independent
   *  and lands via `catcher_id`. */
  caught_stealing: {
    catcher_id: string | null;
    fielder_chain_player_ids?: (string | null)[];
  }[];
  pickoffs: {
    catcher_id: string | null;
    fielder_chain_player_ids?: (string | null)[];
  }[];
  passed_balls: { catcher_id: string | null }[];
  /** Between-PA error_advance events with the fielder credited for the
   *  error already resolved. Each entry adds +1 E to the named fielder. */
  error_advance_fielders?: { fielder_player_id: string }[];
}

const FIELDING_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
type FieldingPositionKey = typeof FIELDING_POSITIONS[number];

function emptyFielding(): FieldingLine {
  return {
    TC: 0, A: 0, PO: 0, E: 0, DP: 0, TP: 0,
    PB: 0, SB: 0, SBATT: 0, CS: 0, PIK: 0, CI: 0,
    P: 0, C: 0, "1B": 0, "2B": 0, "3B": 0,
    SS: 0, LF: 0, CF: 0, RF: 0,
    Total: 0,
    FPCT: 0, "CS%": 0,
  };
}

const PUTOUT_FIELDER_RESULTS: ReadonlySet<AtBatResult> = new Set([
  "FO", "GO", "LO", "PO", "IF",
]);

// Credit A on every non-terminal step of a CS/PO fielder chain and PO on
// the terminal step. CS and PO always produce an out, so the terminal
// step is always a putout — no chain-ends-without-out branch like at-bats
// have. Catcher-specific CS/PIK credit is independent and handled by
// the caller.
function creditRunningEventChain(
  chainIds: (string | null)[] | undefined,
  ensure: (id: string) => FieldingLine,
): void {
  if (!chainIds || chainIds.length === 0) return;
  const lastIdx = chainIds.length - 1;
  for (let i = 0; i < chainIds.length; i++) {
    const pid = chainIds[i];
    if (!pid) continue;
    if (i === lastIdx) ensure(pid).PO += 1;
    else ensure(pid).A += 1;
  }
}

/**
 * Compute per-player fielding lines from the replay state.
 *
 * Credits (Stage 3):
 *   - K_swinging/K_looking → catcher PO (unless batter reached on K3).
 *   - CI → catcher CI.
 *   - With `fielder_chain` present: A on every non-terminal step, PO on
 *     terminal step (collapses to A when no out was recorded); the step at
 *     `error_step_index` swaps PO/A for E. DP/TP overlay still credits
 *     primary fielder for the column count.
 *   - Without `fielder_chain` (legacy): PO on primary for FO/GO/LO/PO/IF,
 *     E on primary for result === "E", DP/TP on primary for those results.
 *   - PB / SB / CS / PIK: catcher recorded at event time.
 *   - SBATT = SB + CS. TC = PO + A + E. FPCT = (PO + A) / TC.
 *   - CS% = CS / (SB + CS). Per-position innings: outs / 3.
 */
export function rollupFielding(
  atBats: DerivedAtBat[],
  innings: { [player_id: string]: { [position: string]: number } },
  catcherEvents: CatcherEventLog,
): Map<string, FieldingLine> {
  const out = new Map<string, FieldingLine>();
  const ensure = (id: string): FieldingLine => {
    let line = out.get(id);
    if (!line) {
      line = emptyFielding();
      out.set(id, line);
    }
    return line;
  };

  // Per-position innings + total from the outs ledger.
  for (const [playerId, byPos] of Object.entries(innings)) {
    const line = ensure(playerId);
    let total = 0;
    for (const pos of FIELDING_POSITIONS) {
      const outs = byPos[pos] ?? 0;
      if (outs > 0) {
        line[pos] = outs / 3;
        total += outs / 3;
      }
    }
    line.Total = total;
  }

  // PO / E / DP / TP / CI from at_bats. Snapshot fields on DerivedAtBat
  // (`fielder_player_id`, `catcher_player_id`) are populated by replay
  // only when we were fielding, so we don't credit a player we don't
  // roster. Strikeouts and catcher's interference credit the catcher;
  // batted-ball outs credit the primary fielder.
  for (const ab of atBats) {
    if (STRIKEOUT_RESULTS.has(ab.result)) {
      // Uncaught K3 (batter_reached_on_k3 set) means the catcher did NOT
      // catch the third strike — no PO credit, even though the pitcher
      // still gets the K. The fielder who eventually retired the runner
      // (if any) would land on the corresponding `error_advance` or a
      // follow-up play; we don't fabricate that credit here.
      if (ab.catcher_player_id && !ab.batter_reached_on_k3) {
        ensure(ab.catcher_player_id).PO += 1;
      }
      continue;
    }
    if (ab.result === "CI") {
      if (ab.catcher_player_id) ensure(ab.catcher_player_id).CI += 1;
      continue;
    }

    // Stage 3 path: when a fielder_chain is present, credit A on every
    // non-terminal step and PO on the terminal step. An `error_step_index`
    // pulls that step out of the A/PO line and credits it as E instead.
    // Result-level overlays (DP/TP) still increment on the primary fielder.
    const chain = ab.fielder_chain;
    const chainIds = ab.fielder_chain_player_ids;
    if (chain && chain.length > 0 && chainIds && chainIds.length === chain.length) {
      const lastIdx = chain.length - 1;
      const errIdx = ab.error_step_index ?? null;
      for (let i = 0; i < chain.length; i++) {
        const pid = chainIds[i];
        if (!pid) continue;
        if (errIdx === i) {
          ensure(pid).E += 1;
        } else if (i === lastIdx) {
          // Terminal step is the PO — but only when the play produced an
          // out. On a hit (1B/2B/3B/HR) or FC where the chain ends with no
          // out, terminal counts as an A (the fielder handled the ball
          // but didn't retire anyone). E results also skip the terminal-
          // PO credit; the E credit lands via error_step_index.
          if (ab.outs_recorded > 0 && ab.result !== "E") {
            ensure(pid).PO += 1;
          } else if (lastIdx > 0) {
            ensure(pid).A += 1;
          }
        } else {
          ensure(pid).A += 1;
        }
      }
      // DP/TP overlay credit still goes to the primary fielder so the
      // existing FieldingLine columns stay populated.
      if (ab.fielder_player_id) {
        if (ab.result === "DP") ensure(ab.fielder_player_id).DP += 1;
        else if (ab.result === "TP") ensure(ab.fielder_player_id).TP += 1;
      }
      continue;
    }

    // Legacy / chain-absent path: credit the primary fielder via the
    // existing fielder_position snapshot.
    if (!ab.fielder_player_id) continue;

    if (PUTOUT_FIELDER_RESULTS.has(ab.result)) {
      ensure(ab.fielder_player_id).PO += 1;
    } else if (ab.result === "E") {
      ensure(ab.fielder_player_id).E += 1;
    } else if (ab.result === "DP") {
      ensure(ab.fielder_player_id).DP += 1;
    } else if (ab.result === "TP") {
      ensure(ab.fielder_player_id).TP += 1;
    }
  }

  // Catcher-credited events. catcher_id is null when we were batting (the
  // catcher in play is the opponent's), so those entries are skipped.
  for (const ev of catcherEvents.passed_balls) {
    if (ev.catcher_id) ensure(ev.catcher_id).PB += 1;
  }
  for (const ev of catcherEvents.stolen_bases) {
    if (ev.catcher_id) ensure(ev.catcher_id).SB += 1;
  }
  for (const ev of catcherEvents.caught_stealing) {
    if (ev.catcher_id) ensure(ev.catcher_id).CS += 1;
    creditRunningEventChain(ev.fielder_chain_player_ids, ensure);
  }
  for (const ev of catcherEvents.pickoffs) {
    if (ev.catcher_id) ensure(ev.catcher_id).PIK += 1;
    creditRunningEventChain(ev.fielder_chain_player_ids, ensure);
  }
  for (const ev of catcherEvents.error_advance_fielders ?? []) {
    ensure(ev.fielder_player_id).E += 1;
  }

  // Derive composite counts and rates.
  for (const line of out.values()) {
    line.SBATT = line.SB + line.CS;
    line.TC = line.PO + line.A + line.E;
    line.FPCT = line.TC > 0 ? (line.PO + line.A) / line.TC : 0;
    line["CS%"] = line.SBATT > 0 ? line.CS / line.SBATT : 0;
  }

  return out;
}

// W/L/SV attribution per PDF §18-19. Walks the at-bats in order tracking
// running score, our pitcher of record, and lead changes, then resolves
// the win/loss/save based on the final score. NFHS 4-inning starter
// eligibility (vs MLB 5-inning) parameterized by `leagueType`.
//
// Limitation: non-PA runs (WP/PB/balk/SB-home/error_advance) are not
// interleaved with at-bats for chronology — they're assumed to occur
// at the end of their containing half. This mis-attributes W/L only in
// the rare case where a non-PA run causes a lead change *between*
// at-bats. ER attribution is unaffected (it uses pitcher_of_record_id
// directly, not chronological ordering).
export type LeagueType = "mlb" | "nfhs";

export interface WLSResult {
  W: string | null;
  L: string | null;
  SV: string | null;
}

export function computeWLS(
  atBats: DerivedAtBat[],
  nonPaRuns: ReplayState["non_pa_runs"],
  weAreHome: boolean,
  finalTeamScore: number,
  finalOpponentScore: number,
  leagueType: LeagueType = "mlb",
): WLSResult {
  if (finalTeamScore === finalOpponentScore) return { W: null, L: null, SV: null };
  const weWon = finalTeamScore > finalOpponentScore;

  // Chronological event stream from at_bats only (see header limitation).
  // Each event has: ourPitcher (current of record), oursDelta, oppDelta.
  let ourPitcher: string | null = null;
  let starter: string | null = null;
  // Pitcher intervals: who pitched while opp was scoring.
  const innings3: Map<string, number> = new Map(); // pitcher -> outs recorded
  for (const ab of atBats) {
    if (ab.pitcher_id) {
      ourPitcher = ab.pitcher_id;
      if (starter === null) starter = ab.pitcher_id;
      innings3.set(ab.pitcher_id, (innings3.get(ab.pitcher_id) ?? 0) + (ab.outs_recorded ?? 0));
    }
  }

  let team = 0;
  let opp = 0;
  ourPitcher = null;
  // The pitcher in for our side at the moment of the LAST lead-taking
  // event (where our team went from ≤ to >). This becomes the W candidate
  // if we won.
  let leadCandidate: string | null = null;
  // Symmetric for L: the pitcher in when opp took the lead for good.
  let lossCandidate: string | null = null;

  const ourBats = (half: "top" | "bottom") =>
    (weAreHome && half === "bottom") || (!weAreHome && half === "top");

  for (const ab of atBats) {
    if (ab.pitcher_id) ourPitcher = ab.pitcher_id;
    const runs = ab.runs_scored_on_play;
    const weBat = ourBats(ab.half);
    const prevTeam = team;
    const prevOpp = opp;
    if (weBat) team += runs;
    else opp += runs;
    // Detect transition into our-lead.
    if (team > opp && prevTeam <= prevOpp) leadCandidate = ourPitcher;
    if (opp > team && prevOpp <= prevTeam) lossCandidate = ourPitcher;
  }
  // Roll non_pa_runs in (all opp scoring against our pitcher).
  for (const npr of nonPaRuns) {
    if (npr.pitcher_id) ourPitcher = npr.pitcher_id;
    const prevOpp = opp;
    const prevTeam = team;
    opp += npr.runs;
    if (opp > team && prevOpp <= prevTeam) lossCandidate = ourPitcher;
  }

  const out: WLSResult = { W: null, L: null, SV: null };

  if (weWon) {
    // Starter eligibility: must complete required innings or W shifts to
    // most-effective reliever. We approximate "most effective" as "the
    // pitcher in at the time we took the final lead" (which is the
    // leadCandidate). MLB requires 5 IP (15 outs); NFHS requires 4 (12).
    const required = leagueType === "nfhs" ? 12 : 15;
    const starterOuts = starter ? (innings3.get(starter) ?? 0) : 0;
    if (starter && leadCandidate === starter && starterOuts >= required) {
      out.W = starter;
    } else if (leadCandidate) {
      out.W = leadCandidate;
    } else {
      // We won without ever falling behind/tying — give it to the starter
      // if eligible, else the lead-taking candidate (which is null here,
      // meaning we led the whole time → also the starter if eligible).
      out.W = starter && starterOuts >= required ? starter : starter;
    }
    // Save: finishing pitcher (the one with the last out, approximated
    // as last ab.pitcher_id). Save criteria simplified: lead ≤3 AND ≥1 IP,
    // or ≥3 IP regardless of lead.
    const finisher = lastFinisher(atBats);
    if (finisher && finisher !== out.W) {
      const finisherOuts = innings3.get(finisher) ?? 0;
      const lead = finalTeamScore - finalOpponentScore;
      const meetsA = lead <= 3 && finisherOuts >= 3; // ≥1 IP with ≤3 lead
      const meetsC = finisherOuts >= 9; // ≥3 IP
      if (meetsA || meetsC) out.SV = finisher;
    }
  } else {
    out.L = lossCandidate;
  }
  return out;
}

function lastFinisher(atBats: DerivedAtBat[]): string | null {
  for (let i = atBats.length - 1; i >= 0; i--) {
    if (atBats[i].pitcher_id) return atBats[i].pitcher_id;
  }
  return null;
}

// Box-score proof per PDF §21: every batter ends in one of {scored,
// stranded, put out}. Provided as a verification helper for tests and
// runtime sanity checks.
//
//   AB + BB + HBP + SH + SF + CI = R + LOB + OppPO
//
// Note: BattingLine.BB already includes IBB (see rollupBatting).
export interface BoxScoreInputs {
  AB: number;
  BB: number;
  HBP: number;
  SH: number;
  SF: number;
  CI: number;
  R: number;
  LOB: number;
  OppPO: number;
}

export function verifyBoxScore(b: BoxScoreInputs): {
  ok: boolean;
  lhs: number;
  rhs: number;
  mismatch: number;
} {
  const lhs = b.AB + b.BB + b.HBP + b.SH + b.SF + b.CI;
  const rhs = b.R + b.LOB + b.OppPO;
  return { ok: lhs === rhs, lhs, rhs, mismatch: lhs - rhs };
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
