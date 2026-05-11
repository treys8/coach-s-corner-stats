import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AtBatResult, DerivedAtBat } from "@/lib/scoring/types";
import { EDIT_RESULTS, RESULT_DESC, RESULT_LABEL } from "../shared/constants";

export function EditLastPlayDialog({
  open,
  onOpenChange,
  lastAtBat,
  onPick,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  lastAtBat: DerivedAtBat | null;
  onPick: (r: AtBatResult) => void;
  disabled: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit last play</DialogTitle>
          <DialogDescription>
            Replace the last at-bat&apos;s result. Bases, outs, and runs re-derive from the
            new outcome. Spray location and fielder carry forward; re-record the play
            from scratch if those need to change.
          </DialogDescription>
        </DialogHeader>
        {lastAtBat && (
          <p className="text-sm text-muted-foreground border-l-2 border-sa-blue pl-3 my-2">
            Currently: <span className="font-semibold text-sa-blue-deep">{RESULT_DESC[lastAtBat.result] ?? lastAtBat.result}</span>
            {lastAtBat.description ? <> — {lastAtBat.description}</> : null}
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2">
          {EDIT_RESULTS.map((r) => (
            <Button
              key={r}
              variant="outline"
              disabled={disabled || !lastAtBat || lastAtBat.result === r}
              onClick={() => onPick(r)}
              className="h-12 font-bold"
              title={RESULT_DESC[r] ?? r}
            >
              {RESULT_LABEL[r]}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
