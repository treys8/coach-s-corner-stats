"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  HITS,
  NON_CONTACT,
  OTHER_IN_PLAY,
  OUTS_IN_PLAY,
  PRODUCTIVE,
  RARE_OUTCOMES,
  RESULT_DESC,
  RESULT_LABEL,
  isInPlay,
} from "@/lib/scoring/at-bat-helpers";
import type { AtBatResult, K3ReachSource } from "@/lib/scoring/types";
import { ARMED_IN_PLAY_PENDING, type ArmedState } from "@/hooks/scoring/useAtBatActions";

interface Props {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  onK3Reach: (src: K3ReachSource) => void;
  armedResult: ArmedState | null;
  /** Current strike count of the open PA. K3-reach row (K-WP / K-PB / K-E)
   *  only renders when strikes === 2 — the row is meaningless at 0-0 or
   *  0-1 and clutters the grid. */
  currentStrikes: number;
  /** Per-result enable predicate from `canRecord(result, state)`. Buttons
   *  that fail this check render dimmed and disabled so coaches don't
   *  accidentally log a SAC with no runners or a TP with one runner. */
  canRecord: (r: AtBatResult) => boolean;
}

export function OutcomeGrid({ disabled, onPick, onK3Reach, armedResult, currentStrikes, canRecord }: Props) {
  // After a "In play" tap, dim non-in-play options so the next tap lands
  // on a hit / out / FC / E. Treats armedResult sentinel as a UI hint, not
  // a hard disable — coach can still pick a non-in-play if they tapped
  // In play by mistake.
  const inPlayPending = armedResult === ARMED_IN_PLAY_PENDING;
  // The Button-level armedResult prop only highlights a chosen AtBatResult
  // (post in-play selection); pass null while pending so no specific
  // button gets the ring treatment.
  const buttonArm = inPlayPending ? null : armedResult;
  return (
    <div className="space-y-2">
      <NonContactRow
        disabled={disabled}
        onPick={onPick}
        armedResult={buttonArm}
        dimNonInPlay={inPlayPending}
      />
      {currentStrikes === 2 && <K3ReachRow disabled={disabled} onK3Reach={onK3Reach} dim={inPlayPending} />}
      <ButtonRow disabled={disabled} onPick={onPick} results={HITS} variant="hit" armedResult={buttonArm} dimNonInPlay={inPlayPending} canRecord={canRecord} />
      <ButtonRow disabled={disabled} onPick={onPick} results={OUTS_IN_PLAY} variant="out" armedResult={buttonArm} dimNonInPlay={inPlayPending} canRecord={canRecord} />
      <ButtonRow disabled={disabled} onPick={onPick} results={OTHER_IN_PLAY} variant="other" armedResult={buttonArm} dimNonInPlay={inPlayPending} canRecord={canRecord} />
      <ButtonRow disabled={disabled} onPick={onPick} results={PRODUCTIVE} variant="out" armedResult={buttonArm} dimNonInPlay={inPlayPending} canRecord={canRecord} />
    </div>
  );
}

// First row: K/BB/HBP + a "More" overflow that holds IBB and CI. Kept as
// its own component so the overflow trigger sits flush with the primary
// non-contact buttons instead of floating below.
function NonContactRow({
  disabled,
  onPick,
  armedResult,
  dimNonInPlay,
}: {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  armedResult: AtBatResult | null;
  dimNonInPlay?: boolean;
}) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const cls = "bg-sa-blue hover:bg-sa-blue/90 text-white";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {NON_CONTACT.map((r) => {
        const isArmed = armedResult === r;
        const dim = dimNonInPlay && !isInPlay(r);
        return (
          <Button
            key={r}
            disabled={disabled || (armedResult !== null && !isArmed)}
            onClick={() => onPick(r)}
            className={`h-12 text-base font-bold ${cls} ${isArmed ? "ring-4 ring-sa-blue-deep ring-offset-2" : ""}${dim ? " opacity-40" : ""}`}
            title={RESULT_DESC[r] ?? r}
          >
            {RESULT_LABEL[r]}
          </Button>
        );
      })}
      <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className={`h-12 text-base font-bold${dimNonInPlay ? " opacity-40" : ""}`}
            title="Rare outcomes (CI, IBB)"
          >
            More
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="end">
          <div className="grid grid-cols-2 gap-2">
            {RARE_OUTCOMES.map((r) => (
              <Button
                key={r}
                disabled={disabled}
                onClick={() => {
                  setOverflowOpen(false);
                  onPick(r);
                }}
                className={`h-10 text-sm font-bold ${cls}`}
                title={RESULT_DESC[r] ?? r}
              >
                {RESULT_LABEL[r]}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function K3ReachRow({
  disabled,
  onK3Reach,
  dim,
}: {
  disabled: boolean;
  onK3Reach: (src: K3ReachSource) => void;
  dim?: boolean;
}) {
  // Uncaught third strike: pitcher gets the K, batter reaches first.
  // Source matters for ER (PB/E unearned, WP earned).
  const buttons: { src: K3ReachSource; label: string }[] = [
    { src: "WP", label: "K-WP" },
    { src: "PB", label: "K-PB" },
    { src: "E", label: "K-E" },
  ];
  return (
    <div className={`grid grid-cols-3 gap-2${dim ? " opacity-40" : ""}`}>
      {buttons.map((b) => (
        <Button
          key={b.src}
          variant="outline"
          disabled={disabled}
          onClick={() => onK3Reach(b.src)}
          className="text-xs"
          title={`Strikeout, batter reached on ${b.src === "WP" ? "wild pitch" : b.src === "PB" ? "passed ball" : "error"}`}
        >
          {b.label}
        </Button>
      ))}
    </div>
  );
}

function ButtonRow({
  disabled,
  onPick,
  results,
  variant,
  armedResult,
  dimNonInPlay,
  canRecord,
}: {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  results: AtBatResult[];
  variant: "default" | "hit" | "out" | "other";
  armedResult: AtBatResult | null;
  /** When true (IN_PLAY_PENDING active), dim any non-in-play button so the
   *  next tap visually lands on a hit / out / FC / E. */
  dimNonInPlay?: boolean;
  canRecord: (r: AtBatResult) => boolean;
}) {
  const cls =
    variant === "hit"
      ? "bg-sa-orange hover:bg-sa-orange/90 text-white"
      : variant === "out"
        ? "bg-muted hover:bg-muted/80 text-foreground"
        : variant === "other"
          ? "bg-sa-blue-deep/80 hover:bg-sa-blue-deep text-white"
          : "bg-sa-blue hover:bg-sa-blue/90 text-white";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {results.map((r) => {
        const isArmed = armedResult === r;
        const contextDisabled = !canRecord(r);
        const dim = (dimNonInPlay && !isInPlay(r)) || contextDisabled;
        return (
          <Button
            key={r}
            disabled={disabled || contextDisabled || (armedResult !== null && !isArmed)}
            onClick={() => onPick(r)}
            className={`h-12 text-base font-bold ${cls} ${isArmed ? "ring-4 ring-sa-blue-deep ring-offset-2" : ""}${dim ? " opacity-40" : ""}`}
            title={RESULT_DESC[r] ?? r}
          >
            {RESULT_LABEL[r]}
          </Button>
        );
      })}
    </div>
  );
}
