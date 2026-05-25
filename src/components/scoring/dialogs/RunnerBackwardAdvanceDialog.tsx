"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Base } from "@/lib/scoring/types";
import type {
  PendingRunnerBackward,
  RunnerBackwardChoice,
} from "@/hooks/scoring/useRunnerActions";

interface Props {
  pending: PendingRunnerBackward | null;
  disabled: boolean;
  onResolve: (choice: RunnerBackwardChoice) => void;
  onCancel: () => void;
}

type OptionDef = {
  value: RunnerBackwardChoice;
  label: string;
  cls: string;
};

// Reasons a runner ended up behind their pre-drag position. Covers the
// most common case (an auto-advance was wrong, e.g. R2→3rd on a single
// when the coach actually held the runner) plus a few defensible
// alternates. "Other" is a generic stamp — no free-text input for now.
const OPTIONS: OptionDef[] = [
  { value: "did_not_advance",  label: "Runner did not advance", cls: "bg-muted hover:bg-muted/80 text-foreground" },
  { value: "returned_on_throw", label: "Returned on the throw",  cls: "bg-sa-blue hover:bg-sa-blue/90 text-white" },
  { value: "other",             label: "Other",                  cls: "bg-muted hover:bg-muted/80 text-foreground" },
];

const TO_LABEL: Record<Base, string> = { first: "1st", second: "2nd", third: "3rd" };

/** Backward runner-drag reason picker. Opens when the coach drags a
 *  runner to a base behind their current spot — typically to undo an
 *  auto-advance applied after a hit. The choice gets persisted as
 *  `attribution_label` on an `error_advance` event so the timeline
 *  describes the play correctly. */
export function RunnerBackwardAdvanceDialog({
  pending,
  disabled,
  onResolve,
  onCancel,
}: Props) {
  if (pending === null) return null;

  const fromLabel = TO_LABEL[pending.from] ?? pending.from;
  const toLabel = TO_LABEL[pending.to] ?? pending.to;

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            Why did the runner end up at {toLabel}?
          </DialogTitle>
          <DialogDescription>
            Moved back from {fromLabel}. Pick a reason so the play is
            recorded correctly.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2 pt-2">
          {OPTIONS.map((o) => (
            <Button
              key={o.value}
              disabled={disabled}
              onClick={() => onResolve(o.value)}
              className={`h-12 text-sm font-bold ${o.cls}`}
            >
              {o.label}
            </Button>
          ))}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
