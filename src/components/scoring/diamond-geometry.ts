// Shared SVG geometry for the field diagram. Both the full DefensiveDiamond
// (action surface) and the small MiniBases (status-bar indicator) read these
// constants so coordinates stay in sync when the field illustration changes.

export const FIELDER_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
export type FielderPosition = (typeof FIELDER_POSITIONS)[number];

// Canonical fielder centers in a 100x100 viewBox with home at the bottom-center
// and CF at the top-center.
export const POSITION_XY: Record<FielderPosition, [number, number]> = {
  P:  [50, 60],
  C:  [50, 95],
  "1B": [62, 65],
  "2B": [58, 50],
  SS: [42, 50],
  "3B": [38, 65],
  LF: [22, 32],
  CF: [50, 22],
  RF: [78, 32],
};

export const BASE_XY = {
  first:  [66, 70],
  second: [50, 54],
  third:  [34, 70],
} as const;
