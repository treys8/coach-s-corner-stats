// Public surface of the scoring rollup. Domains live in sibling files;
// this barrel re-exports their public functions/types plus the cross-
// domain box-score invariant.

export { rollupBatting } from "./batting";
export type { BattingLine, RunnerEventLog } from "./batting";

export { rollupPitching } from "./pitching";
export type { PitchingLine } from "./pitching";

export { rollupFielding } from "./fielding";
export type { FieldingLine, CatcherEventLog } from "./fielding";

export { computeWLS } from "./wls";
export type { WLSResult, LeagueType, BoxScoreInputs } from "./wls";

import type { BoxScoreInputs } from "./wls";

// Box-score proof per PDF §21: every batter ends in one of {scored,
// stranded, put out}. Provided as a verification helper for tests and
// runtime sanity checks.
//
//   AB + BB + HBP + SH + SF + CI = R + LOB + OppPO
//
// Note: BattingLine.BB already includes IBB (see rollupBatting).
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
