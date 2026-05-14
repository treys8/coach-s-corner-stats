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
import { RESULT_DESC } from "@/lib/scoring/at-bat-helpers";
import type { AtBatResult } from "@/lib/scoring/types";

interface Props {
  /** Non-null when prompt is pending. */
  pending: { armedResult: AtBatResult; terminalFielder: string } | null;
  disabled: boolean;
  onResolve: (choice: "hit" | "error") => void;
  onCancel: () => void;
}

/** Hit-vs-Error prompt (v2 spec, play-catalog §10.7). Fires when the
 *  fielder drag chain ends WITHOUT a base AND the armed outcome means
 *  the batter is safe (1B/2B/3B). No default — accuracy over speed. */
export function HitOrErrorDialog({ pending, disabled, onResolve, onCancel }: Props) {
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hit or Error?</DialogTitle>
          <DialogDescription>
            Chain ended without a throw to a base. Was the batter safe on a
            clean hit, or did the fielder ({pending?.terminalFielder ?? "—"})
            misplay it?
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button
            disabled={disabled}
            onClick={() => onResolve("hit")}
            className="h-14 bg-sa-orange hover:bg-sa-orange/90 text-white text-sm font-bold"
          >
            {pending?.armedResult
              ? RESULT_DESC[pending.armedResult] ?? `Hit (${pending.armedResult})`
              : "Hit"}
          </Button>
          <Button
            disabled={disabled}
            onClick={() => onResolve("error")}
            variant="outline"
            className="h-14 text-sm font-bold border-2"
          >
            Error
          </Button>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onCancel}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
