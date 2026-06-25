"use client";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PitchType } from "@/lib/scoring/types";

interface Props {
  balls: number;
  strikes: number;
  disabled: boolean;
  onPitch: (t: PitchType) => void;
}

export function PitchPad({ balls, strikes, disabled, onPitch }: Props) {
  const pitches: { type: PitchType; label: string; variant: ButtonProps["variant"] }[] = [
    { type: "ball", label: "Ball", variant: "pitchBall" },
    { type: "called_strike", label: "Called K", variant: "pitchStrike" },
    { type: "swinging_strike", label: "Swing K", variant: "pitchStrike" },
    { type: "foul", label: "Foul", variant: "pitchNeutral" },
    { type: "in_play", label: "In play", variant: "pitchInPlay" },
    { type: "hbp", label: "HBP", variant: "pitchNeutral" },
  ];
  // Less-common pitch types tucked into a secondary row to keep the primary pad uncluttered.
  // Foul-tip-caught is a strike (and records K at 2 strikes); pitchout and intentional_ball
  // both add a ball.
  const auxPitches: { type: PitchType; label: string }[] = [
    { type: "foul_tip_caught", label: "Foul tip" },
    { type: "pitchout", label: "Pitchout" },
    { type: "intentional_ball", label: "Int. ball" },
  ];
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Count</span>
        <span className="font-mono-stat text-3xl text-sa-blue-deep">{balls}-{strikes}</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {pitches.map((p) => (
          <Button
            key={p.type}
            variant={p.variant}
            size="pitchSm"
            disabled={disabled}
            onClick={() => onPitch(p.type)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {auxPitches.map((p) => (
          <Button
            key={p.type}
            variant="outline"
            disabled={disabled}
            onClick={() => onPitch(p.type)}
            className="h-8 text-xs"
          >
            {p.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Tap pitches as they happen — counter resets at the at-bat outcome.</p>
    </Card>
  );
}
