"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ReplayState } from "@/lib/scoring/types";

interface Props {
  state: ReplayState;
  weAreBatting: boolean;
  disabled: boolean;
  onConfirm: () => void;
}

/** Auto-suggest banner for the Infield Fly Rule (play-catalog §2.13).
 *  Preconditions for an IFR to apply on the NEXT batted ball:
 *   - fewer than 2 outs
 *   - runners on 1st & 2nd, OR bases loaded
 *  Banner appears when we're fielding and those conditions hold AND no
 *  IFR is already queued. Coach taps "Call IFR" to post the
 *  umpire_call(IFR) event; the engine then forces the batter out on the
 *  next at_bat regardless of catch outcome. "Dismiss" hides until the
 *  next state change. Umpire's call is canonical — we don't auto-fire. */
export function IFRBanner({ state, weAreBatting, disabled, onConfirm }: Props) {
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);

  if (weAreBatting) return null;
  if (state.outs >= 2) return null;

  const onFirst = state.bases.first !== null;
  const onSecond = state.bases.second !== null;
  const onThird = state.bases.third !== null;
  const ifrEligible = onFirst && onSecond; // 1+2 OR bases loaded (3 implies 1+2)
  if (!ifrEligible) return null;

  // Already queued — don't re-prompt.
  if (state.pending_umpire_calls.some((c) => c.kind === "IFR")) return null;

  // Dismissal signature: tied to the current base state so a new runner
  // arrangement re-opens the banner. Inning + outs included so dismissal
  // doesn't leak across half-innings.
  const sig = `${state.inning}-${state.half}-${state.outs}-${onFirst ? 1 : 0}${
    onSecond ? 1 : 0
  }${onThird ? 1 : 0}`;
  if (dismissedSig === sig) return null;

  return (
    <div
      role="status"
      className="rounded border border-sa-orange/60 bg-sa-orange/10 px-3 py-2 text-xs flex items-center justify-between gap-2"
    >
      <div>
        <div className="font-semibold uppercase tracking-wider text-sa-orange">
          Possible Infield Fly
        </div>
        <div className="text-muted-foreground mt-0.5">
          Runners on 1st &amp; 2nd, &lt;2 outs. Tap if the umpire calls it.
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button
          size="sm"
          disabled={disabled}
          onClick={onConfirm}
          className="h-7 bg-sa-orange hover:bg-sa-orange/90 text-white text-xs px-2"
        >
          Call IFR
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => setDismissedSig(sig)}
          className="h-6 text-xs text-muted-foreground px-2"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
