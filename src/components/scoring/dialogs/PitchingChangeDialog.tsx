import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RosterDisplay } from "../shared/lib";

export function PitchingChangeDialog({
  open,
  onOpenChange,
  roster,
  currentPitcherId,
  names,
  onPick,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  roster: RosterDisplay[];
  currentPitcherId: string | null;
  names: Map<string, string>;
  onPick: (id: string) => void;
  disabled: boolean;
}) {
  const currentName = currentPitcherId ? names.get(currentPitcherId) : null;
  const candidates = roster.filter((p) => p.id !== currentPitcherId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pitching change</DialogTitle>
          <DialogDescription>
            {currentName ? <>Currently on the mound: <span className="font-semibold">{currentName}</span>. Tap a player to bring them in.</> : <>Tap a player to put them on the mound.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {candidates.map((p) => {
              const num = p.jersey_number ? `#${p.jersey_number} ` : "";
              return (
                <Button
                  key={p.id}
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onPick(p.id)}
                  className="h-14 justify-start text-left"
                >
                  <span className="font-mono-stat text-sa-blue-deep mr-2">{num}</span>
                  <span>{p.first_name} {p.last_name}</span>
                </Button>
              );
            })}
          </div>
          {candidates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No other players on the roster.
            </p>
          )}
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
