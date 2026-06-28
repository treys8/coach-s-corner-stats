"use client";

import Link from "next/link";
import { ChevronLeft, ClipboardList, MoreVertical, Undo2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReplayState } from "@/lib/scoring/types";
import { MiniBases } from "./MiniBases";
import { OfflinePill } from "./OfflinePill";

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
  /** When false, the B-S count is hidden from the StateChip. v2 shell sets
   *  this so the large count badge in the PitchRail is the only count
   *  display. Defaults to true for back-compat. */
  showCount?: boolean;
  /** Phase 5: when present, renders the offline/sync pill next to the
   *  manage button. Hidden when omitted so the legacy draft / final shells
   *  don't grow a no-op control. */
  gameId?: string;
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
  showCount = true,
  gameId,
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
    ? "sticky top-0 z-20 -mx-6 px-6 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b shadow-e2"
    : "px-3 sm:px-4 pb-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b shadow-e2";

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
          className="shrink-0 h-11 w-11"
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
          showCount={showCount}
        />

        <MiniBases bases={state.bases} className="shrink-0" />

        {onOpenBox && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Box score"
            onClick={onOpenBox}
            className="shrink-0 h-11 w-11"
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
            className="shrink-0 lg:hidden h-11 w-11"
          >
            <User className="h-5 w-5" />
          </Button>
        )}

        {gameId && <OfflinePill gameId={gameId} />}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Manage game"
          onClick={onOpenManage}
          className="shrink-0 h-11 w-11"
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
  const teamLeading = teamScore > opponentScore;
  const oppLeading = opponentScore > teamScore;
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-eyebrow truncate max-w-[8ch]">{teamShortLabel}</span>
      <span className={`text-stat-xl text-3xl md:text-4xl ${teamLeading ? "text-sa-orange" : "text-sa-blue-deep"}`}>
        {teamScore}
      </span>
      <span className="text-muted-foreground">–</span>
      <span className={`text-stat-xl text-3xl md:text-4xl ${oppLeading ? "text-sa-orange" : "text-sa-blue-deep"}`}>
        {opponentScore}
      </span>
      <span className="text-eyebrow truncate max-w-[12ch]">{opponentName}</span>
    </div>
  );
}

function StateChip({
  halfLabel,
  inning,
  outs,
  balls,
  strikes,
  showCount,
}: {
  halfLabel: string;
  inning: number;
  outs: number;
  balls: number;
  strikes: number;
  showCount: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm shrink-0">
      <span className="font-bold text-sa-blue uppercase tracking-wider whitespace-nowrap">
        {halfLabel} {inning}
      </span>
      <OutsDots outs={outs} />
      {showCount && (
        // Hidden on lg+ — the PitchRail rail carries the giant standalone
        // count badge there, so this chip would be a redundant second copy.
        // On <lg this chip is the only count surface (dock has no badge).
        <span
          className={`lg:hidden font-mono-stat text-base md:text-lg whitespace-nowrap ${
            balls === 3 && strikes === 2 ? "text-sa-orange font-bold" : "text-sa-blue-deep"
          }`}
        >
          {balls}-{strikes}
        </span>
      )}
    </div>
  );
}

function OutsDots({ outs }: { outs: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`${outs} out${outs === 1 ? "" : "s"}`}>
      {[0, 1, 2].map((i) => {
        const filled = i < outs;
        return (
          <span
            key={i}
            className={
              filled
                ? `w-2.5 h-2.5 rounded-full bg-sa-orange shadow-[0_0_0_2px_hsl(var(--sa-orange)/0.25)]${outs === 2 ? " animate-glow-pulse" : ""}`
                : "w-2.5 h-2.5 rounded-full border-2 border-sa-blue-deep/30"
            }
          />
        );
      })}
    </span>
  );
}
