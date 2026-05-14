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

interface Props {
  /** Non-null when a prompt is pending. Carries the runner label for copy. */
  pending: { runnerLabel: string | null } | null;
  disabled: boolean;
  onResolve: (counted: boolean) => void;
}

/** Timing-play prompt (play-catalog §7.13 / §7.14): on a non-force 3rd
 *  out where a runner crossed home, the run counts iff the runner
 *  crossed BEFORE the tag. Always prompt — rare, narrow scope. Yes
 *  keeps the run (default behavior). No nullifies it via correction. */
export function TimingPlayDialog({ pending, disabled, onResolve }: Props) {
  return (
    <Dialog open={pending !== null} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Did the run count?</DialogTitle>
          <DialogDescription>
            {pending?.runnerLabel
              ? `${pending.runnerLabel} crossed home on the play that ended the inning.`
              : "A runner crossed home on the play that ended the inning."}
            {" "}If the third out was a tag (non-force), the run counts only if the runner
            touched home before the tag.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="grid grid-cols-2 gap-2 pt-2">
          <Button
            disabled={disabled}
            onClick={() => onResolve(true)}
            className="h-12 bg-sa-orange hover:bg-sa-orange/90 text-white font-bold"
          >
            Yes — run counts
          </Button>
          <Button
            disabled={disabled}
            onClick={() => onResolve(false)}
            variant="outline"
            className="h-12 font-bold border-2"
          >
            No — nullify run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
