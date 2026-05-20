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
  /** Multi-step chain (DP/TP) — present once the coach has dropped at
   *  least one fielder for a DP/TP arm. Drives the Commit / Undo / Cancel
   *  controls inside the drag prompt. */
  pendingChain: FielderTouch[];
  commitChain: () => void;
  popChainStep: () => void;
  cancelChain: () => void;
  /** True when the pending chain enumerates enough outs (2 for DP, 3 for
   *  TP). Used to enable/disable the Commit button. */
  canCommitChain: boolean;
  /** Force-outs the chain currently attributes (for "X of Y" copy). */
  chainOuts: number;
  /** Required force-outs for the armed result (2 for DP, 3 for TP). */
  chainOutsRequired: number;
}

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
 *  - `armedDrag`    — drag-prompt + Cancel after an in-play outcome is
 *                      picked. Dropping a fielder on the diamond auto-
 *                      commits the at-bat (no Commit button).
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
  pendingChain,
  commitChain,
  popChainStep,
  cancelChain,
  canCommitChain,
  chainOuts,
  chainOutsRequired,
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
            onCancel={() => setArmedResult(null)}
            submitting={submitting}
            pendingChain={pendingChain}
            commitChain={commitChain}
            popChainStep={popChainStep}
            cancelChain={cancelChain}
            canCommitChain={canCommitChain}
            chainOuts={chainOuts}
            chainOutsRequired={chainOutsRequired}
          />
        )}
      </div>
    </div>
  );
}

interface ArmedDragBodyProps {
  armedResult: AtBatResult;
  onCancel: () => void;
  submitting: boolean;
  pendingChain: FielderTouch[];
  commitChain: () => void;
  popChainStep: () => void;
  cancelChain: () => void;
  canCommitChain: boolean;
  chainOuts: number;
  chainOutsRequired: number;
}

/** Body shown after the coach picks an in-play outcome. Auto-commit flow:
 *  dragging a fielder on the diamond submits the play immediately with the
 *  drop coords as the spray location. Coach has Cancel to re-arm; mistakes
 *  after commit go through the top-bar Undo or Edit last play.
 *
 *  Multi-step flow (DP/TP): each drop appends to `pendingChain` instead
 *  of committing. The body shows the in-progress chain notation plus
 *  Commit / Undo last drop controls so the coach can capture the full
 *  6-4-3 / 4-6-3 / 1-2-3 path before submitting. */
function ArmedDragBody({
  armedResult,
  onCancel,
  submitting,
  pendingChain,
  commitChain,
  popChainStep,
  cancelChain,
  canCommitChain,
  chainOuts,
  chainOutsRequired,
}: ArmedDragBodyProps) {
  const isMultiStep = armedResult === "DP" || armedResult === "TP";
  const chainLen = pendingChain.length;

  if (isMultiStep && chainLen > 0) {
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Recording</div>
          <div className="mt-1 font-semibold text-sa-blue-deep">
            {RESULT_DESC[armedResult] ?? armedResult}
          </div>
          <div className="mt-2 flex items-center gap-1 flex-wrap">
            {pendingChain.map((step, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">→</span>}
                <span className="rounded bg-sa-blue-deep/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-sa-blue-deep">
                  {step.position}
                </span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {canCommitChain
              ? "Chain captured. Tap Commit, or drop more fielders to refine."
              : `${chainOuts} of ${chainOutsRequired} outs captured — drop the next fielder on a base.`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            className="w-full"
            onClick={popChainStep}
            disabled={submitting}
          >
            Undo drop
          </Button>
          <Button
            className="w-full bg-sa-orange hover:bg-sa-orange/90 text-white"
            onClick={commitChain}
            disabled={submitting || !canCommitChain}
          >
            Commit
          </Button>
        </div>
        <Button
          variant="ghost"
          className="w-full"
          onClick={cancelChain}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border bg-muted/40 px-3 py-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Recording</div>
        <div className="mt-1 font-semibold text-sa-blue-deep">
          {RESULT_DESC[armedResult] ?? armedResult}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {isMultiStep
            ? "Drag the fielder who first touched the ball. Then drag each receiving fielder onto the bag covered."
            : `Drag the fielder to where the ball was ${isCaughtOutcome(armedResult) ? "caught" : "hit"}.`}
        </p>
      </div>

      <Button
        variant="ghost"
        className="w-full"
        onClick={onCancel}
        disabled={submitting}
      >
        Cancel
      </Button>
    </div>
  );
}

// Caught-in-the-air outcomes — used to swap "hit" for "caught" in the
// drag-prompt copy so the coach gets the right mental model.
function isCaughtOutcome(r: AtBatResult): boolean {
  return r === "FO" || r === "LO" || r === "PO" || r === "SF" || r === "IF";
}
