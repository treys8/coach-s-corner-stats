"use client";

import Link from "next/link";
import { ChevronLeft, ClipboardList, MoreVertical, Undo2, User } from "lucide-react";
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
  /** Optional back-link rendered as a chevron at the far left. Used by the
   *  full-viewport in-progress shell that hides the page-level GameHeader. */
  backHref?: string;
  /** Opens the line-score sheet. When omitted, the trigger is hidden. */
  onOpenBox?: () => void;
  /** Opens the side panel (opposing batter + spray) on `<lg` widths. When
   *  omitted, the trigger is hidden (e.g. on `lg+` where the panel is inline). */
  onOpenBatter?: () => void;
  /** When false, the bar renders without the `-mx-6 px-6` overhang used by
   *  the legacy container-shell layout. Defaults to true for back-compat. */
  bleed?: boolean;
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
  backHref,
  onOpenBox,
  onOpenBatter,
  bleed = true,
}: GameStatusBarProps) {
  const halfLabel = state.half === "top" ? "Top" : "Bot";
  const batterLine = weAreBatting
    ? currentBatterName
      ? `At bat: ${currentBatterName}`
      : "(empty slot)"
    : pitcherName
      ? `Pitching: ${pitcherName}`
      : "(no pitcher)";

  const containerCls = bleed
    ? "sticky top-0 z-20 -mx-6 px-6 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b"
    : "px-3 sm:px-4 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b";

  return (
    <div className={containerCls}>
      <div className="flex items-center gap-2 md:gap-3 flex-wrap md:flex-nowrap">
        {backHref && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Back to score picker"
            className="shrink-0"
          >
            <Link href={backHref}>
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
        )}
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

        {onOpenBox && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Box score"
            onClick={onOpenBox}
            className="shrink-0"
          >
            <ClipboardList className="h-5 w-5" />
          </Button>
        )}
        {onOpenBatter && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Batter detail"
            onClick={onOpenBatter}
            className="shrink-0 lg:hidden"
          >
            <User className="h-5 w-5" />
          </Button>
        )}

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
        <span className="truncate">{batterLine}</span>
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
