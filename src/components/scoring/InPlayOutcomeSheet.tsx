"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AtBatResult } from "@/lib/scoring/types";
import type { AtBatExtras } from "@/hooks/scoring/useAtBatActions";

/**
 * Stage 2 — In Play outcome sheet rendered as a LEFT-RAIL EXPANSION after
 * the coach taps "In play" on PitchRail. Replaces the flat v1 OutcomeGrid
 * for the in-play branch only; the Direct outcome → manual path still uses
 * OutcomeGrid because it needs the K/BB/HBP non-contact row too.
 *
 * Sectioned per the locked v2 spec ([[live_scoring_v2_ux_direction]]):
 *   HITS     — 1B, 2B, 3B, HR
 *   OUTS     — Out at first, Fly out, Line out, Pop out, Foul out, Sac fly*
 *   COMPOUND — FC, DP, TP*, Error, Sac bunt*
 *   More ▾   — CI, IFR  (GRD / Obstruction / Intentional drop deferred to
 *              Stage 5/6 when umpire_call events ship)
 *
 * *contextual via `canRecord(result, state)` from at-bat-helpers — SAC/SF/
 *  DP/TP buttons render dimmed-disabled when the state doesn't support them.
 *
 * "Out at first" arms `GO` for Stage 2 (most-common case). Stage 3's drag
 * chain refines to FO/LO/PO/etc when the fielder chain ends at first.
 *
 * "Foul out" arms `PO` with the `foul_out: true` extra so the F2(f) /
 * F7(f) scorebook notation is recoverable in Stage 3+.
 */
interface Props {
  disabled: boolean;
  onPick: (r: AtBatResult, extras?: AtBatExtras) => void;
  canRecord: (r: AtBatResult) => boolean;
}

type SectionButton = {
  key: string;
  label: string;
  result: AtBatResult;
  extras?: AtBatExtras;
  /** Tooltip / aria title — shown on hover and read aloud by screen readers. */
  title?: string;
};

const HITS: SectionButton[] = [
  { key: "1B", label: "Single", result: "1B" },
  { key: "2B", label: "Double", result: "2B" },
  { key: "3B", label: "Triple", result: "3B" },
  { key: "HR", label: "Home run", result: "HR" },
];

const OUTS: SectionButton[] = [
  { key: "OUT_AT_FIRST", label: "Out at first", result: "GO", title: "Any throw to first base. Stage 3 drag chain refines to FO/LO/PO." },
  { key: "FO", label: "Fly out", result: "FO" },
  { key: "LO", label: "Line out", result: "LO" },
  { key: "PO", label: "Pop out", result: "PO" },
  { key: "FOUL_OUT", label: "Foul out", result: "PO", extras: { foul_out: true }, title: "Pop / fly caught in foul territory — notated F2(f) / F7(f) in scorebook" },
  { key: "SF", label: "Sac fly", result: "SF", title: "Fly out scoring a runner from third (PDF §9.08)" },
];

const COMPOUND: SectionButton[] = [
  { key: "FC", label: "Fielder's choice", result: "FC" },
  { key: "DP", label: "Double play", result: "DP" },
  { key: "TP", label: "Triple play", result: "TP" },
  { key: "E", label: "Error", result: "E" },
  { key: "SAC", label: "Sac bunt", result: "SAC", title: "Bunt out advancing a runner (PDF §9.08)" },
];

const MORE: SectionButton[] = [
  { key: "CI", label: "Catcher's interference", result: "CI" },
  { key: "IF", label: "Infield fly", result: "IF", title: "Umpire's IFR call — batter is out, runners hold" },
];

export function InPlayOutcomeSheet({ disabled, onPick, canRecord }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Section
        heading="Hits"
        buttons={HITS}
        cls="bg-sa-orange hover:bg-sa-orange/90 text-white"
        disabled={disabled}
        onPick={onPick}
        canRecord={canRecord}
      />
      <Section
        heading="Outs"
        buttons={OUTS}
        cls="bg-muted hover:bg-muted/80 text-foreground"
        disabled={disabled}
        onPick={onPick}
        canRecord={canRecord}
      />
      <Section
        heading="Compound"
        buttons={COMPOUND}
        cls="bg-sa-blue-deep/80 hover:bg-sa-blue-deep text-white"
        disabled={disabled}
        onPick={onPick}
        canRecord={canRecord}
      />
      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className="h-10 text-sm self-stretch"
          >
            More ▾
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start" side="right">
          <div className="flex flex-col gap-2">
            {MORE.map((b) => (
              <Button
                key={b.key}
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  setMoreOpen(false);
                  onPick(b.result, b.extras);
                }}
                className="h-9 text-sm justify-start font-semibold"
                title={b.title}
              >
                {b.label}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Section({
  heading,
  buttons,
  cls,
  disabled,
  onPick,
  canRecord,
}: {
  heading: string;
  buttons: SectionButton[];
  cls: string;
  disabled: boolean;
  onPick: (r: AtBatResult, extras?: AtBatExtras) => void;
  canRecord: (r: AtBatResult) => boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-0.5">
        {heading}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {buttons.map((b) => {
          const contextDisabled = !canRecord(b.result);
          return (
            <Button
              key={b.key}
              disabled={disabled || contextDisabled}
              onClick={() => onPick(b.result, b.extras)}
              className={`h-11 text-sm font-bold ${cls}${contextDisabled ? " opacity-40" : ""}`}
              title={b.title}
            >
              {b.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
