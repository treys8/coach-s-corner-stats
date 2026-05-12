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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ReplayState, SubstitutionPayload } from "@/lib/scoring/types";
import type { RosterDisplay } from "@/hooks/use-live-scoring";

const SUB_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"] as const;

type SubKind = SubstitutionPayload["sub_type"];

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  state: ReplayState;
  roster: RosterDisplay[];
  names: Map<string, string>;
  onSubmit: (payload: SubstitutionPayload) => void;
  disabled: boolean;
}

export function SubstitutionDialog({
  open,
  onOpenChange,
  state,
  roster,
  names,
  onSubmit,
  disabled,
}: Props) {
  const [subKind, setSubKind] = useState<SubKind>("regular");
  const [slotOrder, setSlotOrder] = useState<number | null>(null);
  const [inPlayerId, setInPlayerId] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);
  const [originalBase, setOriginalBase] = useState<"first" | "second" | "third" | null>(null);

  useEffect(() => {
    if (!open) {
      setSubKind("regular");
      setSlotOrder(null);
      setInPlayerId(null);
      setPosition(null);
      setOriginalBase(null);
    }
  }, [open]);

  const slot = state.our_lineup.find((s) => s.batting_order === slotOrder) ?? null;
  const lineupIds = new Set(
    state.our_lineup.map((s) => s.player_id).filter(Boolean) as string[],
  );
  const benchPlayers = roster.filter(
    (p) => !lineupIds.has(p.id) && p.id !== state.current_pitcher_id,
  );

  // Eligible re-entry slots: starter is currently OUT and has not already re-entered.
  const reEntrySlots = state.our_lineup.filter(
    (s) => s.is_starter && !s.re_entered && s.player_id !== s.original_player_id && s.original_player_id,
  );

  const occupiedBases = (["first", "second", "third"] as const).filter(
    (b) => state.bases[b] !== null,
  );

  // Courtesy-runner role — derived from which baserunner matches the
  // current pitcher / catcher.
  const catcherSlot = state.our_lineup.find((s) => s.position === "C");
  const catcherId = catcherSlot?.player_id ?? null;
  const baseRunnerId = originalBase ? state.bases[originalBase]?.player_id ?? null : null;
  const courtesyRole: "pitcher" | "catcher" | null =
    baseRunnerId === state.current_pitcher_id
      ? "pitcher"
      : baseRunnerId === catcherId
        ? "catcher"
        : null;
  const courtesyAlreadyUsedForRole = courtesyRole
    ? state.courtesy_runners_used.some((c) => c.role === courtesyRole)
    : false;

  const outName = slot?.player_id ? names.get(slot.player_id) ?? null : null;

  const canSubmit = (() => {
    if (disabled) return false;
    if (subKind === "regular" || subKind === "pinch_hit") {
      return !!(slot?.player_id && inPlayerId && inPlayerId !== slot.player_id);
    }
    if (subKind === "pinch_run") {
      return !!(originalBase && baseRunnerId && inPlayerId && inPlayerId !== baseRunnerId);
    }
    if (subKind === "courtesy_run") {
      return !!(originalBase && baseRunnerId && inPlayerId && courtesyRole && !courtesyAlreadyUsedForRole);
    }
    if (subKind === "re_entry") {
      return !!(slotOrder && slot?.original_player_id && inPlayerId === slot.original_player_id);
    }
    return false;
  })();

  const handleSubmit = () => {
    if (subKind === "regular" || subKind === "pinch_hit") {
      if (!slot?.player_id || !inPlayerId || !slotOrder) return;
      onSubmit({
        out_player_id: slot.player_id,
        in_player_id: inPlayerId,
        batting_order: slotOrder,
        position: position ?? slot.position ?? null,
        sub_type: subKind,
      });
      return;
    }
    if (subKind === "pinch_run") {
      if (!originalBase || !baseRunnerId || !inPlayerId) return;
      const runnerSlot = state.our_lineup.find((s) => s.player_id === baseRunnerId);
      onSubmit({
        out_player_id: baseRunnerId,
        in_player_id: inPlayerId,
        batting_order: runnerSlot?.batting_order ?? 0,
        position: runnerSlot?.position ?? null,
        sub_type: "pinch_run",
        original_base: originalBase,
      });
      return;
    }
    if (subKind === "courtesy_run") {
      if (!originalBase || !baseRunnerId || !inPlayerId) return;
      onSubmit({
        out_player_id: baseRunnerId,
        in_player_id: inPlayerId,
        batting_order: 0,
        position: null,
        sub_type: "courtesy_run",
        original_base: originalBase,
      });
      return;
    }
    if (subKind === "re_entry") {
      if (!slotOrder || !slot?.original_player_id || inPlayerId !== slot.original_player_id) return;
      const outId = slot.player_id ?? "";
      onSubmit({
        out_player_id: outId,
        in_player_id: slot.original_player_id,
        batting_order: slotOrder,
        position: position ?? slot.position ?? null,
        sub_type: "re_entry",
      });
      return;
    }
  };

  const subKindLabel: Record<SubKind, string> = {
    regular: "Regular",
    pinch_hit: "Pinch hit",
    pinch_run: "Pinch run",
    courtesy_run: "Courtesy run (NFHS)",
    re_entry: "Re-entry",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Substitution</DialogTitle>
          <DialogDescription>
            Replace a player. Pinch run swaps the lineup; courtesy run is
            NFHS-only and doesn&apos;t change the batting order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Type</Label>
            <Select value={subKind} onValueChange={(v) => setSubKind(v as SubKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(subKindLabel) as SubKind[]).map((k) => (
                  <SelectItem key={k} value={k}>{subKindLabel[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(subKind === "regular" || subKind === "pinch_hit") && (
            <>
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
              </div>
            </>
          )}

          {(subKind === "pinch_run" || subKind === "courtesy_run") && (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Runner on base</Label>
                <Select
                  value={originalBase ?? ""}
                  onValueChange={(v) => setOriginalBase((v || null) as "first" | "second" | "third" | null)}
                >
                  <SelectTrigger><SelectValue placeholder={occupiedBases.length ? "— pick base —" : "No runners on base"} /></SelectTrigger>
                  <SelectContent>
                    {occupiedBases.map((b) => {
                      const id = state.bases[b]?.player_id ?? null;
                      const who = id ? names.get(id) ?? "Runner" : "Runner";
                      return (
                        <SelectItem key={b} value={b}>
                          {b === "first" ? "1B" : b === "second" ? "2B" : "3B"} — {who}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {subKind === "courtesy_run" && originalBase && !courtesyRole && (
                <p className="text-xs text-sa-orange">
                  Courtesy runner is NFHS-only and only valid for the pitcher or catcher of record.
                </p>
              )}
              {subKind === "courtesy_run" && courtesyRole && courtesyAlreadyUsedForRole && (
                <p className="text-xs text-sa-orange">
                  A courtesy runner has already been used for the {courtesyRole} this game.
                </p>
              )}

              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Runner coming in</Label>
                <Select
                  value={inPlayerId ?? ""}
                  onValueChange={(v) => setInPlayerId(v || null)}
                  disabled={!originalBase}
                >
                  <SelectTrigger><SelectValue placeholder={originalBase ? "— pick bench player —" : "Pick a base first"} /></SelectTrigger>
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
            </>
          )}

          {subKind === "re_entry" && (
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Eligible starter slot</Label>
              <Select
                value={slotOrder ? String(slotOrder) : ""}
                onValueChange={(v) => {
                  const n = Number(v);
                  setSlotOrder(n);
                  const s = state.our_lineup.find((x) => x.batting_order === n);
                  setInPlayerId(s?.original_player_id ?? null);
                  setPosition(s?.position ?? null);
                }}
              >
                <SelectTrigger><SelectValue placeholder={reEntrySlots.length ? "— pick slot —" : "No eligible re-entries"} /></SelectTrigger>
                <SelectContent>
                  {reEntrySlots.map((s) => {
                    const original = s.original_player_id ? names.get(s.original_player_id) ?? "Starter" : "Starter";
                    const current = s.player_id ? names.get(s.player_id) ?? "—" : "(empty)";
                    return (
                      <SelectItem key={s.batting_order} value={String(s.batting_order)}>
                        {s.batting_order}. {original} (currently {current})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                NFHS Rule 3-1-3: a starter may re-enter once, in their original slot.
              </p>
            </div>
          )}
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
