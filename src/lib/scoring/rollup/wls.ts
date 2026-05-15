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

import type { DerivedAtBat, ReplayState } from "../types";

export type LeagueType = "mlb" | "nfhs";

export interface WLSResult {
  W: string | null;
  L: string | null;
  SV: string | null;
}

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
