"use client";

// Shared field illustration used by both SprayField (charting surface) and
// DefensiveDiamond (live defensive layout). Renders everything that's the
// same between the two: dark surround, cross-hatch outfield grass, warning
// track, outfield wall, skinned-infield arc, infield grass diamond,
// pitcher's mound, home plate, and batter's boxes. Callers overlay bases /
// fielders / dots / batter chips on top.
//
// Returns SVG elements (not a wrapping <svg>); the parent owns the <svg>
// with viewBox="0 0 100 100" so both views share one coordinate system.

export const FIELD_OUTFIELD_PATH = "M 50,92 L 95,30 A 70,40 0 0 0 5,30 Z";
export const FIELD_OUTFIELD_ARC = "M 95,30 A 70,40 0 0 0 5,30";
// Skinned-infield arc: pie wedge centered at home along the foul-line
// directions. Radius 48 puts 2B (at y=54) comfortably inside the dirt
// with ~10 units of dirt extending past it toward CF, matching real
// fields where the dirt arc sits past the bases.
export const FIELD_INFIELD_DIRT_PATH = "M 50,92 L 78.18,53.17 A 48,48 0 0 0 21.82,53.17 Z";

interface FieldBackgroundProps {
  /** Unique suffix appended to <defs> ids (pattern, clipPath) so multiple
   *  fields rendered on the same page don't collide. */
  idSuffix: string;
}

export function FieldBackground({ idSuffix }: FieldBackgroundProps) {
  const mowId = `field-mow-${idSuffix}`;
  const clipId = `field-outfield-clip-${idSuffix}`;
  return (
    <>
      <defs>
        {/* Diamond mow pattern: a 2x2 checker in two slightly different
            greens, rotated 45° so the squares read as diamonds on screen.
            This is GameChanger's signature look — alternating light and
            dark diamond-shaped patches across the grass. */}
        <pattern
          id={mowId}
          x="0"
          y="0"
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="14" height="14" fill="#2f6b34" />
          <rect x="0" y="0" width="7" height="7" fill="#3a7d3f" />
          <rect x="7" y="7" width="7" height="7" fill="#3a7d3f" />
        </pattern>
        <clipPath id={clipId}>
          <path d={FIELD_OUTFIELD_PATH} />
        </clipPath>
      </defs>

      {/* Dark frame outside the foul lines — makes the field pop. */}
      <rect width="100" height="100" fill="#0e1a14" />

      {/* Outfield grass with quilted diamond mowing pattern */}
      <g clipPath={`url(#${clipId})`}>
        <rect width="100" height="100" fill={`url(#${mowId})`} />
        {/* Warning track: tan stroke along the arc only, clipped to
            the outfield so only the inner half of the stroke shows. */}
        <path
          d={FIELD_OUTFIELD_ARC}
          fill="none"
          stroke="#a68056"
          strokeWidth="3.5"
        />
      </g>

      {/* Outfield wall — thin, mostly transparent white. Just enough to
          define the arc without competing with the grass texture. */}
      <path
        d={FIELD_OUTFIELD_ARC}
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.4"
        opacity="0.55"
      />

      {/* Infield dirt — skinned-infield curved arc. Warm sandy tan
          (matches what GameChanger's clay reads as on iPad). */}
      <path d={FIELD_INFIELD_DIRT_PATH} fill="#c9a47a" />

      {/* Home-plate dirt: flat top flush with home plate, rounded bottom
          for the catcher / umpire area. Covers the C chip at (50,96). */}
      <path d="M 41,91 L 59,91 L 59,96 A 9,4 0 0 1 41,96 Z" fill="#c9a47a" />

      {/* Infield grass diamond — corners aligned with the bases. Mid green
          so it sits between the outfield mow and the dirt without shouting. */}
      <polygon points="50,86 66,70 50,54 34,70" fill="#3d8542" />

      {/* Foul lines: home through 1B/3B all the way out to the canvas
          corners (past the wall), like GameChanger. */}
      <line x1="50" y1="92" x2="100" y2="23" stroke="#fff" strokeWidth="0.7" />
      <line x1="50" y1="92" x2="0" y2="23" stroke="#fff" strokeWidth="0.7" />

      {/* Pitcher's mound — small clay marker, not a giant circle. */}
      <circle cx="50" cy="73" r="3" fill="#c9a47a" />
      <rect x="48.8" y="72.75" width="2.4" height="0.5" fill="#fff" opacity="0.95" />

      {/* Batter's boxes flanking home plate, flush with the side corners */}
      <rect x="41.5" y="91" width="4" height="6" fill="#fff" stroke="#1f3252" strokeWidth="0.25" />
      <rect x="54.5" y="91" width="4" height="6" fill="#fff" stroke="#1f3252" strokeWidth="0.25" />

      {/* Home plate */}
      <polygon
        points="46.5,91 53.5,91 54.5,94 50,96.5 45.5,94"
        fill="#fff"
        stroke="#1f3252"
        strokeWidth="0.45"
      />
    </>
  );
}
