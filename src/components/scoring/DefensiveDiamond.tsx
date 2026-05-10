"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ReplayState } from "@/lib/scoring/types";

export const FIELDER_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
export type FielderPosition = (typeof FIELDER_POSITIONS)[number];

// Canonical fielder centers in a 100x100 viewBox with home at the bottom-center
// and CF at the top-center. Drag-to-score uses these as starting points.
const POSITION_XY: Record<FielderPosition, [number, number]> = {
  P:  [50, 60],
  C:  [50, 95],
  "1B": [62, 65],
  "2B": [58, 50],
  SS: [42, 50],
  "3B": [38, 65],
  LF: [22, 32],
  CF: [50, 22],
  RF: [78, 32],
};

const BASE_XY = {
  first:  [66, 70],
  second: [50, 54],
  third:  [34, 70],
} as const;

interface DefensiveDiamondProps {
  state: ReplayState;
  /** Map from player_id → display label (e.g., "#5 Koester"). */
  names: Map<string, string>;
  /** When we're batting we don't know opposing fielders — show position labels only. */
  weAreBatting: boolean;
  /** When set, fielders become draggable. Drop fires onFielderDrop. */
  dragMode?: boolean;
  onFielderDrop?: (x: number, y: number, fielderPosition: FielderPosition) => void;
  /** When set (and not in dragMode), tapping an occupied base fires this. */
  onRunnerAction?: (
    base: "first" | "second" | "third",
    runnerId: string | null,
  ) => void;
}

interface FielderRow {
  position: FielderPosition;
  player_id: string | null;
}

// When we're batting, runners are ours and we know names. When we're
// fielding, the opposing team is on base — show generic R1/R2/R3 labels.
const BASE_GENERIC: Record<"first" | "second" | "third", string> = {
  first: "R1",
  second: "R2",
  third: "R3",
};

