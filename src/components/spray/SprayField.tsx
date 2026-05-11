"use client";

import { FieldBackground } from "@/components/scoring/FieldBackground";

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
        <FieldBackground idSuffix="spray" />

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
