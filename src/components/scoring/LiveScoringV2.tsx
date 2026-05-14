"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLiveScoring, type RosterDisplay } from "@/hooks/use-live-scoring";
import {
  canRecord as canRecordResult,
  formatOpposingSlotLabel,
} from "@/lib/scoring/at-bat-helpers";
import { balkAdvances } from "@/lib/scoring/advances";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";
import { DefensiveDiamond } from "@/components/scoring/DefensiveDiamond";
import { LiveSprayChart } from "@/components/scoring/LiveSprayChart";
import { OpposingBatterPanel } from "@/components/score/OpposingBatterPanel";
import { EditOpposingLineupDialog } from "@/components/scoring/EditOpposingLineupDialog";
import { GameStatusBar } from "@/components/scoring/GameStatusBar";
import { PitchRail } from "@/components/scoring/PitchRail";
import { LineScoreSheet } from "@/components/scoring/sheets/LineScoreSheet";
import { ARMED_IN_PLAY_PENDING } from "@/hooks/scoring/useAtBatActions";
import { FlowControls } from "@/components/scoring/FlowControls";
import { RunnersControls } from "@/components/scoring/RunnersControls";
import { PitchingChangeDialog } from "@/components/scoring/dialogs/PitchingChangeDialog";
import { SubstitutionDialog } from "@/components/scoring/dialogs/SubstitutionDialog";
import { EditLastPlayDialog } from "@/components/scoring/dialogs/EditLastPlayDialog";
import { RunnerActionDialog } from "@/components/scoring/dialogs/RunnerActionDialog";
import { FinalizeDialog } from "@/components/scoring/dialogs/FinalizeDialog";

interface LiveScoringV2Props {
  gameId: string;
  roster: RosterDisplay[];
  teamShortLabel: string;
  opponentName: string;
  schoolId: string;
  myTeamId: string;
  gameDate: string;
  opponentTeamId: string | null;
  backHref?: string;
  onFinalized?: () => void;
}

/**
 * v2 live scoring shell — three columns at ≥1180px tablet landscape.
 * Left rail: PitchRail (count badge + vertical pitch buttons + More menu).
 * Center: DefensiveDiamond.
 * Right rail: OpposingBatter + spray chart, collapsible via Hide › toggle.
 * GameStatusBar across the top. No bottom bar — pitch entry moved to rail.
 *
 * Wraps the same `useLiveScoring` hook as v1 to keep behavior identical.
 * Viewport gating between v1 and v2 happens at the page level.
 */
export function LiveScoringV2({
  gameId,
  roster,
  teamShortLabel,
  opponentName,
  schoolId,
  myTeamId,
  gameDate,
  opponentTeamId,
  backHref,
  onFinalized,
}: LiveScoringV2Props) {
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
    skipLocation,
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
  const [boxSheetOpen, setBoxSheetOpen] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(true);

  if (loading) {
    return (
      <div className="h-[100dvh] p-6 flex flex-col gap-3">
        {backHref && (
          <Link
            href={backHref}
            className="text-xs text-muted-foreground hover:text-sa-orange uppercase tracking-wider"
          >
            ← Score picker
          </Link>
        )}
        <div className="text-sm text-muted-foreground">Loading live state…</div>
      </div>
    );
  }

  const currentBatterName = currentSlot?.player_id ? names.get(currentSlot.player_id) ?? null : null;
  const pitcherName = state.current_pitcher_id ? names.get(state.current_pitcher_id) ?? null : null;
  const currentBatterIdForChip = weAreBatting
    ? currentSlot?.player_id ?? null
    : currentOpponentBatterId;
  const dragMode = !!armedResult && armedResult !== ARMED_IN_PLAY_PENDING && !submitting;

  const hasRunners = !!(state.bases.first || state.bases.second || state.bases.third);

  const handleBalk = () => {
    const advances = balkAdvances(state.bases);
    if (advances.length === 0) return;
    void submitMidPA("balk", { advances }, "balk");
  };

  // Grid: status bar across top, then a flex row with left rail (260px),
  // center diamond (1fr), right rail (300px when open).
  return (
    <div className="grid grid-rows-[auto_minmax(0,1fr)] h-[100dvh] bg-background">
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
        onOpenBox={() => setBoxSheetOpen(true)}
        lastPlayText={state.last_play_text}
        backHref={backHref}
        bleed={false}
        showCount={false}
      />

      <div
        className={
          rightRailOpen
            ? "min-h-0 grid grid-cols-[260px_minmax(0,1fr)_300px]"
            : "min-h-0 grid grid-cols-[260px_minmax(0,1fr)]"
        }
      >
        <PitchRail
          balls={state.current_balls}
          strikes={state.current_strikes}
          outs={state.outs}
          hasRunners={hasRunners}
          submitting={submitting}
          onPitch={submitPitch}
          onOutcomePicked={onOutcomePicked}
          onK3Reach={(src) => void submitAtBat("K_swinging", null, src)}
          onIntentionalWalk={() => onOutcomePicked("IBB")}
          onBalk={handleBalk}
          canRecord={(r) => canRecordResult(r, state)}
          armedResult={armedResult}
          setArmedResult={setArmedResult}
          onSkipLocation={skipLocation}
        />

        <div className="relative min-h-0 flex items-center justify-center overflow-hidden p-2">
          {!rightRailOpen && (
            <Button
              size="sm"
              variant="outline"
              className="absolute right-2 top-2 z-10 h-8 px-2"
              onClick={() => setRightRailOpen(true)}
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
            dragMode={dragMode}
            onFielderDrop={onFielderDrop}
            onRunnerAction={(base, runnerId) => setRunnerAction({ base, runnerId })}
            fillContainer
          />
        </div>

        {rightRailOpen && (
          <aside className="flex flex-col overflow-y-auto border-l p-3 space-y-3">
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setRightRailOpen(false)}
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
              <h3 className="font-display text-sm uppercase tracking-wider text-sa-blue mb-2">
                Spray chart
              </h3>
              <LiveSprayChart
                state={state}
                currentBatterId={currentBatterIdForChip}
                currentBatterIsOurs={weAreBatting}
              />
            </Card>
          </aside>
        )}
      </div>

      {/* Box-score sheet — line score overlay from the status bar */}
      <LineScoreSheet open={boxSheetOpen} onOpenChange={setBoxSheetOpen} state={state} />

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
        onSaved={async () => { await refresh(); }}
      />
    </div>
  );
}
