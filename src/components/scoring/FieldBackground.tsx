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
        <pattern
          id={mowId}
          x="0"
          y="0"
          width="6"
          height="100"
          patternUnits="userSpaceOnUse"
        >
          <rect width="6" height="100" fill="#9bc278" />
          <rect x="3" width="3" height="100" fill="#82ad5f" />
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

      {/* Home-plate dirt: flat top flush with home plate, rounded bottom
          for the catcher / umpire area. Covers the C chip at (50,96). */}
      <path d="M 41,91 L 59,91 L 59,96 A 9,4 0 0 1 41,96 Z" fill="#c9a47a" />

      {/* Infield grass diamond — corners aligned with the bases */}
      <polygon points="50,86 66,70 50,54 34,70" fill="#a8d18c" />

      {/* Pitcher's path: dirt strip from mound to home through the grass
          (old-school "keyhole"). Drawn over the grass; mound + home plate
          dirt overlap its ends so the transitions are seamless. */}
      <rect x="47" y="75" width="6" height="16" fill="#c9a47a" />

      {/* Foul lines: home through 1B/3B out to the wall corners */}
      <line x1="50" y1="92" x2="95" y2="30" stroke="#fff" strokeWidth="0.6" />
      <line x1="50" y1="92" x2="5" y2="30" stroke="#fff" strokeWidth="0.6" />

      {/* Pitcher's mound */}
      <circle cx="50" cy="73" r="5" fill="#c9a47a" />
      <rect x="48.2" y="72.65" width="3.6" height="0.7" fill="#fff" opacity="0.95" />

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
