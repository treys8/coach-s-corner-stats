"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatLabel } from "@/components/StatTooltip";
import { formatStat } from "@/lib/csvParser";
import { parseSnapshotStats, type Section, type SnapshotStats } from "@/lib/snapshots";
import { aggregatePlayerSeasons, type PlayerSeasonAgg } from "@/lib/career";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";

interface RawSnapshot {
  player_id: string;
  upload_date: string;
  season_year: number;
  stats: SnapshotStats;
}

interface PlayerInfo {
  id: string;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
  /** Latest season in which the player held this jersey number. */
  season_year: number;
}

const supabase = createClient();

const TOP_N = 5;
const MIN_AB = 50;
const MIN_IP = 20;
const MIN_TC = 20;

interface BoardConfig {
  stat: string;
  /** Human label override; defaults to stat with StatLabel tooltip. */
  label?: string;
  /** Sort order: desc = high to low (default), asc = low to high. */
  dir?: "desc" | "asc";
  /** Counter qualifier: row's `qualifier` value must be ≥ min. */
  qualifier?: { stat: string; min: number; note: string };
}

const BOARDS: Record<Section, BoardConfig[]> = {
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

export default function RecordsPage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const [snapshots, setSnapshots] = useState<RawSnapshot[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [{ data: snaps, error: sErr }, { data: entries, error: pErr }] = await Promise.all([
        supabase
          .from("stat_snapshots")
          .select("player_id, upload_date, season_year, stats")
          .eq("team_id", team.id)
          .order("upload_date", { ascending: true }),
        supabase
          .from("roster_entries")
          .select("player_id, jersey_number, season_year, players(id, first_name, last_name)")
          .eq("team_id", team.id),
      ]);
      if (!active) return;
      if (sErr) toast.error(`Couldn't load snapshots: ${sErr.message}`);
      if (pErr) toast.error(`Couldn't load players: ${pErr.message}`);

      setSnapshots(
        ((snaps ?? []) as RawSnapshot[]).map((s) => ({
          player_id: s.player_id,
          upload_date: s.upload_date,
          season_year: s.season_year,
          stats: parseSnapshotStats(s.stats),
        })),
      );

      const pmap: Record<string, PlayerInfo> = {};
      ((entries ?? []) as unknown as Array<{
        player_id: string;
        jersey_number: string | null;
        season_year: number;
        players: { id: string; first_name: string; last_name: string } | null;
      }>).forEach((e) => {
        if (!e.players) return;
        const existing = pmap[e.player_id];
        if (!existing || e.season_year > existing.season_year) {
          pmap[e.player_id] = {
            id: e.players.id,
            first_name: e.players.first_name,
            last_name: e.players.last_name,
            jersey_number: e.jersey_number,
            season_year: e.season_year,
          };
        }
      });
      setPlayers(pmap);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [team.id]);

  const aggBySection = useMemo(() => {
    const out: Record<Section, PlayerSeasonAgg[]> = {
      batting: aggregatePlayerSeasons(snapshots, "batting"),
      pitching: aggregatePlayerSeasons(snapshots, "pitching"),
      fielding: aggregatePlayerSeasons(snapshots, "fielding"),
    };
    return out;
  }, [snapshots]);

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-10">
        <Skeleton className="h-32 mb-6" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-10">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Team</p>
        <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep">Season Records</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Top single-season performances, all-time. Each row is one player&apos;s line in
          one season; rate stats are recomputed from that season&apos;s counters.
        </p>
      </div>

      <Tabs defaultValue="batting" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="batting">Batting</TabsTrigger>
          <TabsTrigger value="pitching">Pitching</TabsTrigger>
          <TabsTrigger value="fielding">Fielding</TabsTrigger>
        </TabsList>

        {(["batting", "pitching", "fielding"] as Section[]).map((sec) => (
          <TabsContent key={sec} value={sec} className="space-y-4 mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {BOARDS[sec].map((cfg) => (
                <Leaderboard
                  key={cfg.stat}
                  cfg={cfg}
                  rows={aggBySection[sec]}
                  players={players}
                  schoolSlug={school.slug}
                  teamSlug={team.slug}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Leaderboard({
  cfg,
  rows,
  players,
  schoolSlug,
  teamSlug,
}: {
  cfg: BoardConfig;
  rows: PlayerSeasonAgg[];
  players: Record<string, PlayerInfo>;
  schoolSlug: string;
  teamSlug: string;
}) {
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
            return (
              <Link
                key={`${row.player_id}-${row.season_year}`}
                href={p ? `/s/${schoolSlug}/${teamSlug}/player/${p.id}` : "#"}
                className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/60 transition-colors ${isTop ? "bg-sa-orange/5" : ""}`}
              >
                <span className={`font-mono-stat text-xs w-5 text-center font-bold ${isTop ? "text-sa-orange" : "text-muted-foreground"}`}>
                  {i + 1}
                </span>
                <span className="font-mono-stat text-xs text-sa-blue w-12">{row.season_year}</span>
                <span className="font-mono-stat text-xs text-muted-foreground w-8">#{p?.jersey_number ?? "—"}</span>
                <span className="flex-1 text-sm font-medium text-sa-blue-deep truncate">{name}</span>
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
