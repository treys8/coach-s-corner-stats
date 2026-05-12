"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLiveScoring, type RosterDisplay } from "@/hooks/use-live-scoring";
import { RESULT_DESC, formatOpposingSlotLabel } from "@/lib/scoring/at-bat-helpers";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";
import { DefensiveDiamond } from "@/components/scoring/DefensiveDiamond";
import { LiveSprayChart } from "@/components/scoring/LiveSprayChart";
import { OpposingBatterPanel } from "@/components/score/OpposingBatterPanel";
import { EditOpposingLineupDialog } from "@/components/scoring/EditOpposingLineupDialog";
import { GameStatusBar } from "@/components/scoring/GameStatusBar";
import { BoxScoreToggle, LineScore } from "@/components/scoring/LineScore";
import { PitchPad } from "@/components/scoring/PitchPad";
import { OutcomeGrid } from "@/components/scoring/OutcomeGrid";
import { FlowControls } from "@/components/scoring/FlowControls";
import { RunnersControls } from "@/components/scoring/RunnersControls";
import { PitchingChangeDialog } from "@/components/scoring/dialogs/PitchingChangeDialog";
import { SubstitutionDialog } from "@/components/scoring/dialogs/SubstitutionDialog";
import { EditLastPlayDialog } from "@/components/scoring/dialogs/EditLastPlayDialog";
import { RunnerActionDialog } from "@/components/scoring/dialogs/RunnerActionDialog";
import { FinalizeDialog } from "@/components/scoring/dialogs/FinalizeDialog";

export type { RosterDisplay } from "@/hooks/use-live-scoring";

interface LiveScoringProps {
  gameId: string;
  roster: RosterDisplay[];
  teamShortLabel: string;
  opponentName: string;
  schoolId: string;
  myTeamId: string;
  gameDate: string;
  opponentTeamId: string | null;
  /** Fires after the game_finalized event lands so the parent page can
   *  swap to FinalStub from its own local state. */
  onFinalized?: () => void;
}

