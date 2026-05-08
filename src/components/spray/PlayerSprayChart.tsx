"use client";

const HOME = { x: 50, y: 92 } as const;

type Bucket = "hit" | "out" | "other";

const HIT_RESULTS = new Set(["1B", "2B", "3B", "HR"]);
const OUT_IN_PLAY_RESULTS = new Set(["FO", "GO", "LO", "PO", "IF", "DP", "TP"]);

function bucketOf(result: string): Bucket {
  if (HIT_RESULTS.has(result)) return "hit";
  if (OUT_IN_PLAY_RESULTS.has(result)) return "out";
  return "other";
}

const BUCKET_FILL: Record<Bucket, string> = {
  hit: "#3d8c3a",
  out: "#b03030",
  other: "#6b7280",
};

export interface SprayMarker {
  id: string;
  result: string;
  spray_x: number | null;
  spray_y: number | null;
  description: string | null;
}

interface PlayerSprayChartProps {
  markers: SprayMarker[];
}

export function PlayerSprayChart({ markers }: PlayerSprayChartProps) {
  const sprayed = markers.filter((m) => m.spray_x !== null && m.spray_y !== null);
  const counts = sprayed.reduce(
    (acc, m) => {
      const b = bucketOf(m.result);
      acc[b] += 1;
      return acc;
    },
    { hit: 0, out: 0, other: 0 } as Record<Bucket, number>,
  );

  return (
    <div className="space-y-3">
      <svg
        viewBox="0 0 100 100"
        className="w-full max-w-xl mx-auto select-none"
        role="img"
        aria-label="Spray chart of this player's batted balls"
      >
        <path
          d="M 50,92 L 95,30 A 70,40 0 0 0 5,30 Z"
          fill="#4d8c3f"
          opacity="0.22"
        />
        <path
          d="M 50,92 L 66,70 L 50,54 L 34,70 Z"
          fill="#c9a47a"
          opacity="0.55"
        />
        <line x1="50" y1="92" x2="95" y2="30" stroke="#fff" strokeWidth="0.4" opacity="0.7" />
        <line x1="50" y1="92" x2="5"  y2="30" stroke="#fff" strokeWidth="0.4" opacity="0.7" />
        <polygon
          points="47.5,91 52.5,91 53.5,94 50,96 46.5,94"
          fill="#fff" stroke="#1f3252" strokeWidth="0.35"
        />

        {sprayed.map((m) => {
          const x = (m.spray_x ?? 0) * 100;
          const y = (m.spray_y ?? 0) * 100;
          const fill = BUCKET_FILL[bucketOf(m.result)];
          return (
            <line
              key={`l-${m.id}`}
              x1={HOME.x} y1={HOME.y} x2={x} y2={y}
              stroke={fill} strokeWidth="0.35" opacity="0.55"
            />
          );
        })}

        {sprayed.map((m) => {
          const x = (m.spray_x ?? 0) * 100;
          const y = (m.spray_y ?? 0) * 100;
          const fill = BUCKET_FILL[bucketOf(m.result)];
          return (
            <g key={`m-${m.id}`}>
              <circle cx={x} cy={y} r="1.8" fill={fill} stroke="#fff" strokeWidth="0.4" />
              {m.description && <title>{m.description}</title>}
            </g>
          );
        })}
      </svg>

      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-3">
          <Legend color={BUCKET_FILL.hit} label={`Hit (${counts.hit})`} />
          <Legend color={BUCKET_FILL.out} label={`Out (${counts.out})`} />
          <Legend color={BUCKET_FILL.other} label={`Other (${counts.other})`} />
        </div>
        <span className="text-muted-foreground">
          {sprayed.length} batted ball{sprayed.length === 1 ? "" : "s"}
        </span>
      </div>

      {sprayed.length === 0 && (
        <p className="text-sm text-muted-foreground italic text-center">
          No batted-ball data yet. Spray data is captured during tablet scoring when a fielder is dragged to the ball location.
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
