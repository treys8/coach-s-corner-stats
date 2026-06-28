"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatLabel } from "@/components/StatTooltip";
import { formatStat } from "@/lib/csvParser";
import type { PlayerSeasonAgg } from "@/lib/career";
import {
  BOARDS,
  MIN_AB,
  MIN_IP,
  MIN_TC,
  TOP_N,
  rankLeaderboard,
  type BoardConfig,
} from "@/lib/stats/leaderboard";

export { BOARDS, MIN_AB, MIN_IP, MIN_TC, TOP_N };
export type { BoardConfig };

export interface PlayerInfo {
  id: string;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
}

export interface LeaderboardProps {
  cfg: BoardConfig;
  rows: PlayerSeasonAgg[];
  players: Record<string, PlayerInfo>;
  schoolSlug: string;
  /** Returns the team slug to use for the row's player-detail link, or null if unknown. */
  teamSlugFor: (row: PlayerSeasonAgg) => string | null;
  /** Optional team label shown alongside year + jersey (school-wide view uses this). */
  teamLabelFor?: (row: PlayerSeasonAgg) => string | null;
}

export function Leaderboard({
  cfg,
  rows,
  players,
  schoolSlug,
  teamSlugFor,
  teamLabelFor,
}: LeaderboardProps) {
  const top = useMemo(
    () => rankLeaderboard(rows, cfg).slice(0, TOP_N),
    [rows, cfg],
  );

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="font-display text-xl text-sa-blue-deep">
          {cfg.label ?? <StatLabel abbr={cfg.stat} />}
        </h3>
        {cfg.qualifier && (
          <span className="text-[10px] uppercase tracking-wider text-sa-orange font-semibold">
            {cfg.qualifier.note}
          </span>
        )}
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No qualifying performances yet.
        </p>
      ) : (
        <div className="divide-y divide-border border border-border rounded-md overflow-hidden">
          {top.map((row, i) => {
            const p = players[row.player_id];
            const name = p ? `${p.first_name} ${p.last_name}` : "Unknown";
            const isTop = i === 0;
            const teamSlug = teamSlugFor(row);
            const href = p && teamSlug ? `/s/${schoolSlug}/${teamSlug}/player/${p.id}` : "#";
            const teamLabel = teamLabelFor?.(row) ?? null;
            return (
              <Link
                key={`${row.player_id}-${row.season_year}`}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/60 transition-colors ${isTop ? "bg-sa-orange/5" : ""}`}
              >
                <span className={`font-mono-stat text-xs w-5 text-center font-bold ${isTop ? "text-sa-orange" : "text-muted-foreground"}`}>
                  {i + 1}
                </span>
                <span className="font-mono-stat text-xs text-sa-blue w-12">{row.season_year}</span>
                <span className="font-mono-stat text-xs text-muted-foreground w-8">#{p?.jersey_number ?? "—"}</span>
                <span className="flex-1 min-w-0 text-sm font-medium text-sa-blue-deep truncate">{name}</span>
                {teamLabel && (
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground truncate max-w-[88px] sm:max-w-[120px]">
                    {teamLabel}
                  </span>
                )}
                <span className="font-mono-stat text-base font-bold text-sa-blue-deep">
                  {formatStat(row.agg[cfg.stat])}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
