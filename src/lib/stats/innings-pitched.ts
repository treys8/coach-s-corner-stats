// Innings-pitched ↔ outs conversion. Baseball notation: 7.1 = 7⅓ innings,
// 7.2 = 7⅔ innings, 7.0 = 7 full innings. Sums must go via outs to avoid
// 7.1 + 7.2 = 14.3 nonsense.

import { safeDiv } from "./derived";

/** Parse baseball-notation IP (e.g. 7.1, 7.2, 9.0) into integer outs.
 *  Anything other than .0 / .1 / .2 is malformed and the fractional part
 *  is discarded — `7.5` becomes 21 outs (7 full innings), never 23 or 24. */
export function ipToOuts(ip: number): number {
  if (!Number.isFinite(ip) || ip < 0) return 0;
  const whole = Math.floor(ip);
  const frac = Math.round((ip - whole) * 10);
  return whole * 3 + (frac === 1 ? 1 : frac === 2 ? 2 : 0);
}

/** Inverse of ipToOuts: 7 outs → 2.1, 9 outs → 3.0, 10 outs → 3.1. */
export function outsToIp(outs: number): number {
  const whole = Math.floor(outs / 3);
  const rem = outs % 3;
  return whole + rem / 10;
}

/** ERA = ER * 9 / IP, where IP = outs / 3. Algebraically: ER * 27 / outs. */
export function eraFromOuts(er: number, outs: number): number {
  return safeDiv(er * 27, outs);
}

/** WHIP = (BB + H) / IP, where IP = outs / 3. Algebraically: (BB+H) * 3 / outs. */
export function whipFromOuts(bbPlusH: number, outs: number): number {
  return safeDiv(bbPlusH * 3, outs);
}
