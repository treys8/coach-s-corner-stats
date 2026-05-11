"use client";

// Shared field illustration used by both SprayField (charting surface) and
// DefensiveDiamond (live defensive layout). Renders everything that's the
// same between the two: grass + mow pattern, warning track, outfield wall,
// skinned-infield arc, batter's box dirt, infield grass diamond, pitcher's
// mound, and home plate. Callers overlay bases / fielders / dots on top.
//
// Returns SVG elements (not a wrapping <svg>); the parent owns the <svg>
// with viewBox="0 0 100 100" so both views share one coordinate system.

export const FIELD_OUTFIELD_PATH = "M 50,92 L 95,30 A 70,40 0 0 0 5,30 Z";
export const FIELD_OUTFIELD_ARC = "M 95,30 A 70,40 0 0 0 5,30";
// Skinned-infield arc: pie wedge centered at home along the foul-line
// directions. Radius 38 places 2B at (50,54) exactly on the back edge.
export const FIELD_INFIELD_DIRT_PATH = "M 50,92 L 72.31,61.26 A 38,38 0 0 0 27.69,61.26 Z";

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
        <pattern
          id={mowId}
          x="0"
          y="0"
          width="6"
          height="100"
          patternUnits="userSpaceOnUse"
        >
          <rect width="6" height="100" fill="#cfe1bb" />
          <rect x="3" width="3" height="100" fill="#c6d8af" />
        </pattern>
        <clipPath id={clipId}>
          <path d={FIELD_OUTFIELD_PATH} />
        </clipPath>
      </defs>

      {/* Cream background */}
      <rect width="100" height="100" fill="#faf6ec" />

      {/* Outfield grass with subtle vertical mowing stripes */}
      <g clipPath={`url(#${clipId})`}>
        <rect width="100" height="100" fill={`url(#${mowId})`} />
        {/* Warning track: thick tan stroke along the arc only, clipped to
            the outfield so only the inner half of the stroke shows. */}
        <path
          d={FIELD_OUTFIELD_ARC}
          fill="none"
          stroke="#c9a47a"
          strokeWidth="3.5"
        />
      </g>

      {/* Outfield wall (drawn on top, no clip, sits along the arc edge) */}
      <path
        d={FIELD_OUTFIELD_ARC}
        fill="none"
        stroke="#1f3252"
        strokeWidth="0.6"
      />

      {/* Infield dirt — skinned-infield curved arc */}
      <path d={FIELD_INFIELD_DIRT_PATH} fill="#c9a47a" />

      {/* Batter's-box dirt around home plate so home isn't floating in cream */}
      <ellipse cx="50" cy="92" rx="8" ry="5.5" fill="#c9a47a" />

      {/* Infield grass diamond — corners aligned with the bases */}
      <polygon points="50,86 66,70 50,54 34,70" fill="#bfd5a4" />

      {/* Pitcher's mound */}
      <circle cx="50" cy="73" r="2.6" fill="#c9a47a" />
      <rect x="48.6" y="72.7" width="2.8" height="0.6" fill="#fff" opacity="0.9" />

      {/* Home plate */}
      <polygon
        points="47.5,91 52.5,91 53.5,94 50,96 46.5,94"
        fill="#fff"
        stroke="#1f3252"
        strokeWidth="0.35"
      />
    </>
  );
}
