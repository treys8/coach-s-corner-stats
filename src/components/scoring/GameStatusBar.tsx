"use client";

import { MoreVertical, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReplayState } from "@/lib/scoring/types";
import { MiniBases } from "./MiniBases";

interface GameStatusBarProps {
  state: ReplayState;
  weAreBatting: boolean;
  teamShortLabel: string;
  opponentName: string;
  currentBatterName: string | null;
  pitcherName: string | null;
  canUndo: boolean;
  onUndo: () => void;
  onOpenManage: () => void;
  lastPlayText: string | null;
  /** Network status of the most recent event submission. `submitting` is
   *  true while any post is in-flight; `retrying` is true only when the
   *  current attempt is in a backoff window after a transient failure. */
  submitting?: boolean;
  retrying?: boolean;
}

export function GameStatusBar({
  state,
  weAreBatting,
  teamShortLabel,
  opponentName,
  currentBatterName,
  pitcherName,
  canUndo,
  onUndo,
  onOpenManage,
  lastPlayText,
  submitting,
  retrying,
}: GameStatusBarProps) {
  const halfLabel = state.half === "top" ? "Top" : "Bot";
  const batterLine = weAreBatting
    ? currentBatterName
      ? `At bat: ${currentBatterName}`
      : "(empty slot)"
    : pitcherName
      ? `Pitching: ${pitcherName}`
      : "(no pitcher)";

  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
      <div className="flex items-center gap-3 flex-wrap md:flex-nowrap">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Undo last play"
          disabled={!canUndo}
          onClick={onUndo}
          className="shrink-0"
        >
          <Undo2 className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ScoreLine
            teamShortLabel={teamShortLabel}
            opponentName={opponentName}
            teamScore={state.team_score}
            opponentScore={state.opponent_score}
          />
        </div>

        <StateChip
          halfLabel={halfLabel}
          inning={state.inning}
          outs={state.outs}
          balls={state.current_balls}
          strikes={state.current_strikes}
        />

        <MiniBases bases={state.bases} className="shrink-0" />

        <Button
          variant="ghost"
          size="icon"
          aria-label="Manage game"
          onClick={onOpenManage}
          className="shrink-0"
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">{batterLine}</span>
          <SaveStatus submitting={!!submitting} retrying={!!retrying} />
        </span>
        {lastPlayText && (
          <span className="truncate text-right">
            <span className="uppercase tracking-wider">Last: </span>
            {lastPlayText}
          </span>
        )}
      </div>
    </div>
  );
}

function SaveStatus({ submitting, retrying }: { submitting: boolean; retrying: boolean }) {
  if (!submitting && !retrying) return null;
  // Retrying takes precedence over the generic submitting label so the
  // coach knows a save is being re-attempted, not just slow.
  const label = retrying ? "Retrying…" : "Saving…";
  const dotClass = retrying ? "bg-amber-500" : "bg-sa-blue-deep/60";
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 text-[11px] uppercase tracking-wider"
      role="status"
      aria-live="polite"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass} animate-pulse`} />
      {label}
    </span>
  );
}

function ScoreLine({
  teamShortLabel,
  opponentName,
  teamScore,
  opponentScore,
}: {
  teamShortLabel: string;
  opponentName: string;
  teamScore: number;
  opponentScore: number;
}) {
  return (
    <div className="font-mono-stat flex items-baseline gap-2 min-w-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground truncate max-w-[8ch]">
        {teamShortLabel}
      </span>
      <span className="text-2xl md:text-3xl text-sa-blue-deep font-bold">
        {teamScore}
      </span>
      <span className="text-muted-foreground">–</span>
      <span className="text-2xl md:text-3xl text-sa-blue-deep font-bold">
        {opponentScore}
      </span>
      <span className="text-xs uppercase tracking-wider text-muted-foreground truncate max-w-[12ch]">
        {opponentName}
      </span>
    </div>
  );
}

function StateChip({
  halfLabel,
  inning,
  outs,
  balls,
  strikes,
}: {
  halfLabel: string;
  inning: number;
  outs: number;
  balls: number;
  strikes: number;
}) {
  return (
    <div className="flex items-center gap-2 text-sm shrink-0">
      <span className="font-semibold text-sa-blue uppercase tracking-wider whitespace-nowrap">
        {halfLabel} {inning}
      </span>
      <OutsDots outs={outs} />
      <span className="font-mono-stat text-base md:text-lg text-sa-blue-deep whitespace-nowrap">
        {balls}-{strikes}
      </span>
    </div>
  );
}

function OutsDots({ outs }: { outs: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${outs} out${outs === 1 ? "" : "s"}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={
            i < outs
              ? "w-2 h-2 rounded-full bg-sa-blue-deep"
              : "w-2 h-2 rounded-full border border-sa-blue-deep/40"
          }
        />
      ))}
    </span>
  );
}
