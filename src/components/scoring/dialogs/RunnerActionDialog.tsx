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
import type {
  Bases,
  CaughtStealingPayload,
  PickoffPayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";
import { allUpAdvances } from "@/lib/scoring/at-bat-helpers";

interface Props {
  action: { base: "first" | "second" | "third"; runnerId: string | null } | null;
  onClose: () => void;
  names: Map<string, string>;
  bases: Bases;
  onSubmit: (
    eventType: GameEventType,
    payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload,
    clientPrefix: string,
  ) => void;
  disabled: boolean;
}

export function RunnerActionDialog({
  action,
  onClose,
  names,
  bases,
  onSubmit,
  disabled,
}: Props) {
  const open = action !== null;
  const runnerName = action?.runnerId ? names.get(action.runnerId) ?? "Runner" : "Runner";
  const stealTarget: "second" | "third" | "home" | null =
    action?.base === "first" ? "second"
    : action?.base === "second" ? "third"
    : action?.base === "third" ? "home"
    : null;
  const stealLabel = stealTarget === "home" ? "Steal home"
    : stealTarget === "third" ? "Steal 3rd"
    : "Steal 2nd";

  const steal = () => {
    if (!action || !stealTarget) return;
    const payload: StolenBasePayload = {
      runner_id: action.runnerId,
      from: action.base,
      to: stealTarget,
    };
    onSubmit("stolen_base", payload, `sb-${action.base}`);
  };
  const caughtStealing = () => {
    if (!action) return;
    const payload: CaughtStealingPayload = { runner_id: action.runnerId, from: action.base };
    onSubmit("caught_stealing", payload, `cs-${action.base}`);
  };
  const pickoff = () => {
    if (!action) return;
    const payload: PickoffPayload = { runner_id: action.runnerId, from: action.base };
    onSubmit("pickoff", payload, `po-${action.base}`);
  };
  const allUp = (eventType: GameEventType, prefix: string) => {
    const payload: RunnerMovePayload = { advances: allUpAdvances(bases) };
    onSubmit(eventType, payload, prefix);
  };

  return (
    <Dialog open={open} onOpenChange={(b) => { if (!b) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{runnerName} on {action?.base === "first" ? "1st" : action?.base === "second" ? "2nd" : "3rd"}</DialogTitle>
          <DialogDescription>
            Pick what happened. Wild pitch, passed ball, and balk advance every runner one base.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 py-2">
          <Button onClick={steal} disabled={disabled} className="bg-sa-orange hover:bg-sa-orange/90 text-white">
            {stealLabel}
          </Button>
          <Button onClick={caughtStealing} disabled={disabled} variant="outline">
            Caught stealing
          </Button>
          <Button onClick={pickoff} disabled={disabled} variant="outline">
            Pickoff out
          </Button>
          <Button onClick={() => allUp("wild_pitch", "wp")} disabled={disabled} variant="outline">
            Wild pitch
          </Button>
          <Button onClick={() => allUp("passed_ball", "pb")} disabled={disabled} variant="outline">
            Passed ball
          </Button>
          <Button onClick={() => allUp("balk", "bk")} disabled={disabled} variant="outline">
            Balk
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={disabled}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
