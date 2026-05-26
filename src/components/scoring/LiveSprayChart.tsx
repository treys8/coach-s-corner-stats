"use client";

import { useMemo } from "react";
import { SprayField, type SprayMarker } from "@/components/spray/SprayField";
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

export function LiveSprayChart({
  state,
  currentBatterId,
  currentBatterIsOurs,
}: LiveSprayChartProps) {
  // Filter + project on every change to at_bats or the at-plate batter.
  // Memoized so taps that don't change either (modal opens, count flips,
  // base toggles) don't reallocate the markers array — useful on the tablet
  // hot path where state mutates frequently.
  const markers = useMemo<SprayMarker[]>(() => {
    if (!currentBatterId) return [];
    return state.at_bats
      .filter((ab) =>
        currentBatterIsOurs
          ? ab.batter_id === currentBatterId
          : ab.opponent_batter_id === currentBatterId,
      )
      .map((ab) => ({
        id: ab.event_id,
        result: ab.result,
        spray_x: ab.spray_x,
        spray_y: ab.spray_y,
        description: ab.description,
      }));
  }, [state.at_bats, currentBatterId, currentBatterIsOurs]);

  const emptyMessage = currentBatterId
    ? "No batted balls yet for this hitter."
    : "Waiting for a batter at the plate.";

  return <SprayField markers={markers} emptyMessage={emptyMessage} />;
}
