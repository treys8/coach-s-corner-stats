// Single source of truth for classifying at-bat outcomes.
// Imported by rollup/batting, rollup/pitching, and the opposing-batter
// profile derivation so all three agree on what counts as a hit, walk,
// strikeout, or PA-but-not-AB result.

import type { AtBatResult } from "./types";

// Sets are typed `ReadonlySet<string>` so consumers reading `result` as a
// plain string (e.g. the opposing-batter profile, which gets raw DB rows)
// can call `.has()` without casts. The Set constructor argument is typed
// `AtBatResult[]` so a typo in a member is still a compile error.
export const HIT_RESULTS: ReadonlySet<string> = new Set<AtBatResult>([
  "1B", "2B", "3B", "HR",
]);
export const WALK_RESULTS: ReadonlySet<string> = new Set<AtBatResult>([
  "BB", "IBB",
]);
export const STRIKEOUT_RESULTS: ReadonlySet<string> = new Set<AtBatResult>([
  "K_swinging", "K_looking",
]);
// PA-but-not-AB results: walk/IBB, HBP, sacrifice bunt, sac fly, catcher's
// interference. Per PDF §3.
export const NON_AB_RESULTS: ReadonlySet<string> = new Set<AtBatResult>([
  "BB", "IBB", "HBP", "SAC", "SF", "CI",
]);
// Batted-ball outs whose primary fielder gets the PO credit when no
// fielder_chain is present. Includes IF (infield fly rule) — the umpire's
// call lands on a high fly the fielder still catches.
export const PUTOUT_FIELDER_RESULTS: ReadonlySet<string> = new Set<AtBatResult>([
  "FO", "GO", "LO", "PO", "IF",
]);
