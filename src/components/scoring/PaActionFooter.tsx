"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RESULT_DESC } from "@/lib/scoring/at-bat-helpers";
import type { AtBatResult, K3ReachSource, PitchType } from "@/lib/scoring/types";
import { ARMED_IN_PLAY_PENDING, type ArmedState } from "@/hooks/scoring/useAtBatActions";
import { PitchPad } from "./PitchPad";
import { OutcomeGrid } from "./OutcomeGrid";

interface PaActionFooterProps {
  balls: number;
  strikes: number;
  outs: number;
  submitting: boolean;
  onPitch: (t: PitchType) => void;
  onOutcomePicked: (r: AtBatResult) => void;
  onK3Reach: (src: K3ReachSource) => void;
  canRecord: (r: AtBatResult) => boolean;
  armedResult: ArmedState | null;
  setArmedResult: (v: ArmedState | null) => void;
  /** Called when the coach taps "Skip location" on an armed in-play result.
   *  Submits the AB without spray coordinates. */
  onSkipLocation: (result: AtBatResult) => void;
}

type Mode = "pitchPad" | "armedDrag" | "pickContact";

/**
 * Footer for the in-progress scoring shell. Swaps between three modes so the
 * tablet doesn't have to scroll between PitchPad and OutcomeGrid:
 *  - `pitchPad`     — pitch buttons + a "Direct outcome" toggle for K/BB/HBP
 *                      without going through a pitch. Default mode.
 *  - `pickContact`  — OutcomeGrid revealed. Entered automatically after an
 *                      "In play" tap (armedResult === IN_PLAY_PENDING) or
 *                      manually via the "Direct outcome" toggle.
 *  - `armedDrag`    — coach picked an in-play outcome; waiting on a fielder
 *                      drop on the diamond. Footer shows skip / cancel.
 */
export function PaActionFooter({
  balls,
  strikes,
  outs,
  submitting,
  onPitch,
  onOutcomePicked,
  onK3Reach,
  canRecord,
  armedResult,
  setArmedResult,
  onSkipLocation,
}: PaActionFooterProps) {
  const [showOutcomesManually, setShowOutcomesManually] = useState(false);
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
    <div className="border-t bg-background px-3 sm:px-4 pt-2 pb-3 space-y-2 min-h-[260px]">
      {mode === "armedDrag" && armedResult && armedResult !== ARMED_IN_PLAY_PENDING && (
        <div className="flex items-center justify-between flex-wrap gap-2 text-sm rounded-md border bg-muted/40 px-3 py-2">
          <span>
            <span className="text-muted-foreground">Recording </span>
            <span className="font-semibold text-sa-blue-deep">
              {RESULT_DESC[armedResult] ?? armedResult}
            </span>
            <span className="text-muted-foreground"> · drag the fielder who made the play to where the ball was.</span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSkipLocation(armedResult)}
              disabled={submitting}
            >
              Skip location
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setArmedResult(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "pickContact" && (
        <div className="flex items-center justify-between flex-wrap gap-2 text-sm rounded-md border bg-muted/40 px-3 py-2">
          <span>
            {armedResult === ARMED_IN_PLAY_PENDING ? (
              <>
                <span className="font-semibold text-sa-blue-deep">Pitch in play</span>
                <span className="text-muted-foreground"> · pick the outcome below.</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-sa-blue-deep">Direct outcome</span>
                <span className="text-muted-foreground"> · record a result without tracking the pitch.</span>
              </>
            )}
          </span>
          <Button size="sm" variant="outline" onClick={exitDirectOutcome} disabled={submitting}>
            Cancel
          </Button>
        </div>
      )}

      {mode === "pitchPad" && (
        <>
          <PitchPad
            balls={balls}
            strikes={strikes}
            disabled={disabled}
            onPitch={onPitch}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setShowOutcomesManually(true)}
              disabled={disabled}
            >
              Direct outcome →
            </Button>
          </div>
        </>
      )}

      {mode === "pickContact" && (
        <OutcomeGrid
          disabled={disabled}
          onPick={onOutcomePicked}
          onK3Reach={(src) => onK3Reach(src)}
          armedResult={armedResult}
          currentStrikes={strikes}
          canRecord={canRecord}
        />
      )}

      {mode === "armedDrag" && (
        <div className="text-xs text-muted-foreground italic px-2">
          Drop the fielder on the diamond above. Skip if you want to record without a location.
        </div>
      )}
    </div>
  );
}
