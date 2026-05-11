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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReplayState, SubstitutionPayload } from "@/lib/scoring/types";
import { SUB_POSITIONS } from "../shared/constants";
import type { RosterDisplay } from "../shared/lib";

export function SubstitutionDialog({
  open,
  onOpenChange,
  state,
  roster,
  names,
  onSubmit,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  state: ReplayState;
  roster: RosterDisplay[];
  names: Map<string, string>;
  onSubmit: (payload: SubstitutionPayload) => void;
  disabled: boolean;
}) {
  const [slotOrder, setSlotOrder] = useState<number | null>(null);
  const [inPlayerId, setInPlayerId] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);

  // Reset state when the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setSlotOrder(null);
      setInPlayerId(null);
      setPosition(null);
    }
  }, [open]);

  const slot = state.our_lineup.find((s) => s.batting_order === slotOrder) ?? null;
  const lineupIds = new Set(
    state.our_lineup.map((s) => s.player_id).filter(Boolean) as string[],
  );
  const benchPlayers = roster.filter(
    (p) => !lineupIds.has(p.id) && p.id !== state.current_pitcher_id,
  );

  const outName = slot?.player_id ? names.get(slot.player_id) ?? null : null;
  const canSubmit =
    !disabled && slot?.player_id && inPlayerId && inPlayerId !== slot.player_id;

  const handleSubmit = () => {
    if (!slot?.player_id || !inPlayerId || !slotOrder) return;
    onSubmit({
      out_player_id: slot.player_id,
      in_player_id: inPlayerId,
      batting_order: slotOrder,
      position: position ?? slot.position ?? null,
      sub_type: "regular",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Substitution</DialogTitle>
          <DialogDescription>
            Replace a player in the lineup. The new player keeps the slot&apos;s batting order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lineup slot</Label>
            <Select
              value={slotOrder ? String(slotOrder) : ""}
              onValueChange={(v) => {
                const n = Number(v);
                setSlotOrder(n);
                const target = state.our_lineup.find((s) => s.batting_order === n);
                setPosition(target?.position ?? null);
              }}
            >
              <SelectTrigger><SelectValue placeholder="— pick slot —" /></SelectTrigger>
              <SelectContent>
                {state.our_lineup.map((s) => {
                  const who = s.player_id ? names.get(s.player_id) ?? "—" : "(empty)";
                  return (
                    <SelectItem key={s.batting_order} value={String(s.batting_order)}>
                      {s.batting_order}. {who}{s.position ? ` (${s.position})` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {outName && (
              <p className="text-xs text-muted-foreground mt-1">
                Coming out: <span className="font-semibold text-sa-blue-deep">{outName}</span>
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Coming in</Label>
            <Select
              value={inPlayerId ?? ""}
              onValueChange={(v) => setInPlayerId(v || null)}
              disabled={!slotOrder}
            >
              <SelectTrigger><SelectValue placeholder={slotOrder ? "— pick bench player —" : "Pick a slot first"} /></SelectTrigger>
              <SelectContent>
                {benchPlayers.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No bench players available.</div>
                )}
                {benchPlayers.map((p) => {
                  const num = p.jersey_number ? `#${p.jersey_number} ` : "";
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      {num}{p.first_name} {p.last_name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Position</Label>
            <Select
              value={position ?? ""}
              onValueChange={(v) => setPosition(v || null)}
              disabled={!slotOrder}
            >
              <SelectTrigger><SelectValue placeholder="— position —" /></SelectTrigger>
              <SelectContent>
                {SUB_POSITIONS.filter((pos) => pos !== "DH" || state.use_dh).map((pos) => (
                  <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Defaults to the slot&apos;s current position. Pitching changes are handled separately.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit} className="bg-sa-orange hover:bg-sa-orange/90">
            Make substitution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
