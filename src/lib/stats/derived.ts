// Single source of truth for batting rate stats. Anything that computes
// AVG / OBP / SLG / OPS / BABIP / C% / BB/K / AB/HR / PS/PA / 2S+3% / 6+%
// / SB% should route through `deriveBattingRates` so the formulas can't
// drift between the player page, the public scores page, the records
// page, and the live-scoring rollup.

export function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

export interface BattingCounts {
  AB: number;
  H: number;
  HR: number;
  SO: number;
  BB: number;
  HBP: number;
  SF: number;
  /** Total bases. If omitted, computed from "1B"/"2B"/"3B"/HR. */
  TB?: number;
  "1B"?: number;
  "2B"?: number;
  "3B"?: number;
  PA?: number;
  PS?: number;
  "2S+3"?: number;
  "6+"?: number;
  SB?: number;
  CS?: number;
}

export interface BattingRates {
  AVG: number;
  OBP: number;
  SLG: number;
  OPS: number;
  BABIP: number;
  "C%": number;
  "BB/K": number;
  "AB/HR": number;
  "PS/PA": number;
  "2S+3%": number;
  "6+%": number;
  "SB%": number;
}

/**
 * Derives every batting rate stat from raw counts. Zero-denominator cases
 * return 0 (via safeDiv); we never emit NaN or Infinity.
 *
 * `TB` is preferred when provided; otherwise it's reconstructed from the
 * per-extra-base counts. If neither is available, SLG will fall back to 0.
 */
export function deriveBattingRates(counts: BattingCounts): BattingRates {
  const tb = counts.TB ?? (
    (counts["1B"] ?? 0) +
    2 * (counts["2B"] ?? 0) +
    3 * (counts["3B"] ?? 0) +
    4 * counts.HR
  );
  const obpDen = counts.AB + counts.BB + counts.HBP + counts.SF;
  const babipDen = counts.AB - counts.SO - counts.HR + counts.SF;
  const sb = counts.SB ?? 0;
  const cs = counts.CS ?? 0;
  const pa = counts.PA ?? 0;

  const AVG = safeDiv(counts.H, counts.AB);
  const OBP = safeDiv(counts.H + counts.BB + counts.HBP, obpDen);
  const SLG = safeDiv(tb, counts.AB);
  return {
    AVG,
    OBP,
    SLG,
    OPS: OBP + SLG,
    BABIP: safeDiv(counts.H - counts.HR, babipDen),
    "C%": safeDiv(counts.AB - counts.SO, counts.AB),
    "BB/K": safeDiv(counts.BB, counts.SO),
    "AB/HR": safeDiv(counts.AB, counts.HR),
    "PS/PA": safeDiv(counts.PS ?? 0, pa),
    "2S+3%": safeDiv(counts["2S+3"] ?? 0, pa),
    "6+%": safeDiv(counts["6+"] ?? 0, pa),
    "SB%": safeDiv(sb, sb + cs),
  };
}
