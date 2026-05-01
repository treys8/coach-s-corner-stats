import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type SectionStats = Record<string, string | number>;
interface Snapshot {
  player_id: string;
  upload_date: string;
  season_year: number;
  stats: { batting?: SectionStats; pitching?: SectionStats; fielding?: SectionStats };
}

const MIN_AB = 5;
const MIN_IP = 3;

type Section = "batting" | "pitching" | "fielding";

// Counting stats per section — summed across roster
const SUM: Record<Section, Set<string>> = {
  batting: new Set(["GP","PA","AB","H","1B","2B","3B","HR","RBI","R","BB","SO","K-L","HBP","SAC","SF","ROE","FC","SB","CS","PIK","QAB","HHB","LOB","2OUTRBI","XBH","TB","PS","2S+3","6+","GIDP","GITP","CI"]),
  pitching: new Set(["GP","GS","BF","#P","W","L","SV","SVO","BS","H","R","ER","BB","SO","K-L","HBP","LOB","BK","PIK","CS","SB","WP","LOO","1ST2OUT","123INN","<13","BBS","LOBB","LOBBS","HR","FB","FBS","CB","CBS","CT","CTS","SL","SLS","CH","CHS","OS","OSS"]),
  fielding: new Set(["TC","A","PO","E","DP","TP","PB","SB","SBATT","CS","PIK","CI","P","C","1B","2B","3B","SS","LF","CF","RF","SF","Total"]),
};
// Rate stats — averaged across roster (rough team avg)
const RATE: Record<Section, string[]> = {
  batting: ["AVG","OBP","SLG","OPS","BABIP","BA/RISP","SB%","QAB%","C%","BB/K","LD%","FB%","GB%"],
  pitching: ["ERA","WHIP","BAA","SV%","P/IP","P/BF","FIP","S%","FPS%","SM%","K/BF","K/BB","WEAK%","HHB%","GO/AO","BABIP","BA/RISP","SB%","FBS%","FBSW%","FBSM%","CBS%","CTS%","SLS%","CHS%","OSS%"],
  fielding: ["FPCT","CS%"],
};

const KEY_DISPLAY: Record<Section, string[]> = {
  batting: ["GP","H","HR","RBI","R","BB","SO","SB","AVG","OBP","SLG","OPS"],
  pitching: ["IP","W","L","SV","SO","BB","ERA","WHIP","BAA","K/BB","BF"],
  fielding: ["TC","PO","A","E","FPCT","DP"],
};

const sectionOf = (snap: Snapshot, section: Section): SectionStats => snap.stats?.[section] ?? {};

const TeamTotals = () => {
  const [allSnapshots, setAllSnapshots] = useState<Snapshot[]>([]);
  const [allPlayers, setAllPlayers] = useState<Record<string, { id: string; first_name: string; last_name: string; jersey_number: string; season_year: number }>>({});
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<number>(currentSeasonYear());

  // Leaderboard state per section
  const [leaderStat, setLeaderStat] = useState<Record<Section, string>>({ batting: "AVG", pitching: "ERA", fielding: "FPCT" });
  const [leaderDir, setLeaderDir] = useState<Record<Section, "desc" | "asc">>({ batting: "desc", pitching: "asc", fielding: "desc" });

  useEffect(() => {
    const load = async () => {
      const [{ data: snaps }, { data: pls }] = await Promise.all([
        supabase.from("stat_snapshots").select("player_id, upload_date, season_year, stats").order("upload_date", { ascending: true }),
        supabase.from("players").select("id, first_name, last_name, jersey_number, season_year"),
      ]);
      setAllSnapshots((snaps ?? []) as unknown as Snapshot[]);
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

  // Aggregate per upload_date per section
  const byDate = useMemo(() => {
    const map = new Map<string, Snapshot[]>();
    for (const s of snapshots) {
      if (!map.has(s.upload_date)) map.set(s.upload_date, []);
      map.get(s.upload_date)!.push(s);
    }
    type Agg = Record<Section, Record<string, number>>;
    const result: { date: string; agg: Agg }[] = [];
    for (const [date, list] of Array.from(map.entries()).sort()) {
      const agg: Agg = { batting: {}, pitching: {}, fielding: {} };
      const rateCounts: Record<Section, Record<string, number>> = { batting: {}, pitching: {}, fielding: {} };
      const sections: Section[] = ["batting", "pitching", "fielding"];
      for (const snap of list) {
        for (const sec of sections) {
          const block = sectionOf(snap, sec);
          for (const [k, v] of Object.entries(block)) {
            if (typeof v !== "number" || !Number.isFinite(v)) continue;
            if (SUM[sec].has(k)) {
              agg[sec][k] = (agg[sec][k] ?? 0) + v;
            } else if (RATE[sec].includes(k)) {
              agg[sec][k] = (agg[sec][k] ?? 0) + v;
              rateCounts[sec][k] = (rateCounts[sec][k] ?? 0) + 1;
            }
          }
        }
      }
      for (const sec of sections) {
        for (const k of RATE[sec]) {
          if (rateCounts[sec][k]) agg[sec][k] = agg[sec][k] / rateCounts[sec][k];
        }
      }
      result.push({ date, agg });
    }
    return result;
  }, [snapshots]);

  const latest = byDate[byDate.length - 1]?.agg;
  const latestDate = byDate[byDate.length - 1]?.date;

  // Latest snapshot per player, plus the union of available stat keys per section
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
        const block = sectionOf(snap, sec);
        for (const [k, v] of Object.entries(block)) {
          if (typeof v === "number" && Number.isFinite(v)) sets[sec].add(k);
        }
      }
      statKeys[sec] = Array.from(sets[sec]).sort();
    });
    return { latestByPlayer, statKeys };
  }, [snapshots]);

  const buildLeaderboard = (section: Section, stat: string) => {
    const rows: { player_id: string; value: number }[] = [];
    for (const [pid, snap] of Object.entries(latestByPlayer)) {
      const v = sectionOf(snap, section)[stat];
      if (typeof v === "number" && Number.isFinite(v)) rows.push({ player_id: pid, value: v });
    }
    return rows;
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
      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Team</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">Total Volunteers</h2>
      <p className="text-sm text-muted-foreground mb-8">
        {byDate.length === 0
          ? "Upload a stats CSV to see team totals."
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
                          to={p ? `/player/${p.id}` : "#"}
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
                {latestDate && (
                  <p className="text-[11px] text-muted-foreground mt-3">
                    Based on each player's latest snapshot · most recent {new Date(latestDate).toLocaleDateString()}
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
};

export default TeamTotals;
