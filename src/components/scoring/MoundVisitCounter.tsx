"use client";

import type { ReplayState } from "@/lib/scoring/types";

interface Props {
  state: ReplayState;
  /** Hidden when we are batting — the counter only matters defensively. */
  weAreBatting: boolean;
}

/** Charged-conference counter (NFHS 3-4-1, play-catalog §8.7). Renders
 *  per-inning + per-game tallies for the current pitcher. Thresholds:
 *  - 3rd visit this inning → mandatory pitcher removal
 *  - 4th visit this game   → mandatory pitcher removal
 *  Engine enforcement lives in useFlowActions.submitMoundVisit; this
 *  component is the always-visible passive surface. */
export function MoundVisitCounter({ state, weAreBatting }: Props) {
  if (weAreBatting) return null;
  if (!state.current_pitcher_id) return null;

  const pitcherId = state.current_pitcher_id;
  const inningCount = state.defensive_conferences.filter(
    (c) => c.pitcher_id === pitcherId && c.inning === state.inning,
  ).length;
  const gameCount = state.defensive_conferences.filter(
    (c) => c.pitcher_id === pitcherId,
  ).length;

  const inningWarn = inningCount >= 2;
  const gameWarn = gameCount >= 3;

  return (
    <div
      className="rounded border border-border bg-card px-3 py-2 text-xs"
      title="NFHS 3-4-1: 3 visits/inning or 4/game forces pitcher removal"
    >
      <div className="font-semibold uppercase tracking-wider text-muted-foreground text-[10px]">
        Mound visits
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3 font-mono-stat">
        <span>
          <span className={inningWarn ? "text-sa-orange font-bold" : "text-foreground"}>
            {inningCount}/3
          </span>
          <span className="ml-1 text-[10px] uppercase text-muted-foreground">inning</span>
        </span>
        <span>
          <span className={gameWarn ? "text-sa-orange font-bold" : "text-foreground"}>
            {gameCount}/4
          </span>
          <span className="ml-1 text-[10px] uppercase text-muted-foreground">game</span>
        </span>
      </div>
    </div>
  );
}
