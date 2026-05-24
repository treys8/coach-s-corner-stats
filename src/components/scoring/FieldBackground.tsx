"use client";

// Shared field illustration used by SprayField (charting surface),
// DefensiveDiamond (live defensive layout), and any other diagram that
// composes on top. Mirrors a real MLB field rendering (Baseball Savant /
// Gameday aesthetic):
//   - Gradient mowed grass fills the entire field — foul territory included —
//     up to the outfield wall arc.
//   - Diagonal mow stripes via <pattern>; subtle SVG noise via <filter>.
//   - Warning track is a tan band hugging the inside of the wall arc.
//   - Infield is a clay wedge from home plate out beyond 2B, with a
//     separate dirt bulb around home and dirt cutouts under each base.
//   - Pitcher's mound is a soft radial-gradient disc with a Gaussian blur
//     drop shadow.
//   - On-deck circles flank home plate in foul territory.
//
// Returns SVG elements (not a wrapping <svg>); parent owns the <svg> with
// viewBox="0 0 100 100" so every diagram layer shares one coordinate system.
// API (idSuffix prop) and viewBox dimensions are stable — do not change.

// --- Shared field landmarks (must match diamond-geometry.ts) ----------------
// Wall arc: same physical curve as the legacy outfield arc, stretched to
// full canvas width. Peaks around y≈18 so CF (y=26) sits comfortably inside.
const WALL_ARC = "M 100,30 A 70,40 0 0 0 0,30";

// Grass shape: bounded above by the wall arc, fills down to the canvas
// bottom and out to both side edges. Foul territory IS grass.
const GRASS_PATH = "M 100,30 A 70,40 0 0 0 0,30 L 0,100 L 100,100 Z";

// Infield clay wedge: apex at home, sides along the foul lines through the
// corner bags, capped by an arc beyond 2B. Real-ballpark "skin" shape.
const INFIELD_DIRT_PATH = "M 50,92 L 78.18,53.17 A 48,48 0 0 0 21.82,53.17 Z";

interface FieldBackgroundProps {
  /** Unique suffix appended to <defs> ids so multiple fields rendered on
   *  the same page don't collide. */
  idSuffix: string;
}

