"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FIELDER_POSITIONS, type FielderPosition } from "@/components/scoring/diamond-geometry";
import type { Base } from "@/lib/scoring/types";
import type {
  PendingRunnerAttribution,
  RunnerAttributionChoice,
} from "@/hooks/scoring/useRunnerActions";

interface Props {
  pending: PendingRunnerAttribution | null;
  disabled: boolean;
  /** Resolve with the chosen attribution. For fielding/throwing errors the
   *  fielderPosition is required — the dialog gates the resolve until the
   *  coach taps a fielder. For all other choices fielderPosition is null. */
  onResolve: (choice: RunnerAttributionChoice, fielderPosition: FielderPosition | null) => void;
  onCancel: () => void;
}

type OptionDef = {
  value: RunnerAttributionChoice;
  label: string;
  cls: string;
  /** Which phases this option appears in. `post_play` = between PAs (no
   *  pitch in flight). `during_at_bat` = a pitch was thrown in the
   *  current PA. */
  phases: ("post_play" | "during_at_bat")[];
};

const OPTIONS: OptionDef[] = [
  // Pitch-required attributions — only when a pitch is in flight.
  { value: "stolen_base",            label: "Stolen base",            cls: "bg-sa-orange hover:bg-sa-orange/90 text-white",       phases: ["during_at_bat"] },
  { value: "wild_pitch",             label: "Wild pitch",             cls: "bg-sa-blue hover:bg-sa-blue/90 text-white",            phases: ["during_at_bat"] },
  { value: "passed_ball",            label: "Passed ball",            cls: "bg-sa-blue hover:bg-sa-blue/90 text-white",            phases: ["during_at_bat"] },
  // Post-play attributions — only between PAs.
  { value: "advanced_on_throw",      label: "Advanced on the throw",  cls: "bg-sa-orange hover:bg-sa-orange/90 text-white",       phases: ["post_play"] },
  { value: "tag_up_advance",         label: "Tag-up advance",         cls: "bg-sa-orange hover:bg-sa-orange/90 text-white",       phases: ["post_play"] },
  // Errors and defensive indifference apply in both phases.
  { value: "fielding_error",         label: "Fielding error",         cls: "bg-red-600 hover:bg-red-700 text-white",               phases: ["post_play", "during_at_bat"] },
  { value: "throwing_error",         label: "Throwing error",         cls: "bg-red-600 hover:bg-red-700 text-white",               phases: ["post_play", "during_at_bat"] },
  { value: "defensive_indifference", label: "Defensive indifference", cls: "bg-muted hover:bg-muted/80 text-foreground",           phases: ["post_play", "during_at_bat"] },
];

const POSITION_DIGIT: Record<FielderPosition, string> = {
  P: "1", C: "2", "1B": "3", "2B": "4", "3B": "5", SS: "6",
  LF: "7", CF: "8", RF: "9",
};

const TO_LABEL: Record<Base, string> = { first: "1st", second: "2nd", third: "3rd" };

/** Between-PA runner advance attribution. After a batter is on base and
 *  before the next pitch, dragging the runner to the next base is
 *  ambiguous (SB / WP / PB / error / DI). Coach must declare. If an error
 *  is picked, the second step forces a fielder tap so the error gets
 *  charged to a specific position. */
export function RunnerAdvanceAttributionDialog({
  pending,
  disabled,
  onResolve,
  onCancel,
}: Props) {
  const [errorKind, setErrorKind] = useState<"fielding_error" | "throwing_error" | null>(null);

  // Reset the inner picker whenever the dialog closes / a new prompt opens.
  useEffect(() => {
    if (pending === null) setErrorKind(null);
  }, [pending]);

  if (pending === null) return null;

  const toLabel = TO_LABEL[pending.to] ?? pending.to;
  const visibleOptions = OPTIONS.filter((o) => o.phases.includes(pending.phase));

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {errorKind ? "Which fielder?" : `How did the runner reach ${toLabel}?`}
          </DialogTitle>
          <DialogDescription>
            {errorKind
              ? "Tap the fielder who committed the error."
              : "The batter's hit stands. This pick only attributes the advance to the right play."}
          </DialogDescription>
        </DialogHeader>

        {errorKind === null ? (
          <div className="grid grid-cols-2 gap-2 pt-2">
            {visibleOptions.map((o) => {
              const isError = o.value === "fielding_error" || o.value === "throwing_error";
              return (
                <Button
                  key={o.value}
                  disabled={disabled}
                  onClick={() => {
                    if (isError) {
                      setErrorKind(o.value as "fielding_error" | "throwing_error");
                    } else {
                      onResolve(o.value, null);
                    }
                  }}
                  className={`h-12 text-sm font-bold ${o.cls}`}
                >
                  {o.label}
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 pt-2">
            {FIELDER_POSITIONS.map((pos) => (
              <Button
                key={pos}
                disabled={disabled}
                onClick={() => onResolve(errorKind, pos)}
                className="h-14 flex flex-col items-center justify-center gap-0 font-bold"
                variant="outline"
              >
                <span className="font-mono-stat text-lg tabular-nums leading-none">
                  {POSITION_DIGIT[pos]}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
                  {pos}
                </span>
              </Button>
            ))}
          </div>
        )}

        <DialogFooter className="pt-2">
          {errorKind !== null && (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => setErrorKind(null)}
              className="mr-auto"
            >
              ← Back
            </Button>
          )}
          <Button variant="ghost" disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
