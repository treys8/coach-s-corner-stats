"use client";

import { FieldBackground } from "@/components/scoring/FieldBackground";
import type { ReplayState } from "@/lib/scoring/types";

interface LiveSprayChartProps {
  state: ReplayState;
  /** Player_id (ours) or opponent_player_id (theirs) of the batter currently
   *  at the plate. When set, the chart only shows their batted balls so the
   *  scorer sees a per-hitter spray pattern instead of a game-wide soup. */
  currentBatterId: string | null;
  /** Whether currentBatterId refers to our roster (true) or opponent_players
   *  (false). Determines which column the markers are filtered against. */
  currentBatterIsOurs: boolean;
}

type MarkerKind = "1B" | "2B" | "3B" | "HR" | "OUT" | "ERR";

interface RenderMarker {
  id: string;
  kind: MarkerKind;
  x: number;
  y: number;
  label: string;
  title: string | null;
}

const HIT_KIND: Record<string, MarkerKind> = {
  "1B": "1B",
  "2B": "2B",
  "3B": "3B",
  HR: "HR",
};

const OUT_RESULTS = new Set(["FO", "GO", "LO", "PO", "IF", "DP", "TP"]);

const MARKER_STYLE: Record<
  MarkerKind,
  { fill: string; stroke: string; label: string; radius: number; glow: boolean }
> = {
  "1B": { fill: "#38bdf8", stroke: "#ffffff", label: "1", radius: 2.1, glow: false },
  "2B": { fill: "#22c55e", stroke: "#ffffff", label: "2", radius: 2.2, glow: false },
  "3B": { fill: "#a855f7", stroke: "#ffffff", label: "3", radius: 2.3, glow: false },
  HR:   { fill: "#f59e0b", stroke: "#ffffff", label: "HR", radius: 2.7, glow: true },
  OUT:  { fill: "#94a3b8", stroke: "#ffffff", label: "",   radius: 1.6, glow: false },
  ERR:  { fill: "#1f2937", stroke: "#ef4444", label: "E",  radius: 2.0, glow: false },
};

const LEGEND: Array<{ kind: MarkerKind; label: string }> = [
  { kind: "1B",  label: "1B" },
  { kind: "2B",  label: "2B" },
  { kind: "3B",  label: "3B" },
  { kind: "HR",  label: "HR" },
  { kind: "OUT", label: "Out" },
  { kind: "ERR", label: "Error" },
];

function classify(result: string): MarkerKind | null {
  if (HIT_KIND[result]) return HIT_KIND[result];
  if (result === "E") return "ERR";
  if (OUT_RESULTS.has(result)) return "OUT";
  return null;
}

export function LiveSprayChart({
  state,
  currentBatterId,
  currentBatterIsOurs,
}: LiveSprayChartProps) {
  const filtered = currentBatterId
    ? state.at_bats.filter((ab) =>
        currentBatterIsOurs
          ? ab.batter_id === currentBatterId
          : ab.opponent_batter_id === currentBatterId,
      )
    : [];

  const markers: RenderMarker[] = filtered
    .map((ab): RenderMarker | null => {
      if (ab.spray_x === null || ab.spray_y === null) return null;
      const kind = classify(ab.result);
      if (!kind) return null;
      return {
        id: ab.event_id,
        kind,
        x: ab.spray_x * 100,
        y: ab.spray_y * 100,
        label: MARKER_STYLE[kind].label,
        title: ab.description,
      };
    })
    .filter((m): m is RenderMarker => m !== null);

  const ordered = [...markers].sort(
    (a, b) => kindZ(a.kind) - kindZ(b.kind),
  );

  const emptyMessage = currentBatterId
    ? "No batted balls yet for this hitter."
    : "Waiting for a batter at the plate.";

  return (
    <div className="space-y-3">
      <svg
        viewBox="0 0 100 100"
        className="w-full select-none"
        role="img"
        aria-label="Spray chart"
      >
        <defs>
          <filter id="spray-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.4" />
            <feOffset dx="0" dy="0.35" result="off" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.55" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="spray-hr-glow" x="-75%" y="-75%" width="250%" height="250%">
            <feGaussianBlur stdDeviation="1.1" result="blur" />
            <feComponentTransfer in="blur" result="glow">
              <feFuncA type="linear" slope="0.9" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <FieldBackground idSuffix="spray" />

        {ordered.map((m) => {
          const style = MARKER_STYLE[m.kind];
          const filter = style.glow ? "url(#spray-hr-glow)" : "url(#spray-shadow)";
          return (
            <g key={m.id} filter={filter}>
              <circle
                cx={m.x}
                cy={m.y}
                r={style.radius + 0.55}
                fill="#ffffff"
                opacity={0.95}
              />
              <circle
                cx={m.x}
                cy={m.y}
                r={style.radius}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={m.kind === "ERR" ? 0.55 : 0.35}
              />
              {style.label && (
                <text
                  x={m.x}
                  y={m.y + (style.label.length > 1 ? 0.55 : 0.7)}
                  textAnchor="middle"
                  fontSize={style.label.length > 1 ? 1.6 : 2.0}
                  fontWeight={700}
                  fill="#ffffff"
                  style={{ paintOrder: "stroke" }}
                  stroke="rgba(15,23,42,0.45)"
                  strokeWidth={0.15}
                >
                  {style.label}
                </text>
              )}
              {m.title && <title>{m.title}</title>}
            </g>
          );
        })}
      </svg>

      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-2.5 flex-wrap">
          {LEGEND.map(({ kind, label }) => (
            <LegendChip key={kind} kind={kind} label={label} />
          ))}
        </div>
        <span className="text-muted-foreground">
          {ordered.length} batted ball{ordered.length === 1 ? "" : "s"}
        </span>
      </div>

      {ordered.length === 0 && (
        <p className="text-xs text-muted-foreground italic text-center">
          {emptyMessage}
        </p>
      )}
    </div>
  );
}

function LegendChip({ kind, label }: { kind: MarkerKind; label: string }) {
  const style = MARKER_STYLE[kind];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{
          backgroundColor: style.fill,
          boxShadow: `0 0 0 1px ${style.stroke}, 0 1px 1.5px rgba(0,0,0,0.35)`,
        }}
      />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function kindZ(kind: MarkerKind): number {
  switch (kind) {
    case "OUT": return 0;
    case "1B":  return 1;
    case "ERR": return 2;
    case "2B":  return 3;
    case "3B":  return 4;
    case "HR":  return 5;
  }
}
