"use client";

import { SprayField, type SprayMarker } from "@/components/spray/SprayField";
import type { ReplayState } from "@/lib/scoring/types";

interface LiveSprayChartProps {
  state: ReplayState;
}

export function LiveSprayChart({ state }: LiveSprayChartProps) {
  const markers: SprayMarker[] = state.at_bats.map((ab) => ({
    id: ab.event_id,
    result: ab.result,
    spray_x: ab.spray_x,
    spray_y: ab.spray_y,
    description: ab.description,
  }));

  return (
    <SprayField
      markers={markers}
      emptyMessage="Field-tap data appears here as balls are put in play."
    />
  );
}
