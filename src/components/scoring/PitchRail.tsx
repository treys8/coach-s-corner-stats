"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RESULT_DESC } from "@/lib/scoring/at-bat-helpers";
import type {
  AtBatResult,
  K3ReachSource,
  PitchType,
} from "@/lib/scoring/types";
import {
  ARMED_IN_PLAY_PENDING,
  type ArmedState,
} from "@/hooks/scoring/useAtBatActions";
import { OutcomeGrid } from "./OutcomeGrid";

interface PitchRailProps {
  balls: number;
  strikes: number;
  outs: number;
  hasRunners: boolean;
  submitting: boolean;
  onPitch: (t: PitchType) => void;
  onOutcomePicked: (r: AtBatResult) => void;
  onK3Reach: (src: K3ReachSource) => void;
  onIntentionalWalk: () => void;
  onBalk: () => void;
  canRecord: (r: AtBatResult) => boolean;
  armedResult: ArmedState | null;
  setArmedResult: (v: ArmedState | null) => void;
  onSkipLocation: (result: AtBatResult) => void;
}

type Mode = "pitchPad" | "armedDrag" | "pickContact";

const PRIMARY: { type: PitchType; label: string; cls: string }[] = [
  { type: "ball",            label: "Ball",     cls: "bg-sa-blue hover:bg-sa-blue/90 text-white" },
  { type: "called_strike",   label: "Called K", cls: "bg-sa-orange hover:bg-sa-orange/90 text-white" },
  { type: "swinging_strike", label: "Swing K",  cls: "bg-sa-orange hover:bg-sa-orange/90 text-white" },
  { type: "foul",            label: "Foul",     cls: "bg-muted hover:bg-muted/80 text-foreground" },
  { type: "in_play",         label: "In play",  cls: "bg-sa-blue-deep/80 hover:bg-sa-blue-deep text-white" },
  { type: "hbp",             label: "HBP",      cls: "bg-muted hover:bg-muted/80 text-foreground" },
];

/**
 * Vertical pitch rail for the v2 three-column tablet shell. Replaces the
 * v1 bottom-bar PaActionFooter — the rail is the left column and swaps
 * between three modes the same way the footer did, keeping the diamond
 * fully visible in the center column at all times:
 *  - `pitchPad`     — count badge + primary pitch buttons + More ▾ +
 *                      Direct outcome → toggle.
 *  - `pickContact`  — OutcomeGrid takes the rail (entered after In play
 *                      or via the Direct outcome toggle).
 *  - `armedDrag`    — drag-prompt + Skip / Cancel after an in-play
 *                      outcome is picked.
 */
export function PitchRail({
  balls,
  strikes,
  outs,
  hasRunners,
  submitting,
  onPitch,
  onOutcomePicked,
  onK3Reach,
  onIntentionalWalk,
  onBalk,
  canRecord,
  armedResult,
  setArmedResult,
  onSkipLocation,
}: PitchRailProps) {
  const [showOutcomesManually, setShowOutcomesManually] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const disabled = submitting || outs >= 3;

  const mode: Mode =
    armedResult === ARMED_IN_PLAY_PENDING
      ? "pickContact"
      : armedResult
        ? "armedDrag"
        : showOutcomesManually
          ? "pickContact"
          : "pitchPad";

  const exitDirectOutcome = () => {
    setShowOutcomesManually(false);
    if (armedResult === ARMED_IN_PLAY_PENDING) setArmedResult(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0 border-r bg-background">
      {/* Count badge — always visible across all rail modes */}
      <div className="px-3 pt-3 pb-2 border-b">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Count
          </span>
          <span className="font-mono-stat text-[64px] leading-none text-sa-blue-deep tabular-nums">
            {balls}-{strikes}
          </span>
        </div>
      </div>

      {/* Mode-specific body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {mode === "pitchPad" && (
          <div className="flex flex-col gap-2">
            {PRIMARY.map((p) => (
              <Button
                key={p.type}
                disabled={disabled}
                onClick={() => onPitch(p.type)}
                className={`h-14 text-base font-bold ${p.cls}`}
              >
                {p.label}
              </Button>
            ))}

            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  disabled={disabled}
                  className="h-10 text-sm"
                >
                  More ▾
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start" side="right">
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      setMoreOpen(false);
                      onPitch("pitchout");
                    }}
                    className="h-9 text-sm justify-start"
                  >
                    Pitchout
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      setMoreOpen(false);
                      onIntentionalWalk();
                    }}
                    className="h-9 text-sm justify-start"
                  >
                    Intentional walk
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled || !hasRunners}
                    onClick={() => {
                      setMoreOpen(false);
                      onBalk();
                    }}
                    className="h-9 text-sm justify-start"
                    title={hasRunners ? "All runners advance one base" : "No runners on — balk has no effect"}
                  >
                    Balk
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground"
              onClick={() => setShowOutcomesManually(true)}
              disabled={disabled}
            >
              Direct outcome →
            </Button>
          </div>
        )}

        {mode === "pickContact" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs rounded-md border bg-muted/40 px-2 py-1.5">
              <span>
                {armedResult === ARMED_IN_PLAY_PENDING ? (
                  <>
                    <span className="font-semibold text-sa-blue-deep">In play</span>
                    <span className="text-muted-foreground"> · pick outcome</span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-sa-blue-deep">Direct outcome</span>
                  </>
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={exitDirectOutcome}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
            <OutcomeGrid
              disabled={disabled}
              onPick={onOutcomePicked}
              onK3Reach={onK3Reach}
              armedResult={armedResult}
              currentStrikes={strikes}
              canRecord={canRecord}
            />
          </div>
        )}

        {mode === "armedDrag" && armedResult && armedResult !== ARMED_IN_PLAY_PENDING && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Recording</div>
              <div className="mt-1 font-semibold text-sa-blue-deep">
                {RESULT_DESC[armedResult] ?? armedResult}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Drag the fielder who made the play on the diamond.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => onSkipLocation(armedResult)}
                disabled={submitting}
              >
                Skip location
              </Button>
              <Button
                variant="ghost"
                onClick={() => setArmedResult(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
