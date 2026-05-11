"use client";

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
  const filtered = currentBatterId
    ? state.at_bats.filter((ab) =>
        currentBatterIsOurs
          ? ab.batter_id === currentBatterId
          : ab.opponent_batter_id === currentBatterId,
      )
    : [];

  const markers: SprayMarker[] = filtered.map((ab) => ({
    id: ab.event_id,
    result: ab.result,
    spray_x: ab.spray_x,
    spray_y: ab.spray_y,
    description: ab.description,
  }));

  const emptyMessage = currentBatterId
    ? "No batted balls yet for this hitter."
    : "Waiting for a batter at the plate.";

  return <SprayField markers={markers} emptyMessage={emptyMessage} />;
}
