"use client";

export type SprayBucket = "hit" | "out" | "other";

export interface SprayMarker {
  id: string;
  result: string;
  spray_x: number | null;
  spray_y: number | null;
  description: string | null;
}

const HIT_RESULTS = new Set(["1B", "2B", "3B", "HR"]);
const OUT_IN_PLAY_RESULTS = new Set(["FO", "GO", "LO", "PO", "IF", "DP", "TP"]);

export function bucketOf(result: string): SprayBucket {
  if (HIT_RESULTS.has(result)) return "hit";
  if (OUT_IN_PLAY_RESULTS.has(result)) return "out";
  return "other";
}

export const SPRAY_BUCKET_FILL: Record<SprayBucket, string> = {
  hit: "#3d8c3a",
  out: "#b03030",
  other: "#7a8290",
};

// Fixed field geometry. Spray (x, y) are recorded against this same
// viewBox in DefensiveDiamond, so home / foul-pole anchors must not move.
const OUTFIELD_PATH = "M 50,92 L 95,30 A 70,40 0 0 0 5,30 Z";
const OUTFIELD_ARC = "M 95,30 A 70,40 0 0 0 5,30";
// Skinned-infield arc: pie wedge centered at home along the foul-line directions.
// Radius 38 places 2B at (50,54) exactly on the back edge of the dirt.
const INFIELD_DIRT_PATH = "M 50,92 L 72.31,61.26 A 38,38 0 0 0 27.69,61.26 Z";

interface SprayFieldProps {
  markers: SprayMarker[];
  emptyMessage?: string;
  countsInLegend?: boolean;
  className?: string;
}

export function SprayField({
  markers,
  emptyMessage,
  countsInLegend = false,
  className,
}: SprayFieldProps) {
  const sprayed = markers.filter(
    (m) => m.spray_x !== null && m.spray_y !== null,
  );
  const counts = sprayed.reduce(
    (acc, m) => {
      acc[bucketOf(m.result)] += 1;
      return acc;
    },
    { hit: 0, out: 0, other: 0 } as Record<SprayBucket, number>,
  );

  return (
    <div className="space-y-3">
      <svg
        viewBox="0 0 100 100"
        className={`w-full select-none ${className ?? ""}`}
        role="img"
        aria-label="Spray chart"
      >
        <defs>
          <pattern
            id="spray-mow"
            x="0"
            y="0"
            width="6"
            height="100"
            patternUnits="userSpaceOnUse"
          >
            <rect width="6" height="100" fill="#cfe1bb" />
            <rect x="3" width="3" height="100" fill="#c6d8af" />
          </pattern>
          <clipPath id="spray-outfield-clip">
            <path d={OUTFIELD_PATH} />
          </clipPath>
        </defs>

        {/* Cream background */}
        <rect width="100" height="100" fill="#faf6ec" />

        {/* Outfield grass with subtle vertical mowing stripes */}
        <g clipPath="url(#spray-outfield-clip)">
          <rect width="100" height="100" fill="url(#spray-mow)" />
          {/* Warning track: thick tan stroke along the arc only, clipped to the
              outfield so only the inner half of the stroke shows. */}
          <path
            d={OUTFIELD_ARC}
            fill="none"
            stroke="#c9a47a"
            strokeWidth="3.5"
          />
        </g>

        {/* Outfield wall (drawn on top, no clip, sits along the arc edge) */}
        <path
          d={OUTFIELD_ARC}
          fill="none"
          stroke="#1f3252"
          strokeWidth="0.6"
        />

        {/* Infield dirt — skinned-infield curved arc */}
        <path d={INFIELD_DIRT_PATH} fill="#c9a47a" />

        {/* Batter's-box dirt around home plate so home isn't floating in cream */}
        <ellipse cx="50" cy="92" rx="8" ry="5.5" fill="#c9a47a" />

        {/* Infield grass diamond — corners aligned with the bases. */}
        <polygon points="50,86 66,70 50,54 34,70" fill="#bfd5a4" />

        {/* Pitcher's mound */}
        <circle cx="50" cy="73" r="2.6" fill="#c9a47a" />
        <rect x="48.6" y="72.7" width="2.8" height="0.6" fill="#fff" opacity="0.9" />

        {/* Bases */}
        {[
          [66, 70],
          [50, 54],
          [34, 70],
        ].map(([bx, by], i) => (
          <g key={i} transform={`translate(${bx} ${by}) rotate(45)`}>
            <rect
              x={-1.3}
              y={-1.3}
              width={2.6}
              height={2.6}
              fill="#fff"
              stroke="#1f3252"
              strokeWidth="0.3"
            />
          </g>
        ))}

        {/* Home plate */}
        <polygon
          points="47.5,91 52.5,91 53.5,94 50,96 46.5,94"
          fill="#fff"
          stroke="#1f3252"
          strokeWidth="0.35"
        />

        {/* Markers */}
        {sprayed.map((m) => {
          const x = (m.spray_x ?? 0) * 100;
          const y = (m.spray_y ?? 0) * 100;
          const fill = SPRAY_BUCKET_FILL[bucketOf(m.result)];
          return (
            <g key={m.id}>
              <circle
                cx={x}
                cy={y}
                r="1.9"
                fill={fill}
                stroke="#fff"
                strokeWidth="0.45"
              />
              {m.description && <title>{m.description}</title>}
            </g>
          );
        })}
      </svg>

      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-3">
          <Legend
            color={SPRAY_BUCKET_FILL.hit}
            label={countsInLegend ? `Hit (${counts.hit})` : "Hit"}
          />
          <Legend
            color={SPRAY_BUCKET_FILL.out}
            label={countsInLegend ? `Out (${counts.out})` : "Out"}
          />
          <Legend
            color={SPRAY_BUCKET_FILL.other}
            label={countsInLegend ? `Other (${counts.other})` : "Other"}
          />
        </div>
        <span className="text-muted-foreground">
          {sprayed.length} batted ball{sprayed.length === 1 ? "" : "s"}
        </span>
      </div>

      {sprayed.length === 0 && emptyMessage && (
        <p className="text-xs text-muted-foreground italic text-center">
          {emptyMessage}
        </p>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full border border-white"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
