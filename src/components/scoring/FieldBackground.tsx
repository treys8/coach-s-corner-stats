"use client";

// Shared field illustration used by both SprayField (charting surface) and
// DefensiveDiamond (live defensive layout). Mirrors the structure of
// GameChanger's iPad field view:
//   - Grass fills the entire field — including foul territory — up to the
//     outfield wall arc. Only the area ABOVE the wall arc is dark.
//   - The infield is a circle of skinned dirt centered between the bases,
//     with the infield grass diamond inscribed in it.
//   - The home plate area has its own separate circular dirt patch.
//   - Foul lines are drawn ON the grass and stop at the wall.
//
// Returns SVG elements (not a wrapping <svg>); the parent owns the <svg>
// with viewBox="0 0 100 100" so both views share one coordinate system.

// Outfield wall: a gentle upward curve spanning the full canvas width,
// peaking near the top-center. Sweep-flag 1 = curve upward when traveling
// left-to-right.
const WALL_ARC = "M 0,32 A 90,30 0 0 1 100,32";

// Grass shape: bounded above by the wall arc, fills down to the canvas
// bottom and out to both side edges. Foul territory IS grass — only the
// strip above the wall is dark.
const GRASS_PATH = "M 0,32 A 90,30 0 0 1 100,32 L 100,100 L 0,100 Z";

interface FieldBackgroundProps {
  /** Unique suffix appended to <defs> ids so multiple fields rendered on
   *  the same page don't collide. */
  idSuffix: string;
}

export function FieldBackground({ idSuffix }: FieldBackgroundProps) {
  const mowId = `field-mow-${idSuffix}`;
  const grassClipId = `field-grass-clip-${idSuffix}`;
  return (
    <>
      <defs>
        {/* Diamond mow pattern: a 2x2 checker rotated 45° so the cells
            read as alternating light/dark diamond patches across the
            grass. GameChanger's signature look. */}
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
          <rect width="7" height="7" fill="#3a7d3f" />
          <rect x="7" y="7" width="7" height="7" fill="#3a7d3f" />
        </pattern>
        <clipPath id={grassClipId}>
          <path d={GRASS_PATH} />
        </clipPath>
      </defs>

      {/* Dark surround — only the area above the wall arc is visible
          (everything below is covered by grass). */}
      <rect width="100" height="100" fill="#0e1a14" />

      {/* Grass: fills the entire field, foul territory included, up to
          the wall arc. */}
      <path d={GRASS_PATH} fill={`url(#${mowId})`} />

      {/* Warning track: a tan strip just inside the wall. Clipped to the
          grass so only the inner half of the stroke shows. */}
      <g clipPath={`url(#${grassClipId})`}>
        <path
          d={WALL_ARC}
          fill="none"
          stroke="#a68056"
          strokeWidth="4"
        />
      </g>

      {/* Outfield wall — thin near-white line along the arc. */}
      <path
        d={WALL_ARC}
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.4"
        opacity="0.5"
      />

      {/* Infield skinned-dirt circle. Centered between the bases (above
          the mound) and large enough to contain 1B/2B/3B with a margin. */}
      <circle cx="50" cy="64" r="22" fill="#c9a47a" />

      {/* Home plate dirt circle — a separate round patch around home
          plate, with a thin grass strip between it and the infield dirt. */}
      <circle cx="50" cy="96" r="9" fill="#c9a47a" />

      {/* Infield grass diamond — corners at the bases, painted with the
          same mow pattern as the outfield so the grass reads as
          continuous. Sits on top of the infield dirt so the dirt forms a
          ring around it. */}
      <polygon
        points="50,86 66,70 50,54 34,70"
        fill={`url(#${mowId})`}
      />

      {/* Foul lines: from home plate outward, clipped to the grass so
          they visibly stop at the wall arc. */}
      <g clipPath={`url(#${grassClipId})`}>
        <line x1="50" y1="92" x2="100" y2="23" stroke="#fff" strokeWidth="0.65" />
        <line x1="50" y1="92" x2="0" y2="23" stroke="#fff" strokeWidth="0.65" />
      </g>

      {/* Pitcher's mound — small clay disc, just enough to mark the spot.
          The P fielder marker will sit on top of it. */}
      <circle cx="50" cy="73" r="2.6" fill="#c9a47a" />
      <rect x="48.8" y="72.75" width="2.4" height="0.5" fill="#fff" opacity="0.95" />

      {/* Batter's boxes flanking home plate, inside the home plate dirt
          circle. */}
      <rect x="41.5" y="91" width="4" height="6" fill="#fff" stroke="#1f3252" strokeWidth="0.25" />
      <rect x="54.5" y="91" width="4" height="6" fill="#fff" stroke="#1f3252" strokeWidth="0.25" />

      {/* Home plate. */}
      <polygon
        points="46.5,91 53.5,91 54.5,94 50,96.5 45.5,94"
        fill="#fff"
        stroke="#1f3252"
        strokeWidth="0.45"
      />
    </>
  );
}
