"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Base, FielderTouch, OpposingLineupSlot, ReplayState } from "@/lib/scoring/types";
import { BASE_XY, FIELDER_POSITIONS, POSITION_XY, type FielderPosition } from "./diamond-geometry";
import { FieldBackground } from "./FieldBackground";

export { FIELDER_POSITIONS, type FielderPosition };

/** Drop target produced by the SAFE/OUT zones during a runner drag. */
export interface RunnerDropTarget {
  base: Base | "home";
  verdict: "safe" | "out";
}

interface DefensiveDiamondProps {
  state: ReplayState;
  /** Map from player_id → display label (e.g., "#5 Koester"). */
  names: Map<string, string>;
  /** When we're batting we don't know opposing fielders — show position labels only. */
  weAreBatting: boolean;
  /** Current batter for the on-field chip in the batter's box. When we are
   *  batting this is one of our roster ids; when we are fielding it is an
   *  `opponent_players.id` resolved via `state.opposing_lineup`. */
  currentBatterId?: string | null;
  /** When set, fielders become draggable. Drop fires onFielderDrop.
   *  Suppresses runner drag while active. */
  dragMode?: boolean;
  onFielderDrop?: (x: number, y: number, fielderPosition: FielderPosition) => void;
  /** Stage 4 — when a runner chip drag ends on a SAFE/OUT zone, fire this.
   *  When unset, runner chips fall back to the tap behavior wired via
   *  `onRunnerAction`. */
  onRunnerDrop?: (from: Base, target: RunnerDropTarget, runnerId: string | null) => void;
  /** When set (and not in dragMode), tapping an occupied base fires this. */
  onRunnerAction?: (
    base: "first" | "second" | "third",
    runnerId: string | null,
  ) => void;
  /** When true, the SVG fills the parent's height as well as width so it
   *  fits inside a fixed-row grid cell. The viewBox + preserveAspectRatio
   *  keep the diamond square (letterboxed by the parent). */
  fillContainer?: boolean;
  /** Stage 3 chain — when present, the diamond renders each step as a
   *  numbered marker at the drop spot with arrows linking the sequence.
   *  Coach can see what they've captured before committing. The step at
   *  `errorStepIndex` is recolored red. */
  chain?: FielderTouch[];
  errorStepIndex?: number | null;
}

// When we're batting, runners are ours and we know names. When we're
// fielding, the opposing team is on base — show generic R1/R2/R3 labels.
const BASE_GENERIC: Record<"first" | "second" | "third", string> = {
  first: "R1",
  second: "R2",
  third: "R3",
};

// Drop targets the runner-drag SAFE/OUT zones surface. Home is included
// only as a destination (you can't drag a runner from home).
const DROP_BASES: (Base | "home")[] = ["first", "second", "third", "home"];

// Center of home plate in SVG coords (matches FieldBackground geometry).
const HOME_XY: [number, number] = [50, 92];

// 2D offsets for SAFE/OUT zones placed relative to each base. SAFE sits
// on the "forward / center-field" side, OUT on the "back / foul" side,
// so the spatial cue matches the verdict.
const ZONE_OFFSET: Record<Base | "home", {
  safe: [number, number];
  out: [number, number];
}> = {
  first:  { safe: [+4.5, -5.0], out: [+4.5, +5.0] },
  second: { safe: [0,    -5.5], out: [0,    +5.5] },
  third:  { safe: [-4.5, -5.0], out: [-4.5, +5.0] },
  // Home plate sits at the bottom of the diamond — SAFE pulls upward
  // toward the mound (where the runner approaches from), OUT pulls
  // sideways into foul territory so it doesn't overlap the catcher.
  home:   { safe: [0,    -6.5], out: [+9.0, -2.0] },
};

// Pixel radius around a zone center that counts as a drop. Larger than
// the base diamond's half-width so finger drops are forgiving.
const ZONE_HIT_RADIUS = 5.5;

// Pixel distance (in SVG coords) that a runner pointer must move before
// the drag activates — keeps short taps routed through the tap handler
// for the existing RunnerActionDialog.
const RUNNER_DRAG_THRESHOLD = 2.5;

