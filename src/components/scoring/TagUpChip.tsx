"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DerivedAtBat, ReplayState } from "@/lib/scoring/types";

interface Props {
  state: ReplayState;
  /** Open the Edit Last Play dialog so the coach can nullify the advance
   *  if the runner left early. The chip itself is a passive confirmation;
   *  reversing the play is done through the existing correction path. */
  onLeftEarly: () => void;
}

// Caught-fly results where the rule actually requires the runner to retouch
// before advancing. PO and FO catch the standard fly outs; SF is by
// definition a tag-and-score from 3rd; LO and IF are caught line/pop
// drives — same retouch rule applies on appeal.
const TAG_UP_RESULTS = new Set(["FO", "LO", "PO", "SF", "IF"]);

/** Tag-up default-yes chip (v2 spec). After a caught fly where a runner
 *  advanced, show a passive "Tagged ✓" chip. Default behavior is YES
 *  (advance is legal; engine already applied it). Coach taps "Dismiss"
 *  to clear, or "Left early?" to open Edit Last Play and nullify. */
export function TagUpChip({ state, onLeftEarly }: Props) {
  const lastAB: DerivedAtBat | undefined = state.at_bats[state.at_bats.length - 1];

  // Re-show the chip whenever the last AB changes. Dismissal is keyed to
  // event_id so a one-tap dismissal doesn't leak to a later qualifying play.
  const [dismissedEventId, setDismissedEventId] = useState<string | null>(null);
  useEffect(() => {
    if (lastAB && dismissedEventId !== lastAB.event_id) {
      // No-op — useState already retains the prior dismissal; the guard
      // below filters it. Effect kept as a marker for future analytics.
    }
  }, [lastAB, dismissedEventId]);

  if (!lastAB) return null;
  if (!TAG_UP_RESULTS.has(lastAB.result)) return null;

  // Did at least one runner advance on the play (not just outs / batter)?
  const someoneAdvanced = lastAB.runner_advances.some(
    (a) =>
      a.from !== "batter" &&
      (a.to === "home" || a.to === "first" || a.to === "second" || a.to === "third"),
  );
  if (!someoneAdvanced) return null;

  if (dismissedEventId === lastAB.event_id) return null;

  return (
    <div
      role="status"
      className="rounded border border-emerald-600/60 bg-emerald-600/10 px-3 py-2 text-xs flex items-center justify-between gap-2"
    >
      <div>
        <div className="font-semibold uppercase tracking-wider text-emerald-700">
          Tagged ✓
        </div>
        <div className="text-muted-foreground mt-0.5">
          Caught fly + runner advance. Defaulted to legal tag-up.
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDismissedEventId(lastAB.event_id)}
          className="h-7 text-xs px-2 text-emerald-700"
        >
          Dismiss
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onLeftEarly}
          className="h-6 text-[11px] px-2 text-muted-foreground"
        >
          Left early?
        </Button>
      </div>
    </div>
  );
}
