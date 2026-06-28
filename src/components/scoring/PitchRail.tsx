"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
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
  /** Layout variant. `rail` (default) is the tablet-landscape left column —
   *  vertical buttons, big count badge. `dock` is the phone/portrait footer
   *  — horizontal pitch row, count folds into the status bar. Mode bodies
   *  (pickContact / armedDrag) render the same shared internals either way. */
  layout?: "rail" | "dock";
}

type Mode = "pitchPad" | "armedDrag" | "pickContact";

const PRIMARY: { type: PitchType; label: string; variant: ButtonProps["variant"] }[] = [
  { type: "ball",            label: "Ball",     variant: "pitchBall" },
  { type: "called_strike",   label: "Called K", variant: "pitchStrike" },
  { type: "swinging_strike", label: "Swing K",  variant: "pitchStrike" },
  { type: "in_play",         label: "In play",  variant: "pitchInPlay" },
  { type: "foul",            label: "Foul",     variant: "pitchNeutral" },
];

/**
 * Pitch UI for the scoring shell, with two layouts that share the same
 * three internal modes:
 *  - `pitchPad`     — count badge (rail only) + primary pitch buttons +
 *                      More ▾ + Direct outcome → toggle.
 *  - `pickContact`  — OutcomeGrid replaces the pitch buttons (entered
 *                      after "In play" or via the Direct outcome toggle).
 *  - `armedDrag`    — drag-prompt + Cancel after an in-play outcome is
 *                      picked. Dropping a fielder on the diamond auto-
 *                      commits the at-bat (no Commit button).
 *
 * `layout="rail"` is the lg+ tablet-landscape left column (vertical buttons,
 * big count badge). `layout="dock"` is the <lg phone/portrait footer
 * (horizontal pitch grid, no count badge — the status bar carries it).
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
  layout = "rail",
}: PitchRailProps) {
  const [showOutcomesManually, setShowOutcomesManually] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const disabled = submitting || outs >= 3;
  const isDock = layout === "dock";

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

  // Container chrome differs between layouts: rail = full-height left column
  // with a right border; dock = bottom-pinned footer with a top border and a
  // height cap so it doesn't eat the diamond.
  const containerCls = isDock
    ? "relative z-10 flex flex-col border-t bg-background max-h-[55dvh] pb-safe rounded-t-2xl shadow-[0_-10px_28px_-14px_hsl(224_40%_20%/0.22)]"
    : "relative z-10 flex flex-col h-full min-h-0 border-r bg-background shadow-[8px_0_24px_-14px_hsl(224_40%_20%/0.22)]";

  return (
    <div className={containerCls}>
      {/* Count badge — only the rail layout owns the big standalone badge.
          In dock mode the GameStatusBar carries the count instead. */}
      {!isDock && (
        <div className="px-3 pt-3 pb-2 border-b">
          <div
            className={`rounded-2xl border border-sa-blue/15 bg-gradient-count px-4 py-3 shadow-e2${
              balls === 3 && strikes === 2
                ? " animate-armed-pulse motion-reduce:animate-none motion-reduce:outline motion-reduce:outline-2 motion-reduce:outline-offset-2 motion-reduce:outline-sa-orange"
                : ""
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-eyebrow">Count</span>
              <span className="text-stat-xl text-[72px] text-sa-blue-deep [text-shadow:0_2px_8px_hsl(var(--sa-blue-deep)/0.18)]">
                {balls}-{strikes}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Mode-specific body */}
      <div className={`flex-1 min-h-0 overflow-y-auto ${isDock ? "px-4 py-3" : "p-3"}`}>
        {mode === "pitchPad" && (
          isDock ? (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-1.5">
                {PRIMARY.map((p) => (
                  <Button
                    key={p.type}
                    variant={p.variant}
                    size="pitchSm"
                    disabled={disabled}
                    onClick={() => onPitch(p.type)}
                    className="whitespace-normal leading-tight text-xs"
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={disabled}
                      className="h-11 text-xs"
                    >
                      More ▾
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-2" align="start" side="top">
                    <MoreMenu
                      disabled={disabled}
                      hasRunners={hasRunners}
                      onClose={() => setMoreOpen(false)}
                      onPitch={onPitch}
                      onIntentionalWalk={onIntentionalWalk}
                      onBalk={onBalk}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 px-2 text-xs text-muted-foreground"
                  onClick={() => setShowOutcomesManually(true)}
                  disabled={disabled}
                >
                  Direct outcome →
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {PRIMARY.map((p) => (
                <Button
                  key={p.type}
                  variant={p.variant}
                  size="pitch"
                  disabled={disabled}
                  onClick={() => onPitch(p.type)}
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
                  <MoreMenu
                    disabled={disabled}
                    hasRunners={hasRunners}
                    onClose={() => setMoreOpen(false)}
                    onPitch={onPitch}
                    onIntentionalWalk={onIntentionalWalk}
                    onBalk={onBalk}
                  />
                </PopoverContent>
              </Popover>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 px-2 text-xs text-muted-foreground"
                onClick={() => setShowOutcomesManually(true)}
                disabled={disabled}
              >
                Direct outcome →
              </Button>
            </div>
          )
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

interface MoreMenuProps {
  disabled: boolean;
  hasRunners: boolean;
  onClose: () => void;
  onPitch: (t: PitchType) => void;
  onIntentionalWalk: () => void;
  onBalk: () => void;
}

function MoreMenu({
  disabled,
  hasRunners,
  onClose,
  onPitch,
  onIntentionalWalk,
  onBalk,
}: MoreMenuProps) {
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          onClose();
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
          onClose();
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
          onClose();
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
          onClose();
          onBalk();
        }}
        className="h-9 text-sm font-semibold text-foreground justify-start"
        title={hasRunners ? "All runners advance one base" : "No runners on — balk has no effect"}
      >
        Balk
      </Button>
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
  const isMultiStep = armedResult === "DP" || armedResult === "TP" || armedResult === "FC";
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
            variant="commit"
            className="w-full"
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
            ? armedResult === "FC"
              ? "Drag the fielder who fielded the ball. Then drag the fielder who received at the force base."
              : "Drag the fielder who first touched the ball. Then drag each receiving fielder onto the bag covered."
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
