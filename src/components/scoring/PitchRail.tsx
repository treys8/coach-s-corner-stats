"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { chainNotation, RESULT_DESC } from "@/lib/scoring/at-bat-helpers";
import type {
  AtBatResult,
  BattedBallType,
  FielderTouch,
  K3ReachSource,
  PitchType,
} from "@/lib/scoring/types";
import {
  ARMED_IN_PLAY_PENDING,
  type ArmedState,
  type AtBatExtras,
} from "@/hooks/scoring/useAtBatActions";
import { OutcomeGrid } from "./OutcomeGrid";
import { InPlayOutcomeSheet } from "./InPlayOutcomeSheet";

interface PitchRailProps {
  balls: number;
  strikes: number;
  outs: number;
  hasRunners: boolean;
  submitting: boolean;
  onPitch: (t: PitchType) => void;
  onOutcomePicked: (r: AtBatResult, extras?: AtBatExtras) => void;
  onK3Reach: (src: K3ReachSource) => void;
  onIntentionalWalk: () => void;
  onBalk: () => void;
  canRecord: (r: AtBatResult) => boolean;
  armedResult: ArmedState | null;
  setArmedResult: (v: ArmedState | null) => void;
  /** Commit the armed result with no spray. The hook reads internal
   *  armedExtras so this is intentionally no-arg — keeps the foul_out
   *  notation hint (and future Stage 3 extras) from being dropped. */
  onSkipLocation: () => void;
  /** Stage 3 chain — controlled by the hook; the rail reads it for the
   *  notation HUD and lets the coach select an error step. */
  chain: FielderTouch[];
  battedBallType: BattedBallType | null;
  errorStepIndex: number | null;
  setBattedBallType: (t: BattedBallType | null) => void;
  setErrorStepIndex: (idx: number | null) => void;
  undoChainStep: () => void;
  commitArmed: () => void;
}

/** Chip row options in the order they render. Pre-selecting the smart-
 *  default leaves a single visual tap to confirm; coach can override. */
const BBT_OPTIONS: { value: BattedBallType; label: string }[] = [
  { value: "ground", label: "Ground" },
  { value: "fly", label: "Fly" },
  { value: "line", label: "Line" },
  { value: "pop", label: "Pop" },
  { value: "bunt", label: "Bunt" },
];

const POSITION_DIGIT_DISPLAY: Record<string, string> = {
  P: "1", C: "2", "1B": "3", "2B": "4", "3B": "5", SS: "6",
  LF: "7", CF: "8", RF: "9",
};

type Mode = "pitchPad" | "armedDrag" | "pickContact";

