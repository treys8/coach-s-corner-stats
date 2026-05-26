"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLiveScoring, type RosterDisplay } from "@/hooks/use-live-scoring";
import { canRecord as canRecordResult } from "@/lib/scoring/at-bat-helpers";
import { balkAdvances } from "@/lib/scoring/advances";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";
import { DefensiveDiamond } from "@/components/scoring/DefensiveDiamond";
import { EditOpposingLineupDialog } from "@/components/scoring/EditOpposingLineupDialog";
import { GameStatusBar } from "@/components/scoring/GameStatusBar";
import { PitchRail } from "@/components/scoring/PitchRail";
import { useLeagueRules } from "@/hooks/use-league-rules";
import { seasonYearFor } from "@/lib/season";
import { LineScoreSheet } from "@/components/scoring/sheets/LineScoreSheet";
import { SidebarSheet } from "@/components/scoring/sheets/SidebarSheet";
import { RightRailContent } from "@/components/scoring/sheets/RightRailContent";
import { ARMED_IN_PLAY_PENDING } from "@/hooks/scoring/useAtBatActions";
import { FlowControls } from "@/components/scoring/FlowControls";
import { RunnersControls } from "@/components/scoring/RunnersControls";
import { PitchingChangeDialog } from "@/components/scoring/dialogs/PitchingChangeDialog";
import { SubstitutionDialog } from "@/components/scoring/dialogs/SubstitutionDialog";
import { EditLastPlayDialog } from "@/components/scoring/dialogs/EditLastPlayDialog";
import { RunnerActionDialog } from "@/components/scoring/dialogs/RunnerActionDialog";
import { RbiOnLastPlayDialog } from "@/components/scoring/dialogs/RbiOnLastPlayDialog";
import { RunnerAdvanceAttributionDialog } from "@/components/scoring/dialogs/RunnerAdvanceAttributionDialog";
import { TimingPlayDialog } from "@/components/scoring/dialogs/TimingPlayDialog";
import { FinalizeDialog } from "@/components/scoring/dialogs/FinalizeDialog";

interface LiveScoringProps {
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
 * Live scoring shell. Single responsive layout that swaps chrome at the
 * Tailwind `lg` breakpoint (1024px):
 *  - `lg+`  : three-column tablet layout — PitchRail (260px) left,
 *             DefensiveDiamond center, OpposingBatter + spray rail right.
 *  - `<lg`  : status bar + diamond + bottom PitchRail dock; the right rail
 *             collapses into SidebarSheet (opened via the batter icon in
 *             the status bar, which `lg:hidden`s out on desktop).
 *
 * PitchRail is rendered twice in the markup (rail + dock variants) gated by
 * `hidden lg:flex` / `lg:hidden`. Each instance keeps its own mode state
 * (showOutcomesManually / moreOpen), which is fine because only one is
 * visible at a time — viewport doesn't typically change mid-game.
 */
export function LiveScoring({
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
}: LiveScoringProps) {
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
    pendingChain,
    commitChain,
    popChainStep,
    cancelChain,
    canCommitChain,
    chainOuts,
    chainOutsRequired,
    submitMidPA,
    submitRunnerDrag,
    pendingRbiPrompt,
    resolveRbiPrompt,
    cancelRbiPrompt,
    pendingRunnerAttribution,
    resolveRunnerAttribution,
    cancelRunnerAttribution,
    pendingTimingPlay,
    resolveTimingPlay,
    endHalfInning,
    submitPitchingChange,
    submitMoundVisit,
    submitSubstitution,
    submitUmpireCall,
    editLastPlay,
    finalize,
    submitSuspendGame,
    submitUndo,
  } = useLiveScoring({
    gameId,
    roster,
    opposingProfileCache: opposingProfileCache.current,
    onFinalized,
  });

  const leagueRules = useLeagueRules(schoolId, seasonYearFor(gameDate));

  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [pitchChangeOpen, setPitchChangeOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [opposingLineupEditOpen, setOpposingLineupEditOpen] = useState(false);
  const [boxSheetOpen, setBoxSheetOpen] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(true);
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);

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

