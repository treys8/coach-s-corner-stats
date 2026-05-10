"use client";

import { SprayField, type SprayMarker } from "@/components/spray/SprayField";

export type { SprayMarker };

interface PlayerSprayChartProps {
  markers: SprayMarker[];
}

export function PlayerSprayChart({ markers }: PlayerSprayChartProps) {
  return (
    <SprayField
      markers={markers}
      countsInLegend
      className="max-w-xl mx-auto"
      emptyMessage="No batted-ball data yet. Spray data is captured during tablet scoring when a fielder is dragged to the ball location."
    />
  );
}
