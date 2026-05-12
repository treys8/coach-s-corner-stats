"use client";

import { Button } from "@/components/ui/button";
import {
  HITS,
  NON_CONTACT,
  OTHER_IN_PLAY,
  OUTS_IN_PLAY,
  PRODUCTIVE,
  RESULT_DESC,
  RESULT_LABEL,
} from "@/lib/scoring/at-bat-helpers";
import type { AtBatResult, K3ReachSource } from "@/lib/scoring/types";

interface Props {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  onK3Reach: (src: K3ReachSource) => void;
  armedResult: AtBatResult | null;
}

export function OutcomeGrid({ disabled, onPick, onK3Reach, armedResult }: Props) {
  return (
    <div className="space-y-2">
      <ButtonRow disabled={disabled} onPick={onPick} results={NON_CONTACT} variant="default" armedResult={armedResult} />
      <K3ReachRow disabled={disabled} onK3Reach={onK3Reach} />
      <ButtonRow disabled={disabled} onPick={onPick} results={HITS} variant="hit" armedResult={armedResult} />
      <ButtonRow disabled={disabled} onPick={onPick} results={OUTS_IN_PLAY} variant="out" armedResult={armedResult} />
      <ButtonRow disabled={disabled} onPick={onPick} results={OTHER_IN_PLAY} variant="other" armedResult={armedResult} />
      <ButtonRow disabled={disabled} onPick={onPick} results={PRODUCTIVE} variant="out" armedResult={armedResult} />
    </div>
  );
}

function K3ReachRow({
  disabled,
  onK3Reach,
}: {
  disabled: boolean;
  onK3Reach: (src: K3ReachSource) => void;
}) {
  // Uncaught third strike: pitcher gets the K, batter reaches first.
  // Source matters for ER (PB/E unearned, WP earned).
  const buttons: { src: K3ReachSource; label: string }[] = [
    { src: "WP", label: "K-WP" },
    { src: "PB", label: "K-PB" },
    { src: "E", label: "K-E" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
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
}: {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  results: AtBatResult[];
  variant: "default" | "hit" | "out" | "other";
  armedResult: AtBatResult | null;
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
        return (
          <Button
            key={r}
            disabled={disabled || (armedResult !== null && !isArmed)}
            onClick={() => onPick(r)}
            className={`h-16 text-lg font-bold ${cls} ${isArmed ? "ring-4 ring-sa-blue-deep ring-offset-2" : ""}`}
            title={RESULT_DESC[r] ?? r}
          >
            {RESULT_LABEL[r]}
          </Button>
        );
      })}
    </div>
  );
}