export function LiveScoring({
  gameId,
  roster,
  teamShortLabel,
  opponentName,
  schoolId,
  myTeamId,
  gameDate,
  opponentTeamId,
  onFinalized,
}: LiveScoringProps) {
  const isMobile = useIsMobile();
  // Cache opposing-batter profiles across batter changes so cycling through
  // a 9-deep lineup doesn't refetch the same profiles on every loop.
  const opposingProfileCache = useRef(new Map<string, OpposingBatterProfile>());
  const {
    state,
    loading,
    submitting,
    names,
    weAreBatting,
    currentSlot,
    currentOppSlot,
    currentOpponentBatterId,
    lastSeq,
    refresh,
    lastUndoableEvent,
    armedResult,
    setArmedResult,
    runnerAction,
    setRunnerAction,
    onOutcomePicked,
    submitAtBat,
    submitPitch,
    onFielderDrop,
    submitMidPA,
    endHalfInning,
    submitPitchingChange,
    submitMoundVisit,
    submitSubstitution,
    editLastPlay,
    finalize,
    submitUndo,
  } = useLiveScoring({
    gameId,
    roster,
    opposingProfileCache: opposingProfileCache.current,
    onFinalized,
  });

  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [pitchChangeOpen, setPitchChangeOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [opposingLineupEditOpen, setOpposingLineupEditOpen] = useState(false);
  const [boxScoreOpen, setBoxScoreOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Box score and side panel default open on desktop, collapsed on mobile.
  // `useIsMobile` returns false on the SSR pass; sync once the breakpoint
  // is known.
  useEffect(() => {
    setBoxScoreOpen(!isMobile);
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading live state…</div>;
  }

  const currentBatterName = currentSlot?.player_id ? names.get(currentSlot.player_id) ?? null : null;
  const pitcherName = state.current_pitcher_id ? names.get(state.current_pitcher_id) ?? null : null;
  const currentBatterIdForChip = weAreBatting
    ? currentSlot?.player_id ?? null
    : currentOpponentBatterId;

  return (
    <div className="space-y-3">
      <GameStatusBar
        state={state}
        weAreBatting={weAreBatting}
        teamShortLabel={teamShortLabel}
        opponentName={opponentName}
        currentBatterName={currentBatterName}
        pitcherName={pitcherName}
        canUndo={lastUndoableEvent !== null && !submitting}
        onUndo={() => void submitUndo()}
        onOpenManage={() => setManageOpen(true)}
        lastPlayText={state.last_play_text}
      />

      <BoxScoreToggle open={boxScoreOpen} onToggle={() => setBoxScoreOpen((v) => !v)} />
      {boxScoreOpen && <LineScore state={state} />}

      <div
        className={
          sidebarOpen
            ? "grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] gap-4"
            : "grid grid-cols-1 gap-4"
        }
      >
        <div className="space-y-3 relative">
          {armedResult && (
            <div className="flex items-center justify-between flex-wrap gap-2 text-sm rounded-md border bg-muted/40 px-3 py-2">
              <span>
                <span className="text-muted-foreground">Recording </span>
                <span className="font-semibold text-sa-blue-deep">{RESULT_DESC[armedResult] ?? armedResult}</span>
                <span className="text-muted-foreground"> · drag the fielder who made the play to where the ball was.</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void submitAtBat(armedResult, null)}
                  disabled={submitting}
                >
                  Skip location
                </Button>
                <Button size="sm" variant="outline" onClick={() => setArmedResult(null)} disabled={submitting}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {!sidebarOpen && (
            <Button
              size="sm"
              variant="outline"
              className="hidden lg:inline-flex absolute right-0 top-0 z-10 h-8 px-2"
              onClick={() => setSidebarOpen(true)}
              aria-label="Show side panel"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <DefensiveDiamond
            state={state}
            names={names}
            weAreBatting={weAreBatting}
            currentBatterId={currentBatterIdForChip}
            dragMode={!!armedResult && !submitting}
            onFielderDrop={onFielderDrop}
            onRunnerAction={(base, runnerId) => setRunnerAction({ base, runnerId })}
          />
          <PitchPad
            balls={state.current_balls}
            strikes={state.current_strikes}
            disabled={submitting || state.outs >= 3}
            onPitch={submitPitch}
          />
          <OutcomeGrid
            disabled={submitting || state.outs >= 3}
            onPick={onOutcomePicked}
            onK3Reach={(src) => void submitAtBat("K_swinging", null, src)}
            armedResult={armedResult}
          />
        </div>
        {sidebarOpen && (
          <aside className="lg:sticky lg:top-[6rem] lg:self-start space-y-4">
            <div className="hidden lg:flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setSidebarOpen(false)}
                aria-label="Hide side panel"
              >
                Hide
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
            {!weAreBatting && (
              <OpposingBatterPanel
                opponentPlayerId={currentOpponentBatterId}
                slotLabel={
                  currentOppSlot
                    ? formatOpposingSlotLabel(currentOppSlot)
                    : "Set opposing lineup to track batters."
                }
                cache={opposingProfileCache.current}
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
          </aside>
        )}
      </div>

      <Sheet open={manageOpen} onOpenChange={setManageOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Manage game</SheetTitle>
            <SheetDescription>Runners, subs, edits, and finalize.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-5">
            <RunnersControls
              bases={state.bases}
              names={names}
              weAreBatting={weAreBatting}
              disabled={submitting}
              onSubmit={submitMidPA}
              onComplete={() => setManageOpen(false)}
            />
            <FlowControls
              onEndHalf={() => { void endHalfInning(); setManageOpen(false); }}
              onPitchingChange={() => { setPitchChangeOpen(true); setManageOpen(false); }}
              onSubstitution={() => { setSubOpen(true); setManageOpen(false); }}
              onEditLastPlay={() => { setEditOpen(true); setManageOpen(false); }}
              onEditOpposingLineup={() => { setOpposingLineupEditOpen(true); setManageOpen(false); }}
              onFinalize={() => { setConfirmFinalize(true); setManageOpen(false); }}
              onMoundVisit={() => {
                void submitMoundVisit().then((r) => {
                  if (r.forcedRemoval) setPitchChangeOpen(true);
                });
                setManageOpen(false);
              }}
              conferencesThisGame={
                state.defensive_conferences.filter(
                  (c) => c.pitcher_id === state.current_pitcher_id,
                ).length
              }
              disabled={submitting}
              outs={state.outs}
              canEdit={state.at_bats.length > 0}
            />
          </div>
        </SheetContent>
      </Sheet>

      <PitchingChangeDialog
        open={pitchChangeOpen}
        onOpenChange={setPitchChangeOpen}
        roster={roster}
        state={state}
        names={names}
        onPick={(id) => {
          void submitPitchingChange(id).then(() => setPitchChangeOpen(false));
        }}
        disabled={submitting}
      />
      <SubstitutionDialog
        open={subOpen}
        onOpenChange={setSubOpen}
        state={state}
        roster={roster}
        names={names}
        onSubmit={(payload) => {
          void submitSubstitution(payload).then(() => setSubOpen(false));
        }}
        disabled={submitting}
      />
      <EditLastPlayDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        gameId={gameId}
        lastAtBat={state.at_bats[state.at_bats.length - 1] ?? null}
        names={names}
        onSubmit={(supersededEventId, correctedAtBat) => {
          void editLastPlay(supersededEventId, correctedAtBat).then(() => setEditOpen(false));
        }}
        disabled={submitting}
      />
      <FinalizeDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        state={state}
        onConfirm={() => {
          void finalize().then(() => setConfirmFinalize(false));
        }}
        disabled={submitting}
      />
      <RunnerActionDialog
        action={runnerAction}
        onClose={() => setRunnerAction(null)}
        names={names}
        bases={state.bases}
        onSubmit={submitMidPA}
        disabled={submitting}
      />
      <EditOpposingLineupDialog
        open={opposingLineupEditOpen}
        onOpenChange={setOpposingLineupEditOpen}
        gameId={gameId}
        schoolId={schoolId}
        myTeamId={myTeamId}
        gameDate={gameDate}
        opponentName={opponentName}
        opponentTeamId={opponentTeamId}
        currentLineup={state.opposing_lineup}
        currentOpponentUseDh={state.opponent_use_dh}
        onSaved={async () => { await refresh(); }}
      />
    </div>
  );
}
