import type { Bases } from "@/lib/scoring/types";
import { BASE_XY } from "./diamond-geometry";

interface MiniBasesProps {
  bases: Bases;
  /** Edge length in pixels. Defaults to 28. */
  size?: number;
  className?: string;
}

// Tiny base diamond used in the sticky game-status strip. Mirrors the
// orange-when-occupied scheme of the full DefensiveDiamond so the two
// visualizations stay legible side by side.
export function MiniBases({ bases, size = 28, className }: MiniBasesProps) {
  return (
    <svg
      viewBox="20 40 60 40"
      width={size}
      height={(size * 40) / 60}
      role="img"
      aria-label="Bases"
      className={className}
    >
      {(["first", "second", "third"] as const).map((b) => {
        const [bx, by] = BASE_XY[b];
        const occupied = bases[b] !== null;
        return (
          <g key={b} transform={`translate(${bx} ${by}) rotate(45)`}>
            <rect
              x={-3.4} y={-3.4} width={6.8} height={6.8}
              fill={occupied ? "#ee8233" : "#fff"}
              stroke="#1f3252" strokeWidth="0.6"
            />
          </g>
        );
      })}
    </svg>
  );
}
