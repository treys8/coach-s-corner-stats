"use client";

import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OpposingBatterPanel } from "@/components/score/OpposingBatterPanel";
import { LiveSprayChart } from "@/components/scoring/LiveSprayChart";
import { formatOpposingSlotLabel } from "@/lib/scoring/at-bat-helpers";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";
import type { OpposingLineupSlot, ReplayState } from "@/lib/scoring/types";

interface SidebarSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReplayState;
  weAreBatting: boolean;
  currentOppSlot: OpposingLineupSlot | null;
  currentOpponentBatterId: string | null;
  currentBatterIdForChip: string | null;
  opposingProfileCache: Map<string, OpposingBatterProfile>;
}

export function SidebarSheet({
  open,
  onOpenChange,
  state,
  weAreBatting,
  currentOppSlot,
  currentOpponentBatterId,
  currentBatterIdForChip,
  opposingProfileCache,
}: SidebarSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Batter detail</SheetTitle>
          <SheetDescription>Opposing batter career line and spray chart.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {!weAreBatting && (
            <OpposingBatterPanel
              opponentPlayerId={currentOpponentBatterId}
              slotLabel={
                currentOppSlot
                  ? formatOpposingSlotLabel(currentOppSlot)
                  : "Set opposing lineup to track batters."
              }
              cache={opposingProfileCache}
            />
          )}
          <Card className="p-3">
            <h3 className="font-display text-sm uppercase tracking-wider text-sa-blue mb-2">Spray chart</h3>
            <LiveSprayChart
              state={state}
              currentBatterId={currentBatterIdForChip}
              currentBatterIsOurs={weAreBatting}
            />
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}
