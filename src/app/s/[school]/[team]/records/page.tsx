"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseSnapshotStats, type Section, type SnapshotStats } from "@/lib/snapshots";
import { aggregatePlayerSeasons, type PlayerSeasonAgg } from "@/lib/career";
import { BOARDS, Leaderboard } from "@/components/records/Leaderboard";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";
import { seasonLabel } from "@/lib/season";

interface TeamRecordRow {
  season_year: number;
  wins: number;
  losses: number;
  ties: number;
  games_played: number;
}

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

export default function RecordsPage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const [snapshots, setSnapshots] = useState<RawSnapshot[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [teamRecords, setTeamRecords] = useState<TeamRecordRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [{ data: snaps, error: sErr }, { data: entries, error: pErr }, { data: recRows, error: recErr }] = await Promise.all([
        supabase
          .from("stat_snapshots")
          .select("player_id, upload_date, season_year, stats")
          .eq("team_id", team.id)
          .order("upload_date", { ascending: true }),
        supabase
          .from("roster_entries")
          .select("player_id, jersey_number, season_year, players(id, first_name, last_name)")
          .eq("team_id", team.id),
        (supabase as any)
          .from("team_season_records")
          .select("season_year, wins, losses, ties, games_played")
          .eq("team_id", team.id)
          .order("season_year", { ascending: false }),
      ]);
      if (!active) return;
      if (sErr) toast.error(`Couldn't load snapshots: ${sErr.message}`);
      if (pErr) toast.error(`Couldn't load players: ${pErr.message}`);
      if (recErr) toast.error(`Couldn't load team records: ${recErr.message}`);
      setTeamRecords(((recRows ?? []) as TeamRecordRow[]));

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

      {teamRecords.length > 0 && (
        <div className="mb-8">
          <h3 className="font-display text-xl text-sa-blue uppercase tracking-wider mb-3">
            Team Record by Season
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {teamRecords.map((r) => {
              const label = r.ties > 0
                ? `${r.wins}-${r.losses}-${r.ties}`
                : `${r.wins}-${r.losses}`;
              return (
                <Card key={r.season_year} className="p-4 flex flex-col gap-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {seasonLabel(r.season_year)}
                  </p>
                  <p className="font-display font-mono-stat text-3xl text-sa-orange leading-none">
                    {label}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {r.games_played} game{r.games_played === 1 ? "" : "s"}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

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
                  teamSlugFor={() => team.slug}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
