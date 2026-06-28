"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
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

// Union of every code the grid can show, for the tap glossary. Touch users
// can't reach the per-button `title=` tooltips (hover never fires), so the
// dotted codes are otherwise unexplained on the primary scoring surface.
const GLOSSARY_RESULTS: AtBatResult[] = Array.from(
  new Set<AtBatResult>([
    ...NON_CONTACT,
    ...RARE_OUTCOMES,
    ...HITS,
    ...OUTS_IN_PLAY,
    ...OTHER_IN_PLAY,
    ...PRODUCTIVE,
  ]),
);
import type { AtBatResult, K3ReachSource } from "@/lib/scoring/types";
import { ARMED_IN_PLAY_PENDING, type ArmedState } from "@/hooks/scoring/useAtBatActions";

// Armed-outcome affordance: a breathing ring under normal motion, plus a
// static outline fallback (via motion-reduce:) so reduced-motion users still
// get a clear "this outcome is selected" indicator instead of nothing.
const ARMED_RING =
  "animate-armed-pulse motion-reduce:animate-none motion-reduce:outline motion-reduce:outline-2 motion-reduce:outline-offset-2 motion-reduce:outline-sa-orange";

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
  const [legendOpen, setLegendOpen] = useState(false);
  return (
    <div className="space-y-2">
      {/* Tap glossary — touch-only (desktop has the hover tooltips). */}
      <div className="hidden touch:flex justify-end">
        <button
          type="button"
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
          className="inline-flex items-center gap-1 min-h-[36px] px-2 text-xs font-semibold text-muted-foreground"
        >
          <span aria-hidden>ⓘ</span>
          {legendOpen ? "Hide codes" : "What do these mean?"}
        </button>
      </div>
      {legendOpen && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted/50 p-2 text-[11px] leading-tight">
          {GLOSSARY_RESULTS.map((r) => (
            <div key={r} className="flex gap-1.5">
              <dt className="font-bold shrink-0">{RESULT_LABEL[r]}</dt>
              <dd className="text-muted-foreground">{RESULT_DESC[r] ?? r}</dd>
            </div>
          ))}
        </dl>
      )}
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
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {NON_CONTACT.map((r) => {
        const isArmed = armedResult === r;
        const dim = dimNonInPlay && !isInPlay(r);
        return (
          <Button
            key={r}
            variant="outcomeBase"
            size="outcome"
            disabled={disabled || (armedResult !== null && !isArmed)}
            onClick={() => onPick(r)}
            className={`${isArmed ? ARMED_RING : ""}${dim ? " opacity-40" : ""}`}
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
            size="outcome"
            disabled={disabled}
            className={dimNonInPlay ? "opacity-40" : ""}
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
                variant="outcomeBase"
                disabled={disabled}
                onClick={() => {
                  setOverflowOpen(false);
                  onPick(r);
                }}
                className="h-10 text-sm font-bold"
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
  const btnVariant: ButtonProps["variant"] =
    variant === "hit"
      ? "outcomeHit"
      : variant === "out"
        ? "outcomeOut"
        : variant === "other"
          ? "outcomeOther"
          : "outcomeBase";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {results.map((r) => {
        const isArmed = armedResult === r;
        const contextDisabled = !canRecord(r);
        const dim = (dimNonInPlay && !isInPlay(r)) || contextDisabled;
        return (
          <Button
            key={r}
            variant={btnVariant}
            size="outcome"
            disabled={disabled || contextDisabled || (armedResult !== null && !isArmed)}
            onClick={() => onPick(r)}
            className={`${isArmed ? ARMED_RING : ""}${dim ? " opacity-40" : ""}`}
            title={RESULT_DESC[r] ?? r}
          >
            {RESULT_LABEL[r]}
          </Button>
        );
      })}
    </div>
  );
}
