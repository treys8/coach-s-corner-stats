"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { OpposingLineupSlot, ReplayState } from "@/lib/scoring/types";
import { BASE_XY, FIELDER_POSITIONS, POSITION_XY, type FielderPosition } from "./diamond-geometry";
import { FieldBackground } from "./FieldBackground";

export { FIELDER_POSITIONS, type FielderPosition };

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

// Prefer jersey for the chip label (compact, recognizable at a glance).
// Falls back to last name when no jersey is known, and to the generic
// R1/R2/R3 when the runner can't be resolved at all.
function runnerChipLabel(
  base: "first" | "second" | "third",
  playerId: string | null,
  names: Map<string, string>,
  weAreBatting: boolean,
  opposingLineup: OpposingLineupSlot[],
): string {
  if (playerId) {
    if (weAreBatting) {
      const full = names.get(playerId);
      if (full) {
        const m = full.match(/^#(\S+)\s+/);
        if (m) return m[1];
        return lastNameOf(full);
      }
    } else {
      const slot = opposingLineup.find((s) => s.opponent_player_id === playerId);
      if (slot?.jersey_number) return slot.jersey_number;
      if (slot?.last_name) return slot.last_name;
    }
  }
  return BASE_GENERIC[base];
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
      <FieldBackground idSuffix="defense" />

      {/* Bases (rotated squares; orange when occupied). The runner's jersey
          number (or last name / R1-3 fallback) sits inside the orange chip
          so coaches can identify base-runners at a glance. */}
      {(["first", "second", "third"] as const).map((b) => {
        const [bx, by] = BASE_XY[b];
        const runner = state.bases[b];
        const occupied = runner !== null;
        const tappable = occupied && !dragMode && !!onRunnerAction;
        const label = occupied
          ? runnerChipLabel(b, runner?.player_id ?? null, names, weAreBatting, state.opposing_lineup)
          : null;
        // Shrink the label slightly when it's longer than two characters so
        // jerseys / short last-name fallbacks still fit inside the chip.
        const labelFont = label && label.length > 2 ? 2.2 : 2.8;
        return (
          <g
            key={b}
            onClick={tappable ? () => onRunnerAction!(b, runner?.player_id ?? null) : undefined}
            style={tappable ? { cursor: "pointer" } : undefined}
            data-base={b}
          >
            {tappable && (
              <title>Tap to record runner action</title>
            )}
            <g transform={`translate(${bx} ${by}) rotate(45)`}>
              <rect
                x={-2.6} y={-2.6} width={5.2} height={5.2}
                fill={occupied ? "#ee8233" : "#fff"}
                stroke="#1f3252" strokeWidth="0.35"
              />
            </g>
            {label && (
              <text
                x={bx} y={by + labelFont / 3}
                textAnchor="middle"
                fontSize={labelFont}
                fontWeight="700"
                fill="#fff"
                pointerEvents="none"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
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
          </g>
        );
      })}
    </svg>
  );
}
