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

import type { AtBatResult, DefensiveSlot, DerivedAtBat, NonPaRunSource, ReplayState, RunnerAdvance } from "./types";

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
  /** Sacrifice bunt — counted separately from SF; both are PA-not-AB. */
  SH: number;
  /** Catcher's interference — PA-not-AB; batter awarded first base. */
  CI: number;
  RBI: number;
  R: number;
  PA: number;
  /** Grounded into double play — counts when the at-bat result is DP and
   *  ≥2 outs were recorded (PDF §13 / NFHS §10.04). */
  GIDP: number;
  /** Left on base — runners stranded when the batter made the third out
   *  of the half-inning (MLB convention). 0 for any other PA. */
  LOB: number;
  AVG: number;
  OBP: number;
  SLG: number;
  OPS: number;
}

export interface FieldingLine {
  /** Putouts: credited to the fielder who recorded the out (catch, tag,
   *  or final force-out throw recipient). */
  PO: number;
  /** Assists: credited to a fielder who handled the ball before a putout
   *  on the same play. Auto-attribution this rollup only credits the
   *  listed `fielder_position` as the assist on ground outs (the relay
   *  step). Multi-fielder chains (4-6-3 etc.) under-count assists. */
  A: number;
  /** Errors: a misplay that allows the batter or a baserunner to advance. */
  E: number;
  /** Total chances = PO + A + E. */
  TC: number;
  /** Fielding average = (PO + A) / TC, rounded later. 0 when TC=0. */
  FLD: number;
}

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
// (balks=earned), §8 (SB-home=earned).
const EARNED_NON_PA_SOURCES: ReadonlySet<NonPaRunSource> = new Set([
  "wild_pitch",
  "balk",
  "stolen_base",
]);

function emptyBatting(): BattingLine {
  return {
    AB: 0, H: 0, "1B": 0, "2B": 0, "3B": 0, HR: 0,
    BB: 0, SO: 0, HBP: 0, SF: 0, SH: 0, CI: 0, RBI: 0, R: 0, PA: 0,
    GIDP: 0, LOB: 0,
    AVG: 0, OBP: 0, SLG: 0, OPS: 0,
  };
}

