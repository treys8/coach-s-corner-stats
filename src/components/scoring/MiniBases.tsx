import { useId } from "react";
import type { Bases } from "@/lib/scoring/types";
import { BASE_XY, HOME_XY } from "./diamond-geometry";

interface MiniBasesProps {
  bases: Bases;
  /** Edge length in pixels. Defaults to 28. */
  size?: number;
  className?: string;
}

const VB_X = 20;
const VB_Y = 40;
const VB_W = 60;
const VB_H = 40;

const BASE_HALF = 3.2;
const OCCUPIED_COLOR = "hsl(16 100% 50%)";
const OCCUPIED_GLOW = "hsl(18 100% 62%)";

export function MiniBases({ bases, size = 28, className }: MiniBasesProps) {
  const uid = useId().replace(/:/g, "");
  const grassId = `mb-grass-${uid}`;
  const dirtId = `mb-dirt-${uid}`;
  const shadowId = `mb-shadow-${uid}`;
  const glowId = `mb-glow-${uid}`;
  const baseSheenId = `mb-sheen-${uid}`;

  const [s1x, s1y] = BASE_XY.first;
  const [s2x, s2y] = BASE_XY.second;
  const [s3x, s3y] = BASE_XY.third;
  const [hx, hy] = HOME_XY;

  const infieldPath = `M ${hx} ${hy} L ${s1x} ${s1y} L ${s2x} ${s2y} L ${s3x} ${s3y} Z`;
  const chalkExtend = 18;
  const dx1 = s1x - hx;
  const dy1 = s1y - hy;
  const dx3 = s3x - hx;
  const dy3 = s3y - hy;
  const len1 = Math.hypot(dx1, dy1);
  const len3 = Math.hypot(dx3, dy3);
  const foul1x = s1x + (dx1 / len1) * chalkExtend;
  const foul1y = s1y + (dy1 / len1) * chalkExtend;
  const foul3x = s3x + (dx3 / len3) * chalkExtend;
  const foul3y = s3y + (dy3 / len3) * chalkExtend;

  return (
    <svg
      viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
      width={size}
      height={(size * VB_H) / VB_W}
      role="img"
      aria-label="Bases"
      className={className}
    >
      <defs>
        <linearGradient id={grassId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a8b3f" />
          <stop offset="100%" stopColor="#6e9d51" />
        </linearGradient>
        <radialGradient id={dirtId} cx="50%" cy="55%" r="65%">
          <stop offset="0%" stopColor="#b07a52" />
          <stop offset="100%" stopColor="#8e5a3a" />
        </radialGradient>
        <linearGradient id={baseSheenId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="55%" stopColor="#f8f8f4" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#dcd6c4" stopOpacity="0.7" />
        </linearGradient>
        <filter id={shadowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.45" />
          <feOffset dx="0" dy="0.4" result="off" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.55" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.9" />
        </filter>
      </defs>

      <rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill={`url(#${grassId})`} />

      <line
        x1={hx}
        y1={hy}
        x2={foul1x}
        y2={foul1y}
        stroke="#f5f5f0"
        strokeWidth="0.6"
        strokeOpacity="0.9"
        strokeLinecap="round"
      />
      <line
        x1={hx}
        y1={hy}
        x2={foul3x}
        y2={foul3y}
        stroke="#f5f5f0"
        strokeWidth="0.6"
        strokeOpacity="0.9"
        strokeLinecap="round"
      />

      <path d={infieldPath} fill={`url(#${dirtId})`} />

      <path
        d={infieldPath}
        fill="none"
        stroke="#f5f5f0"
        strokeWidth="0.55"
        strokeOpacity="0.85"
        strokeLinejoin="round"
      />

      <polygon
        points={`${hx - 1.6},${hy - 1.2} ${hx + 1.6},${hy - 1.2} ${hx + 1.6},${hy} ${hx},${hy + 1.6} ${hx - 1.6},${hy}`}
        fill="#f8f8f4"
        stroke="#b8b09e"
        strokeWidth="0.35"
        strokeLinejoin="round"
      />

      {(["first", "second", "third"] as const).map((b) => {
        const [bx, by] = BASE_XY[b];
        const occupied = bases[b] !== null;
        const half = occupied ? BASE_HALF + 0.25 : BASE_HALF;
        return (
          <g key={b} transform={`translate(${bx} ${by}) rotate(45)`}>
            {occupied && (
              <rect
                x={-half - 0.6}
                y={-half - 0.6}
                width={(half + 0.6) * 2}
                height={(half + 0.6) * 2}
                fill={OCCUPIED_GLOW}
                opacity="0.55"
                filter={`url(#${glowId})`}
              />
            )}
            <g filter={`url(#${shadowId})`}>
              <rect
                x={-half}
                y={-half}
                width={half * 2}
                height={half * 2}
                fill={occupied ? OCCUPIED_COLOR : "#f8f8f4"}
                fillOpacity={occupied ? 1 : 0.92}
                stroke={occupied ? "#7a2e08" : "#b8b09e"}
                strokeWidth={occupied ? 0.55 : 0.4}
                strokeLinejoin="round"
              />
              <rect
                x={-half}
                y={-half}
                width={half * 2}
                height={half * 2}
                fill={`url(#${baseSheenId})`}
                opacity={occupied ? 0.22 : 0.5}
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
