"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { StatLabel } from "@/components/StatTooltip";
import { formatStat } from "@/lib/csvParser";
import { GLOSSARY } from "@/lib/glossary";
import { currentSeasonYear, isSeasonClosed, seasonLabel } from "@/lib/season";
import { parseSnapshotStats, sectionOf, type Section, type SnapshotStats } from "@/lib/snapshots";
import { aggregateByDate, RATE_STATS } from "@/lib/aggregate";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Snapshot {
  player_id: string;
  upload_date: string;
  season_year: number;
  stats: SnapshotStats;
}

const MIN_AB = 5;
const MIN_IP = 3;

const KEY_DISPLAY: Record<Section, string[]> = {
  batting: ["GP","H","HR","RBI","R","BB","SO","SB","AVG","OBP","SLG","OPS"],
  pitching: ["IP","W","L","SV","SO","BB","ERA","WHIP","BAA","K/BB","BF"],
  fielding: ["TC","PO","A","E","FPCT","DP"],
};

const supabase = createClient();

export default function TeamTotalsPage() {
  const [allSnapshots, setAllSnapshots] = useState<Snapshot[]>([]);
  const [allPlayers, setAllPlayers] = useState<Record<string, { id: string; first_name: string; last_name: string; jersey_number: string; season_year: number }>>({});
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<number>(currentSeasonYear());

  const [leaderStat, setLeaderStat] = useState<Record<Section, string>>({ batting: "AVG", pitching: "ERA", fielding: "FPCT" });
  const [leaderDir, setLeaderDir] = useState<Record<Section, "desc" | "asc">>({ batting: "desc", pitching: "asc", fielding: "desc" });

  useEffect(() => {
    const load = async () => {
      const [{ data: snaps, error: sErr }, { data: pls, error: pErr }] = await Promise.all([
        supabase.from("stat_snapshots").select("player_id, upload_date, season_year, stats").order("upload_date", { ascending: true }),
        supabase.from("players").select("id, first_name, last_name, jersey_number, season_year"),
      ]);
      if (sErr) toast.error(`Couldn't load snapshots: ${sErr.message}`);
      if (pErr) toast.error(`Couldn't load players: ${pErr.message}`);
      setAllSnapshots(
        (snaps ?? []).map((s) => ({
          player_id: s.player_id,
          upload_date: s.upload_date,
          season_year: s.season_year,
          stats: parseSnapshotStats(s.stats),
        })),
      );
      const pmap: Record<string, { id: string; first_name: string; last_name: string; jersey_number: string; season_year: number }> = {};
      (pls ?? []).forEach((p) => { pmap[p.id] = p; });
      setAllPlayers(pmap);
      setLoading(false);
    };
    load();
  }, []);

  const seasons = useMemo(() => {
    const yrs = new Set<number>([currentSeasonYear()]);
    allSnapshots.forEach((s) => yrs.add(s.season_year));
    Object.values(allPlayers).forEach((p) => yrs.add(p.season_year));
    return Array.from(yrs).sort((a, b) => b - a);
  }, [allSnapshots, allPlayers]);

  const closed = isSeasonClosed(season);
  const snapshots = useMemo(() => allSnapshots.filter((s) => s.season_year === season), [allSnapshots, season]);
  const players = useMemo(() => {
    const out: typeof allPlayers = {};
    Object.entries(allPlayers).forEach(([k, v]) => { if (v.season_year === season) out[k] = v; });
    return out;
  }, [allPlayers, season]);

  const byDate = useMemo(() => aggregateByDate(snapshots), [snapshots]);

  const latest = byDate[byDate.length - 1]?.agg;
  const latestDate = byDate[byDate.length - 1]?.date;

  const { latestByPlayer, statKeys } = useMemo(() => {
    const latestByPlayer: Record<string, Snapshot> = {};
    for (const s of snapshots) {
      const prev = latestByPlayer[s.player_id];
      if (!prev || prev.upload_date < s.upload_date) latestByPlayer[s.player_id] = s;
    }
    const statKeys: Record<Section, string[]> = { batting: [], pitching: [], fielding: [] };
    const sets: Record<Section, Set<string>> = { batting: new Set(), pitching: new Set(), fielding: new Set() };
    (["batting","pitching","fielding"] as Section[]).forEach((sec) => {
      for (const snap of Object.values(latestByPlayer)) {
        const block = sectionOf(snap.stats, sec);
        for (const [k, v] of Object.entries(block)) {
          if (typeof v === "number" && Number.isFinite(v)) sets[sec].add(k);
        }
      }
      statKeys[sec] = Array.from(sets[sec]).sort();
    });
    return { latestByPlayer, statKeys };
  }, [snapshots]);

  const buildLeaderboard = (section: Section, stat: string) => {
    const isBattingRate = section === "batting" && RATE_STATS.batting.includes(stat);
    const isPitchingRate = section === "pitching" && RATE_STATS.pitching.includes(stat);
    const rows: { player_id: string; value: number }[] = [];
    for (const [pid, snap] of Object.entries(latestByPlayer)) {
      const block = sectionOf(snap.stats, section);
      const v = block[stat];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;

      if (isBattingRate) {
        const ab = sectionOf(snap.stats, "batting")["AB"];
        if (typeof ab !== "number" || ab < MIN_AB) continue;
      }
      if (isPitchingRate) {
        const ip = sectionOf(snap.stats, "pitching")["IP"];
        if (typeof ip !== "number" || ip < MIN_IP) continue;
      }
      rows.push({ player_id: pid, value: v });
    }
    return rows;
  };

  const qualifierNote = (section: Section, stat: string): string | null => {
    if (section === "batting" && RATE_STATS.batting.includes(stat)) return `Min ${MIN_AB} AB to qualify`;
    if (section === "pitching" && RATE_STATS.pitching.includes(stat)) return `Min ${MIN_IP} IP to qualify`;
    return null;
  };

  if (loading) return <div className="container mx-auto px-6 py-10"><Skeleton className="h-96" /></div>;

  const renderTrend = (section: Section, keys: string[]) => {
    if (byDate.length < 2) {
      return <p className="text-sm text-muted-foreground italic">Trends appear after the second weekly upload.</p>;
    }
    const data = byDate.map((d) => {
      const row: Record<string, string | number> = { date: new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
      keys.forEach((k) => { row[k] = d.agg[section][k] ?? 0; });
      return row;
    });
    const colors = ["#FF4A00", "#0021A5", "#A7A8AA", "#001f6b"];
    return (
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <RTooltip contentStyle={{ background: "hsl(var(--sa-blue-deep))", border: "1px solid hsl(var(--sa-orange))", color: "white", fontSize: 12 }} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-6 py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Team</p>
          <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep">Team Totals</h2>
        </div>
        <div className="flex items-center gap-2">
          {closed && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-sa-orange bg-sa-orange/10 px-2 py-1 rounded">
              <Lock className="w-3 h-3" /> Archived
            </span>
          )}
          <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {seasons.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {seasonLabel(y)}{isSeasonClosed(y) ? " (closed)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-8">
        {byDate.length === 0
          ? `No stats uploaded for the ${season} season yet.`
          : `Aggregated across ${snapshots.filter((s) => s.upload_date === byDate[byDate.length - 1].date).length} players · latest ${new Date(byDate[byDate.length - 1].date).toLocaleDateString()}`}
      </p>

      {byDate.length === 0 ? (
        <Card className="p-12 text-center bg-sa-grey-soft border-dashed">
          <p className="text-muted-foreground">No data yet.</p>
        </Card>
      ) : (
        <Tabs defaultValue="batting" className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="batting">Batting</TabsTrigger>
            <TabsTrigger value="pitching">Pitching</TabsTrigger>
            <TabsTrigger value="fielding">Fielding</TabsTrigger>
          </TabsList>

          {(["batting","pitching","fielding"] as Section[]).map((sec) => {
            const stat = leaderStat[sec];
            const dir = leaderDir[sec];
            const available = statKeys[sec];
            const activeStat = available.includes(stat) ? stat : (available[0] ?? "");
            const board = activeStat ? buildLeaderboard(sec, activeStat) : [];
            board.sort((a, b) => dir === "desc" ? b.value - a.value : a.value - b.value);
            return (
            <TabsContent key={sec} value={sec} className="space-y-6 mt-6">
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4 capitalize">{sec} Totals</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1.5">
                  {KEY_DISPLAY[sec].map((k) => (
                    <div key={k} className="group relative bg-muted/30 hover:bg-muted/60 rounded-md px-2 py-1.5 border border-border/70 transition-colors flex items-baseline justify-between gap-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
                        <StatLabel abbr={k} />
                      </div>
                      <div className="font-mono-stat text-sm font-bold text-sa-blue-deep leading-none">
                        {formatStat(latest?.[sec]?.[k])}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="font-display text-2xl text-sa-blue-deep">Stat Leaders</h3>
                  <div className="flex items-center gap-2">
                    <Select value={activeStat} onValueChange={(v) => setLeaderStat((s) => ({ ...s, [sec]: v }))}>
                      <SelectTrigger className="w-[180px] h-9">
                        <SelectValue placeholder="Pick a stat" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {available.map((k) => (
                          <SelectItem key={k} value={k}>
                            <span className="font-mono-stat text-xs mr-2">{k}</span>
                            <span className="text-muted-foreground text-xs">{GLOSSARY[k] ?? ""}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => setLeaderDir((d) => ({ ...d, [sec]: d[sec] === "desc" ? "asc" : "desc" }))}
                    >
                      {dir === "desc" ? <ArrowDown className="w-4 h-4 mr-1" /> : <ArrowUp className="w-4 h-4 mr-1" />}
                      {dir === "desc" ? "High → Low" : "Low → High"}
                    </Button>
                  </div>
                </div>

                {board.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No data for this stat yet.</p>
                ) : (
                  <div className="divide-y divide-border border border-border rounded-md overflow-hidden">
                    {board.map((row, i) => {
                      const p = players[row.player_id];
                      const name = p ? `${p.first_name} ${p.last_name}` : "Unknown";
                      const isTop = i === 0;
                      return (
                        <Link
                          href={p ? `/player/${p.id}` : "#"}
                          key={row.player_id}
                          className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/60 transition-colors ${isTop ? "bg-sa-orange/5" : ""}`}
                        >
                          <span className={`font-mono-stat text-xs w-6 text-center font-bold ${isTop ? "text-sa-orange" : "text-muted-foreground"}`}>
                            {i + 1}
                          </span>
                          <span className="font-mono-stat text-xs text-sa-blue w-8">#{p?.jersey_number ?? "—"}</span>
                          <span className="flex-1 text-sm font-medium text-sa-blue-deep truncate">{name}</span>
                          <span className="font-mono-stat text-base font-bold text-sa-blue-deep">{formatStat(row.value)}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
                {(latestDate || qualifierNote(sec, activeStat)) && (
                  <p className="text-[11px] text-muted-foreground mt-3">
                    {qualifierNote(sec, activeStat) && <span className="font-semibold text-sa-orange">{qualifierNote(sec, activeStat)} · </span>}
                    {latestDate && <>Based on each player's latest snapshot · most recent {new Date(latestDate).toLocaleDateString()}</>}
                  </p>
                )}
              </Card>

              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4">Trends Over Time</h3>
                {renderTrend(sec, sec === "batting" ? ["H","HR","RBI","R"] : sec === "pitching" ? ["SO","BB","H","ER"] : ["TC","PO","A","E"])}
              </Card>
            </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}
