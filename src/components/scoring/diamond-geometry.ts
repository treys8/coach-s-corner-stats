// Shared SVG geometry for the field diagram. Both the full DefensiveDiamond
// (action surface) and the small MiniBases (status-bar indicator) read these
// constants so coordinates stay in sync when the field illustration changes.

export const FIELDER_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
export type FielderPosition = (typeof FIELDER_POSITIONS)[number];

// Canonical fielder centers in a 100x100 viewBox with home at the bottom-center
// and CF at the top-center. Aligned with the shared FieldBackground:
//   - bases at (66,70) / (50,54) / (34,70), mound at (50,73), home (50,92).
//   - corner infielders sit just behind the bag in the outfield grass;
//     middle infielders straddle 2B a few steps deeper; outfielders play
//     in front of the wall (arc at y≈30).
export const POSITION_XY: Record<FielderPosition, [number, number]> = {
  P:  [50, 73],
  C:  [50, 96],
  "1B": [70, 60],
  "2B": [60, 46],
  SS: [40, 46],
  "3B": [30, 60],
  LF: [22, 34],
  CF: [50, 26],
  RF: [78, 34],
};

export const BASE_XY = {
  first:  [66, 70],
  second: [50, 54],
  third:  [34, 70],
} as const;

export const HOME_XY: [number, number] = [50, 92];

// Snap a normalized (0..1) drop position to the nearest base bag. Returns
// undefined when the drop isn't close enough to any base — used to attach
// a `target` to non-first chain steps so notation renders "6-4-3" and the
// runner-out attribution knows which bag was covered.
export function nearestBaseFromNormalized(
  xNorm: number,
  yNorm: number,
): "first" | "second" | "third" | "home" | undefined {
  const x = xNorm * 100;
  const y = yNorm * 100;
  const SNAP_RADIUS = 8;
  const candidates: Array<{ base: "first" | "second" | "third" | "home"; xy: readonly [number, number] }> = [
    { base: "first",  xy: BASE_XY.first },
    { base: "second", xy: BASE_XY.second },
    { base: "third",  xy: BASE_XY.third },
    { base: "home",   xy: HOME_XY },
  ];
  let best: { base: "first" | "second" | "third" | "home"; d: number } | null = null;
  for (const c of candidates) {
    const d = Math.hypot(x - c.xy[0], y - c.xy[1]);
    if (!best || d < best.d) best = { base: c.base, d };
  }
  return best && best.d <= SNAP_RADIUS ? best.base : undefined;
}
