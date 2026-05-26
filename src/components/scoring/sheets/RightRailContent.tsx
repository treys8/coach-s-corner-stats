"use client";

import { Card } from "@/components/ui/card";
import { OpposingBatterPanel } from "@/components/score/OpposingBatterPanel";
import { LiveSprayChart } from "@/components/scoring/LiveSprayChart";
import { IFRBanner } from "@/components/scoring/IFRBanner";
import { MercyBanner } from "@/components/scoring/MercyBanner";
import { SuspendedBanner } from "@/components/scoring/SuspendedBanner";
import { TagUpChip } from "@/components/scoring/TagUpChip";
import { MoundVisitCounter } from "@/components/scoring/MoundVisitCounter";
import { formatOpposingSlotLabel } from "@/lib/scoring/at-bat-helpers";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";
import type { OpposingLineupSlot, ReplayState } from "@/lib/scoring/types";
import type { SprayMarker } from "@/components/spray/SprayField";
import type { LeagueRules } from "@/lib/scoring/league-defaults";

export interface RightRailContentProps {
  state: ReplayState;
  weAreBatting: boolean;
  submitting: boolean;
  currentOppSlot: OpposingLineupSlot | null;
  currentOpponentBatterId: string | null;
  currentBatterIdForChip: string | null;
  opposingProfileCache: Map<string, OpposingBatterProfile>;
  oppBatterCurrentGameMarkers: SprayMarker[];
  gameDate: string;
  gameId: string;
  leagueRules: LeagueRules;
  onConfirmIFR: () => void;
  onTagUpLeftEarly: () => void;
}

/**
 * Shared body of the right-side panel — used both by the inline `lg:flex`
 * aside in the scoring shell and by `SidebarSheet` (the `<lg` substitute
 * triggered via the User icon in the status bar). Renders banners +
 * batter context + spray chart in a single column.
 *
 * Spray-chart rule: exactly one chart is visible at any time.
 *  - Fielding → `OpposingBatterPanel` shows a unified career-vs-you +
 *    in-game chart with a year filter.
 *  - Batting  → `LiveSprayChart` shows in-game markers for the current
 *    batter (no career-vs-this-team channel exists for our roster).
 */
export function RightRailContent({
  state,
  weAreBatting,
  submitting,
  currentOppSlot,
  currentOpponentBatterId,
  currentBatterIdForChip,
  opposingProfileCache,
  oppBatterCurrentGameMarkers,
  gameDate,
  gameId,
  leagueRules,
  onConfirmIFR,
  onTagUpLeftEarly,
}: RightRailContentProps) {
  return (
    <div className="space-y-3">
      <SuspendedBanner state={state} />
      <MercyBanner state={state} rules={leagueRules} />
      {!weAreBatting && (
        <>
          <IFRBanner
            state={state}
            weAreBatting={weAreBatting}
            disabled={submitting}
            onConfirm={onConfirmIFR}
          />
          <TagUpChip state={state} onLeftEarly={onTagUpLeftEarly} />
          <MoundVisitCounter state={state} weAreBatting={weAreBatting} />
          <OpposingBatterPanel
            opponentPlayerId={currentOpponentBatterId}
            slotLabel={
              currentOppSlot
                ? formatOpposingSlotLabel(currentOppSlot)
                : "Set opposing lineup to track batters."
            }
            cache={opposingProfileCache}
            currentGameMarkers={oppBatterCurrentGameMarkers}
            currentGameDate={gameDate}
            currentGameId={gameId}
          />
        </>
      )}
      {weAreBatting && (
        <Card className="p-3">
          <h3 className="font-display text-sm uppercase tracking-wider text-sa-blue mb-2">
            Spray chart
          </h3>
          <LiveSprayChart
            state={state}
            currentBatterId={currentBatterIdForChip}
            currentBatterIsOurs={weAreBatting}
          />
        </Card>
      )}
    </div>
  );
}
