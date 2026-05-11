"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DefensiveDiamond } from "@/components/scoring/DefensiveDiamond";
import { LiveSprayChart } from "@/components/scoring/LiveSprayChart";
import { useGameEvents } from "./hooks/useGameEvents";
import type { RosterDisplay } from "./shared/lib";
import { RESULT_DESC } from "./shared/constants";
import { TopBar } from "./panels/TopBar";
import { BatterCard } from "./panels/BatterCard";
import { BallStrikeCounter } from "./panels/BallStrikeCounter";
import { OutcomeGrid } from "./panels/OutcomeGrid";
import { FlowControls } from "./panels/FlowControls";
import { PitchingChangeDialog } from "./dialogs/PitchingChangeDialog";
import { SubstitutionDialog } from "./dialogs/SubstitutionDialog";
import { EditLastPlayDialog } from "./dialogs/EditLastPlayDialog";
import { FinalizeDialog } from "./dialogs/FinalizeDialog";

export type { RosterDisplay } from "./shared/lib";

interface LiveScoringProps {
  gameId: string;
  roster: RosterDisplay[];
}

export function LiveScoring({ gameId, roster }: LiveScoringProps) {
  const game = useGameEvents({ gameId, roster });
  const [pitchChangeOpen, setPitchChangeOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);

  if (game.loading) {
    return <div className="text-sm text-muted-foreground">Loading live state…</div>;
  }

  const onPickPitcher = async (id: string) => {
    await game.submitPitchingChange(id);
    setPitchChangeOpen(false);
  };
  const onSubmitSub = async (payload: Parameters<typeof game.submitSubstitution>[0]) => {
    await game.submitSubstitution(payload);
    setSubOpen(false);
  };
  const onPickEdit = async (r: Parameters<typeof game.editLastPlay>[0]) => {
    await game.editLastPlay(r);
    setEditOpen(false);
  };
  const onConfirmFinalize = async () => {
    await game.finalize();
    setConfirmFinalize(false);
  };

  return (
    <div className="space-y-4">
      <TopBar state={game.state} weAreBatting={game.weAreBatting} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        <div className="space-y-4">
          <Card className="p-3">
            {game.armedResult && (
              <div className="mb-2 flex items-center justify-between flex-wrap gap-2 text-sm">
                <span>
                  <span className="text-muted-foreground">Recording </span>
                  <span className="font-semibold text-sa-blue-deep">
                    {RESULT_DESC[game.armedResult] ?? game.armedResult}
                  </span>
                  <span className="text-muted-foreground"> · drag the fielder who made the play to where the ball was.</span>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void game.submitAtBat(game.armedResult!, null)}
                    disabled={game.submitting}
                  >
                    Skip location
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => game.setArmedResult(null)}
                    disabled={game.submitting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <DefensiveDiamond
              state={game.state}
              names={game.names}
              weAreBatting={game.weAreBatting}
              dragMode={!!game.armedResult && !game.submitting}
              onFielderDrop={game.onFielderDrop}
            />
          </Card>
          <BatterCard
            state={game.state}
            weAreBatting={game.weAreBatting}
            currentSlot={game.currentSlot}
            names={game.names}
          />
          <BallStrikeCounter
            balls={game.balls}
            strikes={game.strikes}
            onBalls={game.setBalls}
            onStrikes={game.setStrikes}
          />
          <OutcomeGrid
            disabled={game.submitting || game.state.outs >= 3}
            onPick={game.onOutcomePicked}
            armedResult={game.armedResult}
          />
          <FlowControls
            onEndHalf={game.endHalfInning}
            onPitchingChange={() => setPitchChangeOpen(true)}
            onSubstitution={() => setSubOpen(true)}
            onEditLastPlay={() => setEditOpen(true)}
            onFinalize={() => setConfirmFinalize(true)}
            disabled={game.submitting}
            outs={game.state.outs}
            canEdit={game.state.at_bats.length > 0}
          />
          {game.state.last_play_text && (
            <Card className="p-3 bg-muted/40 text-sm">
              <span className="text-muted-foreground">Last play: </span>
              {game.state.last_play_text}
            </Card>
          )}
        </div>
        <aside className="lg:sticky lg:top-4 lg:self-start space-y-4">
          <Card className="p-3">
            <h3 className="font-display text-sm uppercase tracking-wider text-sa-blue mb-2">Spray chart</h3>
            <LiveSprayChart state={game.state} />
          </Card>
        </aside>
      </div>
      <PitchingChangeDialog
        open={pitchChangeOpen}
        onOpenChange={setPitchChangeOpen}
        roster={roster}
        currentPitcherId={game.state.current_pitcher_id}
        names={game.names}
        onPick={onPickPitcher}
        disabled={game.submitting}
      />
      <SubstitutionDialog
        open={subOpen}
        onOpenChange={setSubOpen}
        state={game.state}
        roster={roster}
        names={game.names}
        onSubmit={onSubmitSub}
        disabled={game.submitting}
      />
      <EditLastPlayDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lastAtBat={game.state.at_bats[game.state.at_bats.length - 1] ?? null}
        onPick={onPickEdit}
        disabled={game.submitting}
      />
      <FinalizeDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        state={game.state}
        onConfirm={onConfirmFinalize}
        disabled={game.submitting}
      />
    </div>
  );
}