// Shared palette for overlay elements. Kept in sync with the cross-component
// design language used by MiniBases / FieldBackground / LiveSprayChart.
const PALETTE = {
  baseFill: "#f8f8f4",
  baseHighlight: "#ffffff",
  baseStroke: "#b8b09e",
  occupiedTop: "#f59d4a",
  occupiedBottom: "#d96a1f",
  chalk: "#f5f5f0",
  teamTop: "#1f4fb8",
  teamBottom: "#0b2a72",
  fielderInk: "#0e1a14",
} as const;

function lastNameOf(full: string): string {
  // names are formatted "#5 Koester" or "Koester Smith" — strip a leading
  // jersey token, then take the last whitespace-separated word.
  const noJersey = full.replace(/^#\S+\s+/, "");
  const parts = noJersey.trim().split(/\s+/);
  return parts[parts.length - 1] ?? full;
}

// Fielder label = "F Last" (first initial + last name) when we have both,
// matching GameChanger's on-field name style. Single-word names fall back
// to the bare name.
function fielderNameLabel(full: string): string {
  const noJersey = full.replace(/^#\S+\s+/, "").trim();
  const parts = noJersey.split(/\s+/);
  if (parts.length >= 2) {
    const firstInitial = parts[0][0]?.toUpperCase() ?? "";
    const last = parts[parts.length - 1];
    return firstInitial ? `${firstInitial} ${last}` : last;
  }
  return parts[0] ?? full;
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

// Compact batter chip label — jersey number when known (prefixed with #),
// otherwise last-name initial, with "AB" as a final fallback. The chip lives
// inside the batter's box at home plate so it has to stay tiny (2–3 chars).
function batterChipLabel(
  playerId: string,
  names: Map<string, string>,
  weAreBatting: boolean,
  opposingLineup: OpposingLineupSlot[],
): string {
  if (weAreBatting) {
    const full = names.get(playerId);
    if (!full) return "AB";
    const jerseyMatch = full.match(/^#(\S+)\s+/);
    if (jerseyMatch) return `#${jerseyMatch[1]}`;
    return lastNameOf(full).slice(0, 1).toUpperCase() || "AB";
  }
  const slot = opposingLineup.find((s) => s.opponent_player_id === playerId);
  if (!slot) return "AB";
  if (slot.jersey_number) return `#${slot.jersey_number}`;
  if (slot.last_name) return slot.last_name.slice(0, 1).toUpperCase();
  return "AB";
}

interface RunnerDragState {
  from: Base;
  runnerId: string | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** True once the pointer moved past RUNNER_DRAG_THRESHOLD — until then
   *  the gesture can still resolve as a tap. */
  active: boolean;
  /** Highlighted drop target under the current pointer, if any. */
  hover: RunnerDropTarget | null;
}

export function DefensiveDiamond({
  state,
  names,
  weAreBatting,
  currentBatterId,
  dragMode = false,
  onFielderDrop,
  onRunnerDrop,
  onRunnerAction,
  fillContainer = false,
  chain,
  errorStepIndex = null,
}: DefensiveDiamondProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{
    position: FielderPosition;
    x: number;
    y: number;
  } | null>(null);
  const [runnerDrag, setRunnerDrag] = useState<RunnerDragState | null>(null);
  // Per-step drop coordinates for the chain markers. Kept in sync with
  // `chain` length: appended on each drop (via endDrag), truncated when
  // the hook shrinks chain (undo step), cleared when chain is empty
  // (commit / cancel).
  const [markerCoords, setMarkerCoords] = useState<{ x: number; y: number }[]>([]);
  const chainLen = chain?.length ?? 0;
  useEffect(() => {
    setMarkerCoords((prev) => (prev.length > chainLen ? prev.slice(0, chainLen) : prev));
  }, [chainLen]);

  const svgCoords = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    // Use the SVG's CTM so the mapping honors `preserveAspectRatio="xMidYMid meet"`.
    // A naive bounding-rect ratio skews pointer→viewBox when the container is
    // wider (or taller) than the 1:1 viewBox — chip ends up offset from the finger.
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
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
    // Optimistically record the drop in our local marker list. If the
    // parent rejects the drop (no-op), the chain prop won't grow and the
    // useEffect above will trim this entry on the next render — markers
    // stay in sync with the canonical chain.
    setMarkerCoords((prev) => [...prev, { x: c.x, y: c.y }]);
    onFielderDrop?.(c.x / 100, c.y / 100, position);
  };

  // Compute hover target by snapping pointer to nearest SAFE/OUT zone
  // within ZONE_HIT_RADIUS. Returns null when no zone is close.
  const hoverTargetAt = (x: number, y: number): RunnerDropTarget | null => {
    let best: { tgt: RunnerDropTarget; d: number } | null = null;
    for (const base of DROP_BASES) {
      const [bx, by] = base === "home" ? HOME_XY : BASE_XY[base];
      const offsets = ZONE_OFFSET[base];
      const safe: [number, number] = [bx + offsets.safe[0], by + offsets.safe[1]];
      const out: [number, number]  = [bx + offsets.out[0],  by + offsets.out[1]];
      const dSafe = Math.hypot(x - safe[0], y - safe[1]);
      if (dSafe <= ZONE_HIT_RADIUS && (!best || dSafe < best.d)) {
        best = { tgt: { base, verdict: "safe" }, d: dSafe };
      }
      const dOut = Math.hypot(x - out[0], y - out[1]);
      if (dOut <= ZONE_HIT_RADIUS && (!best || dOut < best.d)) {
        best = { tgt: { base, verdict: "out" }, d: dOut };
      }
    }
    return best?.tgt ?? null;
  };

  const beginRunnerDrag = (
    e: ReactPointerEvent<SVGGElement>,
    base: Base,
    runnerId: string | null,
  ) => {
    if (dragMode) return;
    if (!onRunnerDrop) return;
    e.preventDefault();
    const c = svgCoords(e.clientX, e.clientY);
    if (!c) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setRunnerDrag({
      from: base,
      runnerId,
      startX: c.x,
      startY: c.y,
      x: c.x,
      y: c.y,
      active: false,
      hover: null,
    });
  };

  const continueRunnerDrag = (e: ReactPointerEvent<SVGGElement>) => {
    if (!runnerDrag) return;
    const c = svgCoords(e.clientX, e.clientY);
    if (!c) return;
    const moved = Math.hypot(c.x - runnerDrag.startX, c.y - runnerDrag.startY);
    const active = runnerDrag.active || moved >= RUNNER_DRAG_THRESHOLD;
    const hover = active ? hoverTargetAt(c.x, c.y) : null;
    setRunnerDrag({ ...runnerDrag, x: c.x, y: c.y, active, hover });
  };

  const endRunnerDrag = (e: ReactPointerEvent<SVGGElement>) => {
    if (!runnerDrag) return;
    const c = svgCoords(e.clientX, e.clientY) ?? { x: runnerDrag.x, y: runnerDrag.y };
    const wasActive = runnerDrag.active;
    const { from, runnerId } = runnerDrag;
    setRunnerDrag(null);
    if (!wasActive) {
      // No meaningful movement — treat as a tap. Route through the
      // existing RunnerActionDialog opener if provided.
      onRunnerAction?.(from, runnerId);
      return;
    }
    const target = hoverTargetAt(c.x, c.y);
    if (!target) return; // dropped outside any zone — cancelled
    onRunnerDrop?.(from, target, runnerId);
  };

  const runnerDragShowing = runnerDrag !== null && runnerDrag.active;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      className={`${fillContainer ? "w-full h-full" : "w-full"} select-none touch-none ${dragMode ? "cursor-grab" : ""}`}
      role="img"
      aria-label={dragMode ? "Drag the fielder who made the play to the ball location" : "Defensive alignment"}
    >
      <FieldBackground idSuffix="defense" />

      <defs>
        <filter id="dd-soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.45" />
          <feOffset dx="0" dy="0.35" result="offsetBlur" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.55" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="dd-text-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.18" />
          <feOffset dx="0" dy="0.22" result="offsetBlur" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.7" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="dd-base-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={PALETTE.baseHighlight} />
          <stop offset="55%" stopColor={PALETTE.baseFill} />
          <stop offset="100%" stopColor="#e8e3d4" />
        </linearGradient>
        <linearGradient id="dd-base-occupied" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffb774" />
          <stop offset="55%" stopColor={PALETTE.occupiedTop} />
          <stop offset="100%" stopColor={PALETTE.occupiedBottom} />
        </linearGradient>
        <radialGradient id="dd-position-dot" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#5b86e0" />
          <stop offset="55%" stopColor={PALETTE.teamTop} />
          <stop offset="100%" stopColor={PALETTE.teamBottom} />
        </radialGradient>
        <radialGradient id="dd-runner-dot" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#ffc38a" />
          <stop offset="55%" stopColor={PALETTE.occupiedTop} />
          <stop offset="100%" stopColor={PALETTE.occupiedBottom} />
        </radialGradient>
        <linearGradient id="dd-batter-chip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a6dd1" />
          <stop offset="100%" stopColor={PALETTE.teamBottom} />
        </linearGradient>
      </defs>

      {currentBatterId && (() => {
        const label = batterChipLabel(currentBatterId, names, weAreBatting, state.opposing_lineup);
        // Sit the chip inside the left batter's box (RHB stance). Box geometry
        // lives in FieldBackground: x=43.4..47, y=91.2..96.6. Chip width grows
        // with label length but stays inside the box.
        const w = Math.min(3.4, Math.max(2.4, label.length * 0.85 + 1));
        const h = 2.0;
        const cx = 45.2;
        const cy = 93.9;
        return (
          <g pointerEvents="none" filter="url(#dd-soft-shadow)">
            <rect
              x={cx - w / 2} y={cy - h / 2}
              width={w} height={h} rx={0.55}
              fill="url(#dd-batter-chip)"
              stroke={PALETTE.chalk} strokeWidth={0.22}
            />
            <rect
              x={cx - w / 2 + 0.18} y={cy - h / 2 + 0.18}
              width={w - 0.36} height={0.55} rx={0.4}
              fill={PALETTE.baseHighlight} opacity={0.22}
            />
            <text
              x={cx} y={cy + 0.55}
              textAnchor="middle"
              fontSize={1.55}
              fontWeight={700}
              fill={PALETTE.chalk}
            >
              {label}
            </text>
          </g>
        );
      })()}

      {(["first", "second", "third"] as const).map((b) => {
        const [bx, by] = BASE_XY[b];
        const runner = state.bases[b];
        const occupied = runner !== null;
        return (
          <g key={b} data-base={b} filter="url(#dd-soft-shadow)">
            <g transform={`translate(${bx} ${by}) rotate(45)`}>
              <rect
                x={-2.6} y={-2.6} width={5.2} height={5.2} rx={0.35}
                fill={occupied ? "url(#dd-base-occupied)" : "url(#dd-base-fill)"}
                stroke={occupied ? "#9a4a14" : PALETTE.baseStroke}
                strokeWidth="0.4"
              />
              <rect
                x={-2.2} y={-2.2} width={4.4} height={1.4} rx={0.25}
                fill={PALETTE.baseHighlight} opacity={0.4}
              />
            </g>
          </g>
        );
      })}

      {/* SAFE / OUT drop zones — only rendered during an active runner
          drag. Snap zones are sized via ZONE_HIT_RADIUS; the visible
          ellipse matches roughly so the coach sees the snap target. */}
      {runnerDragShowing && (
        <g pointerEvents="none">
          {DROP_BASES.map((base) => {
            const [bx, by] = base === "home" ? HOME_XY : BASE_XY[base];
            const offsets = ZONE_OFFSET[base];
            const safeC = [bx + offsets.safe[0], by + offsets.safe[1]] as const;
            const outC  = [bx + offsets.out[0],  by + offsets.out[1]]  as const;
            const hoverSafe =
              runnerDrag?.hover?.base === base && runnerDrag.hover.verdict === "safe";
            const hoverOut =
              runnerDrag?.hover?.base === base && runnerDrag.hover.verdict === "out";
            return (
              <g key={`zone-${base}`}>
                <ellipse
                  cx={safeC[0]} cy={safeC[1]} rx={5.4} ry={2.6}
                  fill="#22c55e"
                  stroke={hoverSafe ? "#fff" : "#15803d"}
                  strokeWidth={hoverSafe ? 0.7 : 0.35}
                  opacity={hoverSafe ? 1 : 0.85}
                />
                <text
                  x={safeC[0]} y={safeC[1] + 0.95}
                  textAnchor="middle"
                  fontSize={2.4}
                  fontWeight={800}
                  fill="#fff"
                >
                  SAFE
                </text>
                <ellipse
                  cx={outC[0]} cy={outC[1]} rx={5.0} ry={2.4}
                  fill="#ef4444"
                  stroke={hoverOut ? "#fff" : "#991b1b"}
                  strokeWidth={hoverOut ? 0.7 : 0.35}
                  opacity={hoverOut ? 1 : 0.85}
                />
                <text
                  x={outC[0]} y={outC[1] + 0.9}
                  textAnchor="middle"
                  fontSize={2.3}
                  fontWeight={800}
                  fill="#fff"
                >
                  OUT
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* Runner chips — separate layer from the base diamond so each chip
          can carry its own pointer events. Keyed by player_id (not base)
          so React keeps the same DOM node when a runner advances; the CSS
          transform transition then slides the chip to the new base. The
          transition is suppressed while the coach is dragging so the chip
          tracks the pointer without easing. */}
      {(["first", "second", "third"] as const).map((b) => {
        const runner = state.bases[b];
        if (!runner) return null;
        const [bx, by] = BASE_XY[b];
        const label = runnerChipLabel(b, runner.player_id, names, weAreBatting, state.opposing_lineup);
        const labelFont = label.length > 2 ? 2.2 : 2.8;
        const dragging = runnerDrag?.from === b && runnerDrag.active;
        const cx = dragging ? runnerDrag!.x : bx;
        const cy = dragging ? runnerDrag!.y : by;
        const draggable = !!onRunnerDrop && !dragMode;
        const tappable = !dragging && !dragMode && !!onRunnerAction;
        // Stable key — same player on different bases reuses the DOM node
        // so the CSS transition can animate the move. Falls back to base
        // when player_id is missing so the chip still renders.
        const stableKey = runner.player_id ?? `unknown-${b}`;
        return (
          <g
            key={stableKey}
            transform={`translate(${cx} ${cy})`}
            style={{
              transition: dragging ? "none" : "transform 200ms ease-out",
              ...(draggable
                ? { cursor: dragging ? "grabbing" : "grab" }
                : tappable
                  ? { cursor: "pointer" }
                  : undefined),
            }}
            onPointerDown={
              draggable
                ? (e) => beginRunnerDrag(e, b, runner.player_id)
                : undefined
            }
            onPointerMove={runnerDrag?.from === b ? continueRunnerDrag : undefined}
            onPointerUp={runnerDrag?.from === b ? endRunnerDrag : undefined}
            onPointerCancel={runnerDrag?.from === b ? endRunnerDrag : undefined}
          >
            {tappable && <title>Drag to SAFE/OUT or tap to record action</title>}
            <g filter="url(#dd-soft-shadow)">
              <circle
                cx={0} cy={0} r={dragging ? 3.2 : 2.8}
                fill="url(#dd-runner-dot)"
                stroke={dragging ? PALETTE.chalk : "#7a3a0e"}
                strokeWidth={dragging ? 0.55 : 0.4}
              />
              <ellipse
                cx={0} cy={-0.85} rx={1.55} ry={0.6}
                fill={PALETTE.baseHighlight} opacity={0.45}
                pointerEvents="none"
              />
            </g>
            <text
              x={0} y={labelFont / 3}
              textAnchor="middle"
              fontSize={labelFont}
              fontWeight="700"
              fill={PALETTE.chalk}
              pointerEvents="none"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Chain markers + arrows — one numbered chip per chain step at its
          drop spot. Drawn before the fielders so the floating name labels
          stay readable. Arrow segments connect consecutive drops so the
          coach sees the sequence at a glance. */}
      {chain && chain.length > 0 && markerCoords.length === chain.length && (
        <g pointerEvents="none">
          {/* Connecting segments between drop spots */}
          {markerCoords.map((c, i) => {
            if (i === 0) return null;
            const prev = markerCoords[i - 1];
            const isErr = errorStepIndex === i;
            return (
              <line
                key={`chain-link-${i}`}
                x1={prev.x}
                y1={prev.y}
                x2={c.x}
                y2={c.y}
                stroke={isErr ? "#ef4444" : "#1f3252"}
                strokeWidth={0.55}
                strokeDasharray={isErr ? "1.2 0.8" : undefined}
                opacity={0.85}
              />
            );
          })}
          {/* Numbered chips at each drop spot */}
          {markerCoords.map((c, i) => {
            const isErr = errorStepIndex === i;
            const fill = isErr ? "#ef4444" : PALETTE.teamBottom;
            return (
              <g key={`chain-marker-${i}`} filter="url(#dd-soft-shadow)">
                <circle cx={c.x} cy={c.y} r={2.4} fill={fill} stroke={PALETTE.chalk} strokeWidth={0.45} />
                <ellipse
                  cx={c.x} cy={c.y - 0.75} rx={1.3} ry={0.5}
                  fill={PALETTE.baseHighlight} opacity={0.35}
                />
                <text
                  x={c.x}
                  y={c.y + 0.9}
                  textAnchor="middle"
                  fontSize={2.4}
                  fontWeight={700}
                  fill={PALETTE.chalk}
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {dragMode && drag && FIELDER_POSITIONS.map((pos) => {
        const [px, py] = POSITION_XY[pos];
        if (pos === drag.position) {
          return (
            <g key={`ghost-${pos}`} pointerEvents="none" opacity="0.55">
              <circle
                cx={px} cy={py} r="3.4"
                fill="none" stroke={PALETTE.baseHighlight} strokeWidth="0.45"
                strokeDasharray="1 1"
              />
              <circle
                cx={px} cy={py} r="3.4"
                fill="none" stroke={PALETTE.teamBottom} strokeWidth="0.3"
                strokeDasharray="1 1"
              />
            </g>
          );
        }
        return null;
      })}

      {FIELDER_POSITIONS.map((pos) => {
        const [px, py] = POSITION_XY[pos];
        const isDragging = drag?.position === pos;
        const cx = isDragging ? drag!.x : px;
        const cy = isDragging ? drag!.y : py;
        const grabbable = dragMode;
        const slot = !weAreBatting
          ? state.our_lineup.find((s) => s.position === pos)
          : undefined;
        const playerName = slot?.player_id ? names.get(slot.player_id) : null;
        const label = playerName ? fielderNameLabel(playerName) : pos;
        const showsPositionOnly = label === pos;
        const fontSize = showsPositionOnly ? 2.4 : (label.length > 8 ? 2.4 : 2.7);
        return (
          <g
            key={pos}
            onPointerDown={grabbable ? (e) => beginDrag(e, pos) : undefined}
            onPointerMove={isDragging ? continueDrag : undefined}
            onPointerUp={isDragging ? endDrag : undefined}
            onPointerCancel={isDragging ? endDrag : undefined}
            style={grabbable ? { cursor: isDragging ? "grabbing" : "grab" } : undefined}
          >
            {isDragging ? (
              <g filter="url(#dd-soft-shadow)">
                <circle
                  cx={cx} cy={cy} r="3.4"
                  fill="url(#dd-runner-dot)"
                  stroke={PALETTE.chalk} strokeWidth="0.45"
                />
                <ellipse
                  cx={cx} cy={cy - 1.05} rx={1.9} ry={0.7}
                  fill={PALETTE.baseHighlight} opacity={0.45}
                />
              </g>
            ) : showsPositionOnly ? (
              <>
                <circle cx={cx} cy={cy} r="4" fill="transparent" />
                <g filter="url(#dd-soft-shadow)" pointerEvents="none">
                  <circle
                    cx={cx} cy={cy} r="2.9"
                    fill={PALETTE.baseHighlight} opacity={0.85}
                  />
                  <circle
                    cx={cx} cy={cy} r="2.4"
                    fill="url(#dd-position-dot)"
                    stroke={PALETTE.teamBottom} strokeWidth="0.3"
                  />
                  <ellipse
                    cx={cx} cy={cy - 0.75} rx={1.35} ry={0.55}
                    fill={PALETTE.baseHighlight} opacity={0.35}
                  />
                </g>
              </>
            ) : (
              <circle
                cx={cx} cy={cy} r="4"
                fill="transparent"
              />
            )}
            <text
              x={cx} y={cy + fontSize / 3}
              textAnchor="middle"
              fontSize={fontSize}
              fontWeight="700"
              fill={isDragging || showsPositionOnly ? PALETTE.chalk : PALETTE.fielderInk}
              stroke={isDragging || showsPositionOnly ? "none" : PALETTE.baseHighlight}
              strokeWidth={isDragging || showsPositionOnly ? 0 : 0.55}
              paintOrder="stroke fill"
              filter={isDragging || showsPositionOnly ? undefined : "url(#dd-text-shadow)"}
              pointerEvents="none"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
