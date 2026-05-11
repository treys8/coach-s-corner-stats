import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReplayState } from "@/lib/scoring/types";

export function FinalizeDialog({
  open,
  onOpenChange,
  state,
  onConfirm,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  state: ReplayState;
  onConfirm: () => void;
  disabled: boolean;
}) {
  const result =
    state.team_score > state.opponent_score ? "Win"
    : state.team_score < state.opponent_score ? "Loss"
    : "Tie";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finalize this game?</DialogTitle>
          <DialogDescription>
            The game will appear as final on the public scoreboard. You can un-finalize from the
            schedule page within 7 days if you need to fix something.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-center space-y-1">
          <p className="font-mono-stat text-4xl text-sa-blue-deep">
            {state.team_score} <span className="text-muted-foreground">–</span> {state.opponent_score}
          </p>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{result}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={disabled} onClick={onConfirm} className="bg-sa-orange hover:bg-sa-orange/90">
            {disabled ? "Finalizing…" : "Yes, finalize"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