  // In-game spray markers for the opposing batter at the plate. Merged into
  // OpposingBatterPanel so the right rail shows one combined chart instead
  // of duplicating career + current game in adjacent cards. Memoized so
  // re-renders driven by unrelated state (count, modal toggles, etc.) don't
  // re-scan at_bats on every tap.
  const oppBatterCurrentGameMarkers = useMemo(
    () =>
      currentOpponentBatterId
        ? state.at_bats
            .filter((ab) => ab.opponent_batter_id === currentOpponentBatterId)
            .map((ab) => ({
              id: ab.event_id,
              result: ab.result,
              spray_x: ab.spray_x,
              spray_y: ab.spray_y,
              description: ab.description,
            }))
        : [],
    [currentOpponentBatterId, state.at_bats],
  );

  const hasRunners = !!(state.bases.first || state.bases.second || state.bases.third);

  const handleBalk = () => {
    const advances = balkAdvances(state.bases);
    if (advances.length === 0) return;
    void submitMidPA("balk", { advances }, "balk");
  };

  // Shared props for the two PitchRail instances (rail on lg+, dock on <lg).
  // Hoisted so both stay in sync without re-writing the prop list twice.
  const pitchRailProps = {
    balls: state.current_balls,
    strikes: state.current_strikes,
    outs: state.outs,
    hasRunners,
    submitting,
    onPitch: submitPitch,
    onOutcomePicked,
    onK3Reach: (src: Parameters<typeof submitAtBat>[2]) =>
      void submitAtBat("K_swinging", null, src),
    onIntentionalWalk: () => onOutcomePicked("IBB"),
    onBalk: handleBalk,
    canRecord: (r: Parameters<typeof canRecordResult>[0]) => canRecordResult(r, state),
    armedResult,
    setArmedResult,
    pendingChain,
    commitChain,
    popChainStep,
    cancelChain,
    canCommitChain,
    chainOuts,
    chainOutsRequired,
  };

