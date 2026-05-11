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
  LF: [24, 40],
  CF: [50, 34],
  RF: [76, 40],
};

export const BASE_XY = {
  first:  [66, 70],
  second: [50, 54],
  third:  [34, 70],
} as const;
