"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseSnapshotStats, type Section, type SnapshotStats } from "@/lib/snapshots";
import { aggregatePlayerSeasons, type PlayerSeasonAgg } from "@/lib/career";
import { BOARDS, Leaderboard } from "@/components/records/Leaderboard";
import { useSchool } from "@/lib/contexts/school";

interface TeamRow {
  id: string;
  slug: string;
  name: string;
}

interface RawSnapshot {
  player_id: string;
  team_id: string;
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
  /** Last team the player was on (used for the player-detail link). */
  team_slug: string | null;
}

const supabase = createClient();

export default function SchoolRecordsPage() {
  const { school } = useSchool();
  const [snapshots, setSnapshots] = useState<RawSnapshot[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [teamsById, setTeamsById] = useState<Record<string, TeamRow>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const teamsRes = await supabase
        .from("teams")
        .select("id, slug, name")
        .eq("school_id", school.id);
      if (!active) return;
      if (teamsRes.error) {
        toast.error(`Couldn't load teams: ${teamsRes.error.message}`);
        setLoading(false);
        return;
      }
      const teamRows = (teamsRes.data ?? []) as TeamRow[];
      const teamMap: Record<string, TeamRow> = {};
      teamRows.forEach((t) => { teamMap[t.id] = t; });
      setTeamsById(teamMap);

      if (teamRows.length === 0) {
        setSnapshots([]);
        setPlayers({});
        setLoading(false);
        return;
      }

      const teamIds = teamRows.map((t) => t.id);
      const [{ data: snaps, error: sErr }, { data: entries, error: eErr }] = await Promise.all([
        supabase
          .from("stat_snapshots")
          .select("player_id, team_id, upload_date, season_year, stats")
          .in("team_id", teamIds)
          .order("upload_date", { ascending: true }),
        supabase
          .from("roster_entries")
          .select("player_id, team_id, jersey_number, season_year, players(id, first_name, last_name)")
          .in("team_id", teamIds),
      ]);
      if (!active) return;
      if (sErr) toast.error(`Couldn't load snapshots: ${sErr.message}`);
      if (eErr) toast.error(`Couldn't load players: ${eErr.message}`);

      setSnapshots(
        ((snaps ?? []) as RawSnapshot[]).map((s) => ({
          player_id: s.player_id,
          team_id: s.team_id,
          upload_date: s.upload_date,
          season_year: s.season_year,
          stats: parseSnapshotStats(s.stats),
        })),
      );

      const pmap: Record<string, PlayerInfo> = {};
      ((entries ?? []) as unknown as Array<{
        player_id: string;
        team_id: string;
        jersey_number: string | null;
        season_year: number;
        players: { id: string; first_name: string; last_name: string } | null;
      }>).forEach((e) => {
        if (!e.players) return;
        const existing = pmap[e.player_id];
        // Track the most recent season's jersey + team for the player-link.
        if (!existing || e.season_year > existing.season_year) {
          pmap[e.player_id] = {
            id: e.players.id,
            first_name: e.players.first_name,
            last_name: e.players.last_name,
            jersey_number: e.jersey_number,
            season_year: e.season_year,
            team_slug: teamMap[e.team_id]?.slug ?? null,
          };
        }
      });
      setPlayers(pmap);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [school.id]);

  // (player_id, season_year) → team_id of any snapshot in that bucket. Used
  // to render the team label per leaderboard row.
  const teamIdForBucket = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of snapshots) {
      const key = `${s.player_id}|${s.season_year}`;
      if (!m.has(key)) m.set(key, s.team_id);
    }
    return m;
  }, [snapshots]);

  const aggBySection = useMemo(() => {
    const out: Record<Section, PlayerSeasonAgg[]> = {
      batting: aggregatePlayerSeasons(snapshots, "batting"),
      pitching: aggregatePlayerSeasons(snapshots, "pitching"),
      fielding: aggregatePlayerSeasons(snapshots, "fielding"),
    };
    return out;
  }, [snapshots]);

  const teamLabelFor = (row: PlayerSeasonAgg): string | null => {
    const tid = teamIdForBucket.get(`${row.player_id}|${row.season_year}`);
    return tid ? teamsById[tid]?.name ?? null : null;
  };

  const teamSlugFor = (row: PlayerSeasonAgg): string | null => {
    const tid = teamIdForBucket.get(`${row.player_id}|${row.season_year}`);
    if (tid && teamsById[tid]) return teamsById[tid].slug;
    return players[row.player_id]?.team_slug ?? null;
  };

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
      <Link
        href={`/s/${school.slug}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-sa-orange mb-6"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to {school.name}
      </Link>

      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">School</p>
        <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep">School Records</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Top single-season performances across every team in {school.name}. Each row
          is one player&apos;s line in one season; rate stats are recomputed from that
          season&apos;s counters.
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
                  teamSlugFor={teamSlugFor}
                  teamLabelFor={teamLabelFor}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