export function FieldBackground({ idSuffix }: FieldBackgroundProps) {
  const grassGradId = `field-grass-grad-${idSuffix}`;
  const mowId = `field-mow-${idSuffix}`;
  const infieldGrassGradId = `field-infield-grass-grad-${idSuffix}`;
  const dirtGradId = `field-dirt-grad-${idSuffix}`;
  const moundGradId = `field-mound-grad-${idSuffix}`;
  const noiseId = `field-noise-${idSuffix}`;
  const dirtNoiseId = `field-dirt-noise-${idSuffix}`;
  const moundShadowId = `field-mound-shadow-${idSuffix}`;
  const grassClipId = `field-grass-clip-${idSuffix}`;
  const dirtClipId = `field-dirt-clip-${idSuffix}`;

  return (
    <>
      <defs>
        <linearGradient id={grassGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a8b3f" />
          <stop offset="100%" stopColor="#6e9d51" />
        </linearGradient>

        <linearGradient id={infieldGrassGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#64954a" />
          <stop offset="100%" stopColor="#79a85b" />
        </linearGradient>

        <radialGradient id={dirtGradId} cx="50%" cy="55%" r="65%">
          <stop offset="0%" stopColor="#b07a52" />
          <stop offset="65%" stopColor="#a06d47" />
          <stop offset="100%" stopColor="#8e5a3a" />
        </radialGradient>

        <radialGradient id={moundGradId} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#a16847" />
          <stop offset="100%" stopColor="#8e5a3a" />
        </radialGradient>

        <pattern
          id={mowId}
          x="0"
          y="0"
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="14" height="14" fill="#ffffff" fillOpacity="0" />
          <rect width="7" height="14" fill="#ffffff" fillOpacity="0.045" />
          <rect x="7" width="7" height="14" fill="#000000" fillOpacity="0.045" />
        </pattern>

        <filter id={noiseId} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.6"
            numOctaves="2"
            seed="3"
            stitchTiles="stitch"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0"
          />
        </filter>

        <filter id={dirtNoiseId} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="2.2"
            numOctaves="2"
            seed="7"
            stitchTiles="stitch"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.08 0"
          />
        </filter>

        <filter id={moundShadowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" />
          <feOffset dx="0" dy="0.35" result="offsetblur" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.55" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <clipPath id={grassClipId}>
          <path d={GRASS_PATH} />
        </clipPath>
        <clipPath id={dirtClipId}>
          <path d={INFIELD_DIRT_PATH} />
        </clipPath>
      </defs>

      <rect width="100" height="100" fill="#0e1a14" />

      <g clipPath={`url(#${grassClipId})`}>
        <path d={GRASS_PATH} fill={`url(#${grassGradId})`} />
        <path d={GRASS_PATH} fill={`url(#${mowId})`} />
        <rect width="100" height="100" filter={`url(#${noiseId})`} opacity="0.7" />
      </g>

      <g clipPath={`url(#${grassClipId})`}>
        <path
          d={WALL_ARC}
          fill="none"
          stroke="#c19a6b"
          strokeWidth="3.2"
          strokeLinecap="butt"
        />
        <path
          d={WALL_ARC}
          fill="none"
          stroke="#b8865a"
          strokeWidth="3.2"
          strokeOpacity="0.35"
          strokeDasharray="0.4 0.9"
        />
      </g>

      <path
        d={WALL_ARC}
        fill="none"
        stroke="#6a5a3a"
        strokeWidth="0.45"
        opacity="0.85"
      />

      <g>
        <path d={INFIELD_DIRT_PATH} fill={`url(#${dirtGradId})`} />
        <circle cx="50" cy="94" r="10.5" fill={`url(#${dirtGradId})`} />
        <circle cx="66" cy="70" r="4.5" fill={`url(#${dirtGradId})`} />
        <circle cx="34" cy="70" r="4.5" fill={`url(#${dirtGradId})`} />
        <circle cx="50" cy="54" r="4.5" fill={`url(#${dirtGradId})`} />
        <g clipPath={`url(#${dirtClipId})`}>
          <rect width="100" height="100" filter={`url(#${dirtNoiseId})`} opacity="0.6" />
        </g>
        <circle cx="50" cy="94" r="10.5" fill="none" stroke="#7a4a2a" strokeWidth="0.15" opacity="0.5" />
      </g>

      <polygon
        points="50,86 66,70 50,54 34,70"
        fill={`url(#${infieldGrassGradId})`}
      />
      <polygon
        points="50,86 66,70 50,54 34,70"
        fill={`url(#${mowId})`}
      />
      <polygon
        points="50,86 66,70 50,54 34,70"
        fill="none"
        stroke="#f5f5f0"
        strokeWidth="0.35"
        opacity="0.55"
      />

      <g clipPath={`url(#${grassClipId})`}>
        <line x1="50" y1="92" x2="100" y2="23" stroke="#f5f5f0" strokeWidth="0.7" strokeLinecap="round" />
        <line x1="50" y1="92" x2="0" y2="23" stroke="#f5f5f0" strokeWidth="0.7" strokeLinecap="round" />
      </g>

      <g filter={`url(#${moundShadowId})`}>
        <circle cx="50" cy="73" r="3.2" fill={`url(#${moundGradId})`} />
        <ellipse cx="50" cy="72.2" rx="2.2" ry="0.6" fill="#b8825c" opacity="0.45" />
        <rect x="48.85" y="72.78" width="2.3" height="0.45" rx="0.1" fill="#f5f5f0" opacity="0.95" />
      </g>

      <g>
        <circle cx="34" cy="98" r="3.2" fill={`url(#${dirtGradId})`} opacity="0.55" />
        <circle cx="66" cy="98" r="3.2" fill={`url(#${dirtGradId})`} opacity="0.55" />
        <circle cx="34" cy="98" r="3.2" fill="none" stroke="#f5f5f0" strokeWidth="0.18" opacity="0.45" />
        <circle cx="66" cy="98" r="3.2" fill="none" stroke="#f5f5f0" strokeWidth="0.18" opacity="0.45" />
      </g>

      <g>
        <rect x="43.4" y="91.2" width="3.6" height="5.4" fill="none" stroke="#f5f5f0" strokeWidth="0.28" opacity="0.9" />
        <rect x="53" y="91.2" width="3.6" height="5.4" fill="none" stroke="#f5f5f0" strokeWidth="0.28" opacity="0.9" />
      </g>

      <g>
        <rect x="20" y="80" width="6" height="2.4" fill="none" stroke="#f5f5f0" strokeWidth="0.25" opacity="0.7" transform="rotate(-35 23 81.2)" />
        <rect x="74" y="80" width="6" height="2.4" fill="none" stroke="#f5f5f0" strokeWidth="0.25" opacity="0.7" transform="rotate(35 77 81.2)" />
      </g>

      <polygon
        points="48.1,92 51.9,92 52.3,93.6 50,95.2 47.7,93.6"
        fill="#f5f5f0"
        stroke="#1f3252"
        strokeWidth="0.32"
      />
    </>
  );
}
