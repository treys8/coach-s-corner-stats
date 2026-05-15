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
  // state.at_bats is the only field this chart reads, but the parent passes
  // the full ReplayState — so we depend on the array identity, not the
  // whole state, to skip the filter+map on irrelevant re-renders (pitch
  // counts, runner moves between PAs, etc., that don't change at_bats).
  const markers: SprayMarker[] = useMemo(() => {
    if (!currentBatterId) return [];
    const out: SprayMarker[] = [];
    for (const ab of state.at_bats) {
      const match = currentBatterIsOurs
        ? ab.batter_id === currentBatterId
        : ab.opponent_batter_id === currentBatterId;
      if (!match) continue;
      out.push({
        id: ab.event_id,
        result: ab.result,
        spray_x: ab.spray_x,
        spray_y: ab.spray_y,
        description: ab.description,
      });
    }
    return out;
  }, [state.at_bats, currentBatterId, currentBatterIsOurs]);

  const emptyMessage = currentBatterId
    ? "No batted balls yet for this hitter."
    : "Waiting for a batter at the plate.";

  return <SprayField markers={markers} emptyMessage={emptyMessage} />;
}
