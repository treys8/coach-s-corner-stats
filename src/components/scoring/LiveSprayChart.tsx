"use client";

import type { DerivedAtBat, ReplayState } from "@/lib/scoring/types";

const HOME = { x: 50, y: 92 } as const;

type Bucket = "hit" | "out" | "other";

const HIT_RESULTS = new Set(["1B", "2B", "3B", "HR"]);
const OUT_IN_PLAY_RESULTS = new Set(["FO", "GO", "LO", "PO", "IF", "DP", "TP"]);

function bucketOf(ab: DerivedAtBat): Bucket {
  if (HIT_RESULTS.has(ab.result)) return "hit";
  if (OUT_IN_PLAY_RESULTS.has(ab.result)) return "out";
  return "other";
}

const BUCKET_FILL: Record<Bucket, string> = {
  hit: "#3d8c3a",
  out: "#b03030",
  other: "#6b7280",
};

interface LiveSprayChartProps {
  state: ReplayState;
}

export function LiveSprayChart({ state }: LiveSprayChartProps) {
  const sprayed = state.at_bats.filter(
    (ab) => ab.spray_x !== null && ab.spray_y !== null,
  );

  return (
    <div className="space-y-3">
      <svg
        viewBox="0 0 100 100"
        className="w-full select-none"
        role="img"
        aria-label="Spray chart of batted balls in this game"
      >
        {/* Fair territory */}
        <path
          d="M 50,92 L 95,30 A 70,40 0 0 0 5,30 Z"
          fill="#4d8c3f"
          opacity="0.22"
        />
        {/* Infield dirt */}
        <path
          d="M 50,92 L 66,70 L 50,54 L 34,70 Z"
          fill="#c9a47a"
          opacity="0.55"
        />
        {/* Foul lines */}
        <line x1="50" y1="92" x2="95" y2="30" stroke="#fff" strokeWidth="0.4" opacity="0.7" />
        <line x1="50" y1="92" x2="5"  y2="30" stroke="#fff" strokeWidth="0.4" opacity="0.7" />
        {/* Home plate */}
        <polygon
          points="47.5,91 52.5,91 53.5,94 50,96 46.5,94"
          fill="#fff" stroke="#1f3252" strokeWidth="0.35"
        />

        {/* Lines from home to each marker */}
        {sprayed.map((ab) => {
          const x = (ab.spray_x ?? 0) * 100;
          const y = (ab.spray_y ?? 0) * 100;
          const fill = BUCKET_FILL[bucketOf(ab)];
          return (
            <line
              key={`l-${ab.event_id}`}
              x1={HOME.x} y1={HOME.y}
              x2={x} y2={y}
              stroke={fill}
              strokeWidth="0.35"
              opacity="0.6"
            />
          );
        })}

        {/* Markers */}
        {sprayed.map((ab) => {
          const x = (ab.spray_x ?? 0) * 100;
          const y = (ab.spray_y ?? 0) * 100;
          const fill = BUCKET_FILL[bucketOf(ab)];
          return (
            <g key={`m-${ab.event_id}`}>
              <circle cx={x} cy={y} r="2" fill={fill} stroke="#fff" strokeWidth="0.4" />
              {ab.description && <title>{ab.description}</title>}
            </g>
          );
        })}
      </svg>

      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-3">
          <Legend color={BUCKET_FILL.hit} label="Hit" />
          <Legend color={BUCKET_FILL.out} label="Out" />
          <Legend color={BUCKET_FILL.other} label="Other" />
        </div>
        <span className="text-muted-foreground">
          {sprayed.length} batted ball{sprayed.length === 1 ? "" : "s"}
        </span>
      </div>

      {sprayed.length === 0 && (
        <p className="text-xs text-muted-foreground italic text-center">
          Field-tap data appears here as balls are put in play.
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
