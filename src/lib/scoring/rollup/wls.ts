// W/L/SV attribution per PDF §18-19. Walks the at-bats and non-PA runs
// (WP/PB/balk/SB-home/error_advance) interleaved by `sequence` so a
// lead-change caused by a non-PA event is attributed to the pitcher who
// was actually on the mound at that moment, not whoever pitched the next
// at-bat. NFHS 4-inning starter eligibility (vs MLB 5-inning)
// parameterized by `leagueType` — required so a caller that forgets to
// thread the team's setting through silently doesn't run MLB rules on
// NFHS data.

import type { DerivedAtBat, NonPaRun, ReplayState } from "../types";

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
  leagueType: LeagueType,
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

  type TimelineEvent =
    | { kind: "at_bat"; entry: DerivedAtBat; sequence: number }
    | { kind: "non_pa_run"; entry: NonPaRun; sequence: number };
  // Interleave at-bats and non-PA runs by sequence so a WP/PB/balk that
  // causes a lead change between at-bats is attributed to the pitcher who
  // was actually on the mound at that moment. Entries missing a sequence
  // sort to the end of the stream (conservative fallback for legacy data).
  const timeline: TimelineEvent[] = [];
  for (const a of atBats) {
    timeline.push({ kind: "at_bat", entry: a, sequence: a.sequence ?? Number.POSITIVE_INFINITY });
  }
  for (const n of nonPaRuns) {
    timeline.push({ kind: "non_pa_run", entry: n, sequence: n.sequence ?? Number.POSITIVE_INFINITY });
  }
  timeline.sort((a, b) => a.sequence - b.sequence);

  for (const item of timeline) {
    const prevTeam = team;
    const prevOpp = opp;
    if (item.kind === "at_bat") {
      const a = item.entry;
      if (a.pitcher_id) ourPitcher = a.pitcher_id;
      if (ourBats(a.half)) team += a.runs_scored_on_play;
      else opp += a.runs_scored_on_play;
    } else {
      const n = item.entry;
      if (n.pitcher_id) ourPitcher = n.pitcher_id;
      opp += n.runs;
    }
    if (team > opp && prevTeam <= prevOpp) leadCandidate = ourPitcher;
    if (opp > team && prevOpp <= prevTeam) lossCandidate = ourPitcher;
  }

  const out: WLSResult = { W: null, L: null, SV: null };

  if (weWon) {
    // Starter eligibility: must complete required innings or W shifts to
    // the "most effective reliever" (Rule 9.17(c)). MLB requires 5 IP
    // (15 outs); NFHS requires 4 (12). We approximate "most effective" as
    // the relief pitcher with the most outs recorded — not the last
    // finisher, because a starter who exits early and re-enters to record
    // the final outs would otherwise be incorrectly re-awarded the W.
    const required = leagueType === "nfhs" ? 12 : 15;
    const starterOuts = starter ? (innings3.get(starter) ?? 0) : 0;
    if (starter && leadCandidate === starter && starterOuts >= required) {
      out.W = starter;
    } else if (leadCandidate && leadCandidate !== starter) {
      // A reliever was in when we took the final lead → they get the W.
      out.W = leadCandidate;
    } else {
      // Either starter was leadCandidate but ineligible, or leadCandidate
      // is null (we'd have won without scoring — not actually reachable).
      out.W = mostEffectiveReliever(innings3, starter) ?? starter;
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

/** Returns the pitcher (other than `starter`) with the most outs recorded.
 *  Null if no such pitcher exists (starter pitched the whole game). Ties
 *  broken by Map insertion order, which mirrors first-appearance order. */
function mostEffectiveReliever(
  innings3: Map<string, number>,
  starter: string | null,
): string | null {
  let best: string | null = null;
  let bestOuts = -1;
  for (const [pitcher, outs] of innings3) {
    if (pitcher === starter) continue;
    if (outs > bestOuts) {
      best = pitcher;
      bestOuts = outs;
    }
  }
  return best;
}