const PRIMARY: { type: PitchType; label: string; cls: string }[] = [
  { type: "ball",            label: "Ball",     cls: "bg-sa-blue hover:bg-sa-blue/90 text-white" },
  { type: "called_strike",   label: "Called K", cls: "bg-sa-orange hover:bg-sa-orange/90 text-white" },
  { type: "swinging_strike", label: "Swing K",  cls: "bg-sa-orange hover:bg-sa-orange/90 text-white" },
  { type: "in_play",         label: "In play",  cls: "bg-sa-blue-deep/80 hover:bg-sa-blue-deep text-white" },
  { type: "foul",            label: "Foul",     cls: "bg-muted hover:bg-muted/80 text-foreground" },
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
  chain,
  battedBallType,
  errorStepIndex,
  setBattedBallType,
  setErrorStepIndex,
  undoChainStep,
  commitArmed,
}: PitchRailProps) {
  const [showOutcomesManually, setShowOutcomesManually] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // "Add error" mode highlights chain step buttons as targets; coach taps
  // one to mark it as the error step (then re-renders into normal mode).
  // Tap the existing error step again to clear it. Local state since it's
  // a pure UI affordance — no need to round-trip through the hook.
  const [pickingError, setPickingError] = useState(false);
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
                      onPitch("hbp");
                    }}
                    className="h-9 text-sm font-semibold text-foreground justify-start"
                  >
                    HBP
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      setMoreOpen(false);
                      onPitch("pitchout");
                    }}
                    className="h-9 text-sm font-semibold text-foreground justify-start"
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
                    className="h-9 text-sm font-semibold text-foreground justify-start"
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
                    className="h-9 text-sm font-semibold text-foreground justify-start"
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
            {armedResult === ARMED_IN_PLAY_PENDING ? (
              <InPlayOutcomeSheet
                disabled={disabled}
                onPick={onOutcomePicked}
                canRecord={canRecord}
              />
            ) : (
              <OutcomeGrid
                disabled={disabled}
                onPick={onOutcomePicked}
                onK3Reach={onK3Reach}
                armedResult={armedResult}
                currentStrikes={strikes}
                canRecord={canRecord}
              />
            )}
          </div>
        )}

        {mode === "armedDrag" && armedResult && armedResult !== ARMED_IN_PLAY_PENDING && (
          <ArmedDragBody
            armedResult={armedResult}
            chain={chain}
            battedBallType={battedBallType}
            errorStepIndex={errorStepIndex}
            setBattedBallType={setBattedBallType}
            setErrorStepIndex={(idx) => {
              setErrorStepIndex(idx);
              setPickingError(false);
            }}
            pickingError={pickingError}
            setPickingError={setPickingError}
            undoChainStep={undoChainStep}
            commitArmed={() => {
              commitArmed();
              setPickingError(false);
            }}
            onSkipLocation={() => {
              onSkipLocation();
              setPickingError(false);
            }}
            onCancel={() => {
              setArmedResult(null);
              setPickingError(false);
            }}
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}

interface ArmedDragBodyProps {
  armedResult: AtBatResult;
  chain: FielderTouch[];
  battedBallType: BattedBallType | null;
  errorStepIndex: number | null;
  setBattedBallType: (t: BattedBallType | null) => void;
  setErrorStepIndex: (idx: number | null) => void;
  pickingError: boolean;
  setPickingError: (v: boolean) => void;
  undoChainStep: () => void;
  commitArmed: () => void;
  onSkipLocation: () => void;
  onCancel: () => void;
  submitting: boolean;
}

/** Body shown during the post-outcome "drag the chain" phase. Combines:
 *  - notation preview HUD ("6-3" / "F8" / "6 E4")
 *  - chip-tap batted-ball-type row (smart-pre-selected from result)
 *  - "Add error" affordance: tap → step buttons highlight; tap a step to flag it
 *  - Commit / Skip location / Cancel actions
 *  - Undo last step when the chain isn't empty
 */
function ArmedDragBody({
  armedResult,
  chain,
  battedBallType,
  errorStepIndex,
  setBattedBallType,
  setErrorStepIndex,
  pickingError,
  setPickingError,
  undoChainStep,
  commitArmed,
  onSkipLocation,
  onCancel,
  submitting,
}: ArmedDragBodyProps) {
  const notation = chainNotation(chain, armedResult, errorStepIndex, undefined);
  const hasChain = chain.length > 0;

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border bg-muted/40 px-3 py-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Recording</div>
        <div className="mt-1 font-semibold text-sa-blue-deep">
          {RESULT_DESC[armedResult] ?? armedResult}
        </div>
        {notation ? (
          <div className="mt-1 font-mono-stat text-lg text-foreground tabular-nums">{notation}</div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Drag the fielder who made the play. Drag others to add throws.
          </p>
        )}
      </div>

      {/* Chain step list — visible once the coach has dropped at least one
          fielder. Doubles as the "Add error" picker: in pickingError mode
          tapping a step flips errorStepIndex; otherwise it's read-only. */}
      {hasChain && (
        <div className="rounded-md border px-2 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {pickingError ? "Pick error step" : "Chain"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={undoChainStep}
              disabled={submitting}
              title="Remove the most recent step"
            >
              Undo step
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chain.map((t, i) => {
              const digit = POSITION_DIGIT_DISPLAY[t.position] ?? t.position;
              const isErr = errorStepIndex === i;
              const clickable = pickingError;
              return (
                <button
                  key={`step-${i}`}
                  type="button"
                  disabled={submitting || !clickable}
                  onClick={() => {
                    if (!clickable) return;
                    setErrorStepIndex(isErr ? null : i);
                  }}
                  className={`h-7 min-w-[2.25rem] rounded border px-2 text-xs font-bold tabular-nums ${
                    isErr
                      ? "bg-red-600 text-white border-red-700"
                      : clickable
                        ? "bg-background hover:bg-muted"
                        : "bg-muted/50"
                  }`}
                  title={t.target ? `${t.position} → ${t.target}` : t.position}
                >
                  {digit}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Batted-ball-type chip row — smart-pre-selected from result. Coach
          taps to confirm or pick a different type. */}
      <div className="rounded-md border px-2 py-2 space-y-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Batted ball
        </span>
        <div className="flex flex-wrap gap-1.5">
          {BBT_OPTIONS.map((opt) => {
            const active = battedBallType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={submitting}
                onClick={() => setBattedBallType(active ? null : opt.value)}
                className={`h-7 rounded border px-2 text-xs font-semibold ${
                  active
                    ? "bg-sa-blue text-white border-sa-blue"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          className="bg-sa-orange hover:bg-sa-orange/90 text-white"
          onClick={commitArmed}
          disabled={submitting}
        >
          Commit
        </Button>
        <Button
          variant="outline"
          onClick={() => setPickingError(!pickingError)}
          disabled={submitting || !hasChain}
        >
          {pickingError ? "Cancel error pick" : "Add error"}
        </Button>
        <Button
          variant="outline"
          onClick={onSkipLocation}
          disabled={submitting}
          title="Skip the drag chain — commit with no fielder info."
        >
          Skip location
        </Button>
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
