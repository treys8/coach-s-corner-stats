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
import type { ReplayState } from "@/lib/scoring/types";
import type { RosterDisplay } from "@/hooks/use-live-scoring";

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  roster: RosterDisplay[];
  state: ReplayState;
  names: Map<string, string>;
  onPick: (id: string) => void;
  disabled: boolean;
}

export function PitchingChangeDialog({
  open,
  onOpenChange,
  roster,
  state,
  names,
  onPick,
  disabled,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);

  // Reset confirmation state on open/close.
  useEffect(() => {
    if (!open) setPending(null);
  }, [open]);

  const currentPitcherId = state.current_pitcher_id;
  const currentName = currentPitcherId ? names.get(currentPitcherId) : null;
  const candidates = roster.filter((p) => p.id !== currentPitcherId);

  const lineupSlotOf = (pid: string | null) =>
    state.our_lineup.find((s) => s.player_id === pid) ?? null;
  const sideEffect = (newPitcherId: string): string | null => {
    if (state.use_dh) return null;
    const newSlot = lineupSlotOf(newPitcherId);
    const oldSlot = lineupSlotOf(currentPitcherId);
    if (newSlot) {
      return `${names.get(newPitcherId) ?? "Player"} stays in slot ${newSlot.batting_order}; their position becomes P.`;
    }
    if (oldSlot && currentPitcherId) {
      return `${names.get(newPitcherId) ?? "New pitcher"} takes slot ${oldSlot.batting_order} from ${currentName ?? "the current pitcher"}.`;
    }
    return null;
  };

  if (pending) {
    const newName = names.get(pending) ?? "the new pitcher";
    const note = sideEffect(pending);
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm pitching change</DialogTitle>
            <DialogDescription>
              {currentName ? <>{currentName} → {newName}.</> : <>Bring in {newName}.</>}
              {note && <> {note}</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={disabled} onClick={() => setPending(null)}>
              Back
            </Button>
            <Button
              disabled={disabled}
              onClick={() => onPick(pending)}
              className="bg-sa-orange hover:bg-sa-orange/90"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
                  onClick={() => setPending(p.id)}
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
