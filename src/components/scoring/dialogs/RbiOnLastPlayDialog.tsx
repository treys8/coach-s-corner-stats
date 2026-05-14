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
import type { PendingRbiPrompt } from "@/hooks/scoring/useRunnerActions";

interface Props {
  pending: PendingRbiPrompt | null;
  /** Display label for the runner who scored (jersey / last name). */
  runnerLabel: string | null;
  onResolve: (onLastPlay: boolean) => void;
  onCancel: () => void;
  disabled: boolean;
}

const FROM_LABEL: Record<"first" | "second" | "third", string> = {
  first: "1st",
  second: "2nd",
  third: "3rd",
};

/**
 * Stage 4 — surfaces when the coach drops a runner on SAFE@home. The
 * answer decides RBI attribution:
 *  - Yes: this runner is scoring as a direct result of the previous at-bat
 *    (delayed advance after the throw home, runner held up and then waved
 *    around). The run carries an RBI to the previous batter.
 *  - No: standalone steal/throw-home, no RBI.
 *
 * Today we record only the run event; the RBI-correction back-fill onto
 * the last at_bat is intentionally deferred — calling it out in copy so
 * coaches set expectations (Stage 5 will close this loop).
 */
export function RbiOnLastPlayDialog({
  pending,
  runnerLabel,
  onResolve,
  onCancel,
  disabled,
}: Props) {
  const open = pending !== null;
  const fromLabel = pending ? FROM_LABEL[pending.from] : "";
  const who = runnerLabel ?? "Runner";

  return (
    <Dialog open={open} onOpenChange={(b) => { if (!b) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>On last play?</DialogTitle>
          <DialogDescription>
            {who} scored from {fromLabel}. Was this run part of the previous
            at-bat (RBI to last batter) or an independent play (no RBI)?
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button
            onClick={() => onResolve(true)}
            disabled={disabled}
            className="bg-sa-orange hover:bg-sa-orange/90 text-white"
          >
            Yes — on last play
          </Button>
          <Button
            onClick={() => onResolve(false)}
            disabled={disabled}
            variant="outline"
          >
            No — separate play
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={disabled}>
            Cancel run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
