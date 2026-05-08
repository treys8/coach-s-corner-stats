"use client";

import { useRef } from "react";

// Normalized field coordinates: x ∈ [0, 1] left→right, y ∈ [0, 1] top→bottom
// (so home plate sits near y ≈ 1 and the outfield wall near y ≈ 0).
//
// Fielder anchor positions are best-guesses — picked so that a tap anywhere
// in a typical zone resolves to the right fielder. Adjust if it feels off
// after coaches use it for a few games.
const FIELDER_ANCHORS: ReadonlyArray<{ pos: string; x: number; y: number }> = [
  { pos: "P",  x: 0.50, y: 0.70 },
  { pos: "C",  x: 0.50, y: 0.92 },
  { pos: "1B", x: 0.68, y: 0.65 },
  { pos: "2B", x: 0.58, y: 0.50 },
  { pos: "3B", x: 0.32, y: 0.65 },
  { pos: "SS", x: 0.42, y: 0.50 },
  { pos: "LF", x: 0.20, y: 0.25 },
  { pos: "CF", x: 0.50, y: 0.18 },
  { pos: "RF", x: 0.80, y: 0.25 },
];

export interface SprayHit {
  x: number;
  y: number;
  fielder: string;
}

function nearestFielder(x: number, y: number): string {
  let best = FIELDER_ANCHORS[0];
  let bestDist = Infinity;
  for (const f of FIELDER_ANCHORS) {
    const dx = f.x - x;
    const dy = f.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best.pos;
}

export interface FieldTapProps {
  pending: SprayHit | null;
  onTap: (hit: SprayHit) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function FieldTap({ pending, onTap, onClear, disabled }: FieldTapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (disabled) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onTap({ x, y, fielder: nearestFielder(x, y) });
  };

  return (
    <div className="rounded border border-border bg-muted/30 p-2">
      <div className="flex items-center justify-between mb-1 text-xs uppercase tracking-wider">
        <span className="text-muted-foreground">
          Tap field to capture spray
          {pending && (
            <span className="ml-2 text-sa-blue-deep font-semibold">
              → {pending.fielder}
            </span>
          )}
        </span>
        {pending && (
          <button
            type="button"
            onClick={onClear}
            className="text-sa-orange hover:underline disabled:opacity-50"
            disabled={disabled}
          >
            Clear
          </button>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        onClick={handleClick}
        role="img"
        aria-label="Baseball field — tap to record spray location"
        className={`w-full h-48 select-none ${disabled ? "opacity-60" : "cursor-crosshair"}`}
      >
        {/* Outfield grass */}
        <path d="M 50 95 L 5 5 A 60 60 0 0 1 95 5 Z" fill="#bee5b6" stroke="#94c98b" strokeWidth="0.4" />
        {/* Infield dirt */}
        <path d="M 50 95 L 25 70 L 50 45 L 75 70 Z" fill="#d6b48a" stroke="#a68353" strokeWidth="0.4" />
        {/* Foul lines */}
        <line x1="50" y1="95" x2="5" y2="5" stroke="#fff" strokeWidth="0.5" />
        <line x1="50" y1="95" x2="95" y2="5" stroke="#fff" strokeWidth="0.5" />
        {/* Bases */}
        <BaseMark cx={50} cy={45} />
        <BaseMark cx={75} cy={70} />
        <BaseMark cx={25} cy={70} />
        <BaseMark cx={50} cy={95} />
        {/* Pitcher's mound */}
        <circle cx={50} cy={70} r="2" fill="#a68353" stroke="#fff" strokeWidth="0.3" />

        {/* Fielder anchors */}
        {FIELDER_ANCHORS.map((f) => (
          <g key={f.pos}>
            <circle cx={f.x * 100} cy={f.y * 100} r="2.5" fill="#1e3a8a" opacity="0.6" />
            <text
              x={f.x * 100}
              y={f.y * 100 + 1}
              textAnchor="middle"
              fontSize="3"
              fill="white"
              fontWeight="bold"
              pointerEvents="none"
            >
              {f.pos}
            </text>
          </g>
        ))}

        {/* Pending tap marker */}
        {pending && (
          <g pointerEvents="none">
            <circle
              cx={pending.x * 100}
              cy={pending.y * 100}
              r="2.5"
              fill="#f97316"
              stroke="#fff"
              strokeWidth="0.6"
            />
            <circle
              cx={pending.x * 100}
              cy={pending.y * 100}
              r="5"
              fill="none"
              stroke="#f97316"
              strokeWidth="0.5"
              opacity="0.5"
            />
          </g>
        )}
      </svg>
    </div>
  );
}

function BaseMark({ cx, cy }: { cx: number; cy: number }) {
  return (
    <rect
      x={cx - 1.5}
      y={cy - 1.5}
      width="3"
      height="3"
      transform={`rotate(45 ${cx} ${cy})`}
      fill="white"
      stroke="#94a3b8"
      strokeWidth="0.3"
    />
  );
}
