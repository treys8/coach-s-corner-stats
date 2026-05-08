"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatLabel } from "@/components/StatTooltip";
import { formatStat } from "@/lib/csvParser";
import type { Section } from "@/lib/snapshots";
import type { PlayerSeasonAgg } from "@/lib/career";

export const TOP_N = 5;
export const MIN_AB = 50;
export const MIN_IP = 20;
export const MIN_TC = 20;

export interface BoardConfig {
  stat: string;
  /** Human label override; defaults to stat with StatLabel tooltip. */
  label?: string;
  /** Sort order: desc = high to low (default), asc = low to high. */
  dir?: "desc" | "asc";
  /** Qualifier: row's counter must be ≥ min for this stat to count. */
  qualifier?: { stat: string; min: number; note: string };
}

export const BOARDS: Record<Section, BoardConfig[]> = {
  batting: [
    { stat: "AVG", qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` } },
    { stat: "OPS", qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` } },
    { stat: "OBP", qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` } },
    { stat: "HR" },
    { stat: "RBI" },
    { stat: "H" },
    { stat: "SB" },
  ],
  pitching: [
    { stat: "ERA", dir: "asc", qualifier: { stat: "IP", min: MIN_IP, note: `Min ${MIN_IP} IP` } },
    { stat: "WHIP", dir: "asc", qualifier: { stat: "IP", min: MIN_IP, note: `Min ${MIN_IP} IP` } },
    { stat: "SO" },
    { stat: "W" },
    { stat: "IP" },
    { stat: "SV" },
  ],
  fielding: [
    { stat: "FPCT", qualifier: { stat: "TC", min: MIN_TC, note: `Min ${MIN_TC} TC` } },
    { stat: "TC" },
    { stat: "A" },
    { stat: "PO" },
    { stat: "E", dir: "asc", label: "Fewest E" },
  ],
};

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
  const dir = cfg.dir ?? "desc";
  const filtered = rows.filter((r) => {
    const v = r.agg[cfg.stat];
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
    if (cfg.qualifier) {
      const q = r.agg[cfg.qualifier.stat];
      if (typeof q !== "number" || q < cfg.qualifier.min) return false;
    }
    return true;
  });
  filtered.sort((a, b) =>
    dir === "desc" ? b.agg[cfg.stat] - a.agg[cfg.stat] : a.agg[cfg.stat] - b.agg[cfg.stat],
  );
  const top = filtered.slice(0, TOP_N);

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
                  <span className="hidden sm:inline text-[11px] uppercase tracking-wider text-muted-foreground truncate max-w-[120px]">
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