function emptyFielding(): FieldingLine {
  return { PO: 0, A: 0, E: 0, TC: 0, FLD: 0 };
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

export function rollupBatting(atBats: DerivedAtBat[]): Map<string, BattingLine> {
  const out = new Map<string, BattingLine>();
  const ensure = (id: string): BattingLine => {
    let line = out.get(id);
    if (!line) {
      line = emptyBatting();
      out.set(id, line);
    }
    return line;
  };

  for (const ab of atBats) {
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
      } else if (ab.result === "HBP") {
        line.HBP += 1;
      } else if (ab.result === "SF") {
        line.SF += 1;
      } else if (ab.result === "SAC") {
        line.SH += 1;
      } else if (ab.result === "CI") {
        line.CI += 1;
      }
      line.RBI += ab.rbi ?? 0;
      // GIDP: batter hit into a double play (DP result with ≥2 outs).
      if (ab.result === "DP" && (ab.outs_recorded ?? 0) >= 2) {
        line.GIDP += 1;
      }
      // LOB: replay engine flagged this PA as the inning-ender; credit the
      // runners it stranded to the batter who made the final out.
      if ((ab.lob_on_play ?? 0) > 0) {
        line.LOB += ab.lob_on_play ?? 0;
      }
    }

    // R per scoring runner: an advance with to='home' credits the runner
    // who scored. Independent of who batted — a runner advanced by another
    // batter's hit gets the R, the batter gets the RBI.
    for (const adv of ab.runner_advances ?? []) {
      if (adv.to !== "home" || !adv.player_id) continue;
      ensure(adv.player_id).R += 1;
    }
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
  // EARNED_NON_PA_SOURCES (WP, balk, SB-home).
  for (const npr of nonPaRuns) {
    if (!npr.pitcher_id || npr.runs <= 0) continue;
    const line = ensure(npr.pitcher_id);
    line.R += npr.runs;
    if (EARNED_NON_PA_SOURCES.has(npr.source)) {
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
function classifyScoringRunner(
  ab: DerivedAtBat,
  adv: RunnerAdvance,
): { pitcher_id: string | null; earned: boolean } | null {
  if (adv.to !== "home") return null;
  const k3DroppedTaint =
    ab.batter_reached_on_k3 === "E" || ab.batter_reached_on_k3 === "PB";
  if (adv.from === "batter") {
    const batterReachedOnError = ab.result === "E" || k3DroppedTaint;
    return {
      pitcher_id: ab.pitcher_of_record_id,
      earned: !batterReachedOnError,
    };
  }
  const src = ab.bases_before[adv.from];
  if (!src) {
    // Defensive fallback: source base unexpectedly empty. Credit current
    // PA pitcher; assume earned unless this PA was K3-dropped.
    return { pitcher_id: ab.pitcher_of_record_id, earned: !k3DroppedTaint };
  }
  return {
    pitcher_id: src.pitcher_of_record_id,
    earned: !src.reached_on_error && !k3DroppedTaint,
  };
}

// ---- Fielding rollup -------------------------------------------------------
//
// Auto-attribution from each at-bat's `defensive_lineup_snapshot` plus the
// listed `fielder_position`. Limits the coach should know about:
//   - Multi-fielder chains aren't recorded today (the play only carries one
//     fielder_position). Ground outs default to PO@1B / A@listed-fielder so
//     the most common case credits the right two players; everything else
//     credits only the listed position. Cutoffs and relays under-count
//     assists. DP/TP credit one PO at the listed position (no chain).
//   - When `fielder_position` is null (e.g., a play recorded before the
//     coach tagged a fielder), the play contributes nothing to fielding.

const FLY_PO_RESULTS: ReadonlySet<AtBatResult> = new Set(["FO", "LO", "PO", "IF", "SF"]);
const GROUND_OUT_RESULTS: ReadonlySet<AtBatResult> = new Set(["GO", "SAC"]);

function lookupPosition(
  lineup: DefensiveSlot[],
  position: string | null,
): string | null {
  if (!position) return null;
  const upper = position.trim().toUpperCase();
  const key = (() => {
    switch (upper) {
      case "1": case "P": return "P";
      case "2": case "C": return "C";
      case "3": case "1B": return "1B";
      case "4": case "2B": return "2B";
      case "5": case "3B": return "3B";
      case "6": case "SS": return "SS";
      case "7": case "LF": return "LF";
      case "8": case "CF": return "CF";
      case "9": case "RF": return "RF";
      default: return null;
    }
  })();
  if (!key) return null;
  return lineup.find((s) => s.position === key)?.player_id ?? null;
}

export function rollupFielding(atBats: DerivedAtBat[]): Map<string, FieldingLine> {
  const out = new Map<string, FieldingLine>();
  const ensure = (id: string): FieldingLine => {
    let line = out.get(id);
    if (!line) {
      line = emptyFielding();
      out.set(id, line);
    }
    return line;
  };

  for (const ab of atBats) {
    // Only the half-innings we are fielding generate fielding chances for
    // OUR players. When batter_id is set we were batting, so skip.
    if (ab.batter_id) continue;

    const lineup = ab.defensive_lineup_snapshot ?? [];
    const fielderId = lookupPosition(lineup, ab.fielder_position);
    const catcherId = lookupPosition(lineup, "C");
    const firstBaseId = lookupPosition(lineup, "1B");

    if (ab.result === "E") {
      if (fielderId) ensure(fielderId).E += 1;
      continue;
    }

    if (STRIKEOUT_RESULTS.has(ab.result) && !ab.batter_reached_on_k3) {
      // Caught third strike: catcher gets the PO.
      if (catcherId) ensure(catcherId).PO += 1;
      continue;
    }

    if (GROUND_OUT_RESULTS.has(ab.result) && (ab.outs_recorded ?? 0) >= 1) {
      // Standard ground-out chain: assist to the fielder, putout at 1B.
      // SAC bunts follow the same chain (out at 1B, assist to fielder).
      if (fielderId) ensure(fielderId).A += 1;
      if (firstBaseId) ensure(firstBaseId).PO += 1;
      continue;
    }

    if (FLY_PO_RESULTS.has(ab.result) && (ab.outs_recorded ?? 0) >= 1) {
      // Fly out / line out / pop out / infield fly / sac fly — single PO
      // to the fielder who caught it.
      if (fielderId) ensure(fielderId).PO += 1;
      continue;
    }

    if (ab.result === "DP" || ab.result === "TP") {
      // Conservative: one PO at the listed position. Chain participation
      // (other fielders in the play) isn't captured yet — follow-up PR.
      if (fielderId) ensure(fielderId).PO += 1;
      continue;
    }

    // FC, hits, walks, HBP, CI: no fielding chance to credit here.
  }

  for (const line of out.values()) {
    line.TC = line.PO + line.A + line.E;
    line.FLD = line.TC > 0 ? (line.PO + line.A) / line.TC : 0;
  }

  return out;
}