function lastNameOf(full: string): string {
  // names are formatted "#5 Koester" or "Koester Smith" — strip a leading
  // jersey token, then take the last whitespace-separated word.
  const noJersey = full.replace(/^#\S+\s+/, "");
  const parts = noJersey.trim().split(/\s+/);
  return parts[parts.length - 1] ?? full;
}

function runnerLabel(
  base: "first" | "second" | "third",
  playerId: string | null,
  names: Map<string, string>,
  weAreBatting: boolean,
): string {
  if (!weAreBatting) return BASE_GENERIC[base];
  if (!playerId) return BASE_GENERIC[base];
  const full = names.get(playerId);
  return full ? lastNameOf(full) : BASE_GENERIC[base];
}

// Pitcher tracks current_pitcher_id (pitching_change events don't touch the
// lineup). All other positions come from our_lineup.
function ourFielders(state: ReplayState): FielderRow[] {
  const fromLineup = state.our_lineup
    .filter((s) => s.position && s.position !== "DH" && s.position !== "P")
    .map((s) => ({ position: s.position as FielderPosition, player_id: s.player_id }));
  return [
    { position: "P", player_id: state.current_pitcher_id },
    ...fromLineup,
  ];
}

export function DefensiveDiamond({
  state,
  names,
  weAreBatting,
  dragMode = false,
  onFielderDrop,
  onRunnerAction,
}: DefensiveDiamondProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{
    position: FielderPosition;
    x: number;
    y: number;
  } | null>(null);

  const fielderByPos = useMemo(() => {
    const m = new Map<FielderPosition, FielderRow>();
    if (!weAreBatting) for (const f of ourFielders(state)) m.set(f.position, f);
    return m;
  }, [state, weAreBatting]);

  const svgCoords = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  };

  const beginDrag = (
    e: ReactPointerEvent<SVGGElement>,
    position: FielderPosition,
  ) => {
    if (!dragMode) return;
    e.preventDefault();
    const c = svgCoords(e.clientX, e.clientY);
    if (!c) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ position, x: c.x, y: c.y });
  };

  const continueDrag = (e: ReactPointerEvent<SVGGElement>) => {
    if (!drag) return;
    const c = svgCoords(e.clientX, e.clientY);
    if (!c) return;
    setDrag({ ...drag, x: c.x, y: c.y });
  };

  const endDrag = (e: ReactPointerEvent<SVGGElement>) => {
    if (!drag) return;
    const c = svgCoords(e.clientX, e.clientY) ?? { x: drag.x, y: drag.y };
    const { position } = drag;
    setDrag(null);
    onFielderDrop?.(c.x / 100, c.y / 100, position);
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      className={`w-full max-w-md mx-auto select-none touch-none ${dragMode ? "cursor-grab" : ""}`}
      role="img"
      aria-label={dragMode ? "Drag the fielder who made the play to the ball location" : "Defensive alignment"}
    >
      {/* Fair territory (outfield grass) */}
      <path
        d="M 50,92 L 95,30 A 70,40 0 0 0 5,30 Z"
        fill="#4d8c3f"
        opacity="0.22"
      />
      {/* Infield dirt diamond */}
      <path
        d="M 50,92 L 66,70 L 50,54 L 34,70 Z"
        fill="#c9a47a"
        opacity="0.55"
      />
      {/* Foul lines */}
      <line x1="50" y1="92" x2="95" y2="30" stroke="#fff" strokeWidth="0.4" opacity="0.7" />
      <line x1="50" y1="92" x2="5"  y2="30" stroke="#fff" strokeWidth="0.4" opacity="0.7" />

      {/* Pitcher's mound */}
      <circle cx="50" cy="60" r="2.2" fill="#c9a47a" stroke="#1f3252" strokeWidth="0.3" opacity="0.9" />

      {/* Bases (rotated squares; orange when occupied) */}
      {(["first", "second", "third"] as const).map((b) => {
        const [bx, by] = BASE_XY[b];
        const runner = state.bases[b];
        const occupied = runner !== null;
        const tappable = occupied && !dragMode && !!onRunnerAction;
        return (
          <g
            key={b}
            onClick={tappable ? () => onRunnerAction!(b, runner?.player_id ?? null) : undefined}
            style={tappable ? { cursor: "pointer" } : undefined}
            data-base={b}
          >
            <g transform={`translate(${bx} ${by}) rotate(45)`}>
              <rect
                x={-2.2} y={-2.2} width={4.4} height={4.4}
                fill={occupied ? "#ee8233" : "#fff"}
                stroke="#1f3252" strokeWidth="0.35"
              />
            </g>
            {occupied && (
              <text
                x={bx} y={by - 4}
                textAnchor="middle"
                fontSize="2.2"
                fontWeight="700"
                fill="#1f3252"
                pointerEvents="none"
              >
                {runnerLabel(b, runner?.player_id ?? null, names, weAreBatting)}
              </text>
            )}
          </g>
        );
      })}
      {/* Home plate */}
      <polygon
        points="47.5,91 52.5,91 53.5,94 50,96 46.5,94"
        fill="#fff" stroke="#1f3252" strokeWidth="0.35"
      />

      {/* Ghost markers at canonical positions while dragging — show where each
          fielder started so the user has spatial context as they pull one out. */}
      {dragMode && drag && FIELDER_POSITIONS.map((pos) => {
        const [px, py] = POSITION_XY[pos];
        if (pos === drag.position) {
          return (
            <circle
              key={`ghost-${pos}`}
              cx={px} cy={py} r="3.2"
              fill="none" stroke="#1f3252" strokeWidth="0.4"
              strokeDasharray="1 1" opacity="0.5"
              pointerEvents="none"
            />
          );
        }
        return null;
      })}

      {/* Fielder markers (canonical position unless this fielder is being dragged) */}
      {FIELDER_POSITIONS.map((pos) => {
        const [px, py] = POSITION_XY[pos];
        const isDragging = drag?.position === pos;
        const cx = isDragging ? drag!.x : px;
        const cy = isDragging ? drag!.y : py;
        const f = fielderByPos.get(pos);
        const name = f?.player_id ? names.get(f.player_id) ?? null : null;
        const shortName = name && name.length > 14 ? name.slice(0, 13) + "…" : name;
        const grabbable = dragMode;
        return (
          <g
            key={pos}
            onPointerDown={grabbable ? (e) => beginDrag(e, pos) : undefined}
            onPointerMove={isDragging ? continueDrag : undefined}
            onPointerUp={isDragging ? endDrag : undefined}
            onPointerCancel={isDragging ? endDrag : undefined}
            style={grabbable ? { cursor: isDragging ? "grabbing" : "grab" } : undefined}
          >
            <circle
              cx={cx} cy={cy} r="3.4"
              fill={isDragging ? "#ee8233" : "#fff"}
              stroke="#1f3252" strokeWidth="0.5"
            />
            <text
              x={cx} y={cy + 1}
              textAnchor="middle"
              fontSize="2.6"
              fontWeight="700"
              fill={isDragging ? "#fff" : "#1f3252"}
              pointerEvents="none"
            >
              {pos}
            </text>
            {shortName && !isDragging && (
              <text
                x={cx} y={cy + 7}
                textAnchor="middle"
                fontSize="2.1"
                fill="#1f3252"
                opacity="0.9"
                pointerEvents="none"
              >
                {shortName}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