  // Grid:
  //  lg+ : status (row 1) | 3-col main row (rail | diamond | aside) (row 2)
  //  <lg : status (row 1) | diamond (row 2) | pitch dock (row 3)
  // The rail's wrapper uses `lg:contents` so it's transparent to the grid
  // on lg+; the dock wrapper uses `lg:hidden` so it disappears on lg+.
  return (
    <div className="grid grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-rows-[auto_minmax(0,1fr)] h-[100dvh] bg-background">
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
        onOpenBatter={() => setSidebarSheetOpen(true)}
        lastPlayText={state.last_play_text}
        backHref={backHref}
        bleed={false}
        // The PitchRail rail (lg+) carries the giant count badge; the dock
        // (<lg) does not. GameStatusBar handles the responsive switch — its
        // count chip is `lg:hidden`, so the count is visible exactly once
        // per viewport. Keep this `true` so the chip renders on <lg.
        showCount
        gameId={gameId}
      />

      <div
        className={
          rightRailOpen
            ? "min-h-0 lg:grid lg:grid-cols-[260px_minmax(0,1fr)_300px]"
            : "min-h-0 lg:grid lg:grid-cols-[260px_minmax(0,1fr)]"
        }
      >
        {/* Rail variant — hidden on <lg via the wrapper; on lg+, lg:contents
            collapses the wrapper so PitchRail becomes a direct grid child
            and fills the 260px column with its h-full chrome. */}
        <div className="hidden lg:contents">
          <PitchRail layout="rail" {...pitchRailProps} />
        </div>

        <div className="relative h-full min-h-0 flex items-center justify-center overflow-hidden p-2">
          {!rightRailOpen && (
            <Button
              size="sm"
              variant="outline"
              className="hidden lg:inline-flex absolute right-2 top-2 z-10 h-8 px-2"
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
            onRunnerDrop={(from, target, runnerId) => {
              void submitRunnerDrag(from, target.base, target.verdict, runnerId);
            }}
            onRunnerAction={(base, runnerId) => setRunnerAction({ base, runnerId })}
            chain={pendingChain.length > 0 ? pendingChain : undefined}
            fillContainer
          />
        </div>

        {rightRailOpen && (
          <aside className="hidden lg:flex flex-col overflow-y-auto border-l p-3 space-y-3">
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
            <RightRailContent
              state={state}
              weAreBatting={weAreBatting}
              submitting={submitting}
              currentOppSlot={currentOppSlot}
              currentOpponentBatterId={currentOpponentBatterId}
              currentBatterIdForChip={currentBatterIdForChip}
              opposingProfileCache={opposingProfileCache.current}
              oppBatterCurrentGameMarkers={oppBatterCurrentGameMarkers}
              gameDate={gameDate}
              gameId={gameId}
              leagueRules={leagueRules}
              onConfirmIFR={() => void submitUmpireCall({ kind: "IFR" })}
              onTagUpLeftEarly={() => setEditOpen(true)}
            />
          </aside>
        )}
      </div>

      {/* PitchRail dock — phone/portrait footer; hidden on lg+ */}
      <div className="lg:hidden">
        <PitchRail layout="dock" {...pitchRailProps} />
      </div>

      {/* SidebarSheet — phone/portrait substitute for the right rail.
          Triggered via the User icon in GameStatusBar (lg:hidden). */}
      <SidebarSheet
        open={sidebarSheetOpen}
        onOpenChange={setSidebarSheetOpen}
        state={state}
        weAreBatting={weAreBatting}
        submitting={submitting}
        currentOppSlot={currentOppSlot}
        currentOpponentBatterId={currentOpponentBatterId}
        currentBatterIdForChip={currentBatterIdForChip}
        opposingProfileCache={opposingProfileCache.current}
        oppBatterCurrentGameMarkers={oppBatterCurrentGameMarkers}
        gameDate={gameDate}
        gameId={gameId}
        leagueRules={leagueRules}
        onConfirmIFR={() => void submitUmpireCall({ kind: "IFR" })}
        onTagUpLeftEarly={() => setEditOpen(true)}
      />

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
              onSuspendGame={() => { void submitSuspendGame(); setManageOpen(false); }}
              conferencesThisGame={
                state.defensive_conferences.filter(
                  (c) => c.pitcher_id === state.current_pitcher_id,
                ).length
              }
              disabled={submitting}
              outs={state.outs}
              canEdit={state.at_bats.length > 0}
              canSuspend={state.status === "in_progress"}
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
      <TimingPlayDialog
        pending={pendingTimingPlay ? { runnerLabel: pendingTimingPlay.runnerLabel } : null}
        disabled={submitting}
        onResolve={(counted) => void resolveTimingPlay(counted)}
      />
      <RunnerAdvanceAttributionDialog
        pending={pendingRunnerAttribution}
        disabled={submitting}
        onResolve={(choice, fielderPosition) =>
          void resolveRunnerAttribution(choice, fielderPosition)
        }
        onCancel={cancelRunnerAttribution}
      />
      <RbiOnLastPlayDialog
        pending={pendingRbiPrompt}
        runnerLabel={(() => {
          if (!pendingRbiPrompt) return null;
          const id = pendingRbiPrompt.runnerId;
          if (!id) return null;
          if (weAreBatting) {
            const full = names.get(id);
            if (!full) return null;
            const m = full.match(/^#\S+\s+(.*)$/);
            return m ? m[1] : full;
          }
          const slot = state.opposing_lineup.find((s) => s.opponent_player_id === id);
          if (!slot) return null;
          return slot.last_name ?? (slot.jersey_number ? `#${slot.jersey_number}` : null);
        })()}
        onResolve={(b) => void resolveRbiPrompt(b)}
        onCancel={cancelRbiPrompt}
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
