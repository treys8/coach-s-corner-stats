"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { StatLabel } from "@/components/StatTooltip";
import { formatStat } from "@/lib/csvParser";
import { KEY_BATTING, KEY_PITCHING, KEY_FIELDING } from "@/lib/glossary";
import { parseSnapshotStats, sectionOf, type Section, type SnapshotStats } from "@/lib/snapshots";
import { aggregateCareer } from "@/lib/career";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";
import { PlayerSprayChart, type SprayMarker } from "@/components/spray/PlayerSprayChart";

interface Player { id: string; first_name: string; last_name: string }
interface Snapshot { upload_date: string; stats: SnapshotStats; season_year: number }

const TREND: Record<Section, string[]> = {
  batting: ["AVG", "OBP", "SLG", "OPS", "H", "HR", "RBI"],
  pitching: ["ERA", "WHIP", "SO", "BB", "IP"],
  fielding: ["FPCT", "TC", "E"],
};

const supabase = createClient();

export default function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { school } = useSchool();
  const { team } = useTeam();
  const [player, setPlayer] = useState<Player | null>(null);
  const [jersey, setJersey] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [sprayMarkers, setSprayMarkers] = useState<SprayMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState({ batting: false, pitching: false, fielding: false });

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const [
        { data: pl, error: pErr },
        { data: snaps, error: sErr },
        { data: roster },
        { data: abs, error: abErr },
      ] = await Promise.all([
        supabase.from("players").select("id, first_name, last_name").eq("id", id).maybeSingle(),
        supabase
          .from("stat_snapshots")
          .select("upload_date, stats, season_year")
          .eq("team_id", team.id)
          .eq("player_id", id)
          .order("upload_date", { ascending: true }),
        supabase
          .from("roster_entries")
          .select("jersey_number, season_year")
          .eq("team_id", team.id)
          .eq("player_id", id)
          .order("season_year", { ascending: false })
          .limit(1),
        supabase
          .from("at_bats")
          .select("event_id, result, spray_x, spray_y, description")
          .eq("batter_id", id)
          .not("spray_x", "is", null),
      ]);
      if (pErr) toast.error(`Couldn't load player: ${pErr.message}`);
      if (sErr) toast.error(`Couldn't load snapshots: ${sErr.message}`);
      if (abErr) toast.error(`Couldn't load batted-ball data: ${abErr.message}`);
      setPlayer((pl as Player | null) ?? null);
      setJersey(roster?.[0]?.jersey_number ?? null);
      setSnapshots(
        (snaps ?? []).map((s) => ({
          upload_date: s.upload_date as string,
          stats: parseSnapshotStats(s.stats),
          season_year: (s.season_year as number | null) ?? new Date(s.upload_date as string).getFullYear(),
        })),
      );
      setSprayMarkers(
        (abs ?? []).map((r) => ({
          id: r.event_id as string,
          result: r.result as string,
          spray_x: (r.spray_x as number | null) ?? null,
          spray_y: (r.spray_y as number | null) ?? null,
          description: (r.description as string | null) ?? null,
        })),
      );
      setLoading(false);
    };
    load();
  }, [id, team.id]);

  const latestSnap = snapshots[snapshots.length - 1];
  const backHref = `/s/${school.slug}/${team.slug}`;

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-10">
        <Skeleton className="h-32 mb-6" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!player) {
    return (
      <div className="container mx-auto px-6 py-10 text-center">
        <p className="text-muted-foreground">Player not found.</p>
        <Link href={backHref} className="text-sa-orange underline">Back to roster</Link>
      </div>
    );
  }

  const renderStatGrid = (
    section: Section,
    keyStats: string[],
    block: Record<string, number | string>,
    emptyHint: string,
  ) => {
    const allKeys = Object.keys(block);
    if (allKeys.length === 0) {
      return <p className="text-sm text-muted-foreground italic">{emptyHint}</p>;
    }
    const expanded = showAll[section];
    const visible = expanded ? allKeys : keyStats.filter((k) => k in block);
    return (
      <>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1.5">
          {visible.map((k) => (
            <div
              key={k}
              className="group relative bg-muted/30 hover:bg-muted/60 rounded-md px-2 py-1.5 border border-border/70 transition-colors flex items-baseline justify-between gap-2"
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
                <StatLabel abbr={k} />
              </div>
              <div className="font-mono-stat text-sm font-bold text-sa-blue-deep leading-none">
                {formatStat(block[k])}
              </div>
            </div>
          ))}
        </div>
        {allKeys.length > visible.length || expanded ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-4 text-sa-blue hover:text-sa-orange"
            onClick={() => setShowAll((s) => ({ ...s, [section]: !s[section] }))}
          >
            {expanded ? (
              <><ChevronUp className="w-4 h-4 mr-1" /> Show key stats</>
            ) : (
              <><ChevronDown className="w-4 h-4 mr-1" /> Show all {allKeys.length} stats</>
            )}
          </Button>
        ) : null}
      </>
    );
  };

  const renderTrend = (section: Section) => {
    if (snapshots.length < 2) {
      return <p className="text-sm text-muted-foreground italic">Trends will appear after the second weekly upload.</p>;
    }
    const keys = TREND[section];
    const data = snapshots.map((s) => {
      const block = sectionOf(s.stats, section);
      const row: Record<string, string | number> = {
        date: new Date(s.upload_date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      };
      keys.forEach((k) => {
        const v = block[k];
        row[k] = typeof v === "number" ? v : Number(v) || 0;
      });
      return row;
    });
    const colors = ["#FF4A00", "#0021A5", "#A7A8AA", "#FF7A3D", "#001f6b", "#5d6066", "#ff9a6d"];
    return (
      <div className="h-72 w-full bg-card border border-border rounded-lg p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <RTooltip contentStyle={{ background: "hsl(var(--sa-blue-deep))", border: "1px solid hsl(var(--sa-orange))", color: "white", fontSize: 12 }} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-6 py-10">
      <Link href={backHref} className="inline-flex items-center text-sm text-muted-foreground hover:text-sa-orange mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to roster
      </Link>

      <div className="bg-gradient-blue text-white rounded-lg p-8 mb-8 shadow-elevated relative overflow-hidden">
        <div className="absolute -right-8 -bottom-12 font-display text-[14rem] leading-none text-sa-orange/20 select-none font-mono-stat">
          {jersey || "—"}
        </div>
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold mb-1">#{jersey ?? "—"}</p>
          <h2 className="font-display text-6xl md:text-7xl">{player.first_name} {player.last_name}</h2>
          <p className="text-white/70 mt-2 text-sm">
            {snapshots.length} weekly snapshot{snapshots.length === 1 ? "" : "s"} · latest{" "}
            {latestSnap ? new Date(latestSnap.upload_date).toLocaleDateString() : "—"}
          </p>
        </div>
      </div>

      <Tabs defaultValue="batting" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="batting">Batting</TabsTrigger>
          <TabsTrigger value="pitching">Pitching</TabsTrigger>
          <TabsTrigger value="fielding">Fielding</TabsTrigger>
        </TabsList>

        {(["batting", "pitching", "fielding"] as Section[]).map((sec) => {
          const keyStats = sec === "batting" ? KEY_BATTING : sec === "pitching" ? KEY_PITCHING : KEY_FIELDING;
          const career = aggregateCareer(snapshots, sec);
          const seasonsCount = new Set(snapshots.map((s) => s.season_year)).size;
          const latest = sectionOf(latestSnap?.stats, sec);
          return (
            <TabsContent key={sec} value={sec} className="space-y-6 mt-6">
              <Card className="p-6">
                <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
                  <h3 className="font-display text-2xl text-sa-blue-deep capitalize">{sec} Career</h3>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {seasonsCount} season{seasonsCount === 1 ? "" : "s"} · {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"}
                  </p>
                </div>
                {renderStatGrid(sec, keyStats, career, `No ${sec} career data yet — uploads or tablet-finalized games will populate this.`)}
              </Card>
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4">Latest snapshot</h3>
                {renderStatGrid(sec, keyStats, latest, `No ${sec} stats yet — upload a workbook to populate.`)}
              </Card>
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4">Trends Over Time</h3>
                {renderTrend(sec)}
              </Card>
              {sec === "batting" && (
                <Card className="p-6">
                  <h3 className="font-display text-2xl text-sa-blue-deep mb-4">Spray Chart</h3>
                  <PlayerSprayChart markers={sprayMarkers} />
                </Card>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
