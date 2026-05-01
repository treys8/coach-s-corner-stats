import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp } from "lucide-react";
import { StatLabel } from "@/components/StatTooltip";
import { formatStat } from "@/lib/csvParser";
import { GLOSSARY } from "@/lib/glossary";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type SectionStats = Record<string, string | number>;
interface Snapshot {
  player_id: string;
  upload_date: string;
  stats: { batting?: SectionStats; pitching?: SectionStats; fielding?: SectionStats };
}

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
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [players, setPlayers] = useState<Record<string, { id: string; first_name: string; last_name: string; jersey_number: string }>>({});
  const [loading, setLoading] = useState(true);

  // Leaderboard state per section
  const [leaderStat, setLeaderStat] = useState<Record<Section, string>>({ batting: "AVG", pitching: "ERA", fielding: "FPCT" });
  const [leaderDir, setLeaderDir] = useState<Record<Section, "desc" | "asc">>({ batting: "desc", pitching: "asc", fielding: "desc" });

  useEffect(() => {
    const load = async () => {
      const [{ data: snaps }, { data: pls }] = await Promise.all([
        supabase.from("stat_snapshots").select("player_id, upload_date, stats").order("upload_date", { ascending: true }),
        supabase.from("players").select("id, first_name, last_name, jersey_number"),
      ]);
      setSnapshots((snaps ?? []) as unknown as Snapshot[]);
      const pmap: Record<string, { id: string; first_name: string; last_name: string; jersey_number: string }> = {};
      (pls ?? []).forEach((p: { id: string; first_name: string; last_name: string; jersey_number: string }) => { pmap[p.id] = p; });
      setPlayers(pmap);
      setLoading(false);
    };
    load();
  }, []);

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

          {(["batting","pitching","fielding"] as Section[]).map((sec) => (
            <TabsContent key={sec} value={sec} className="space-y-6 mt-6">
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4 capitalize">{sec} Totals</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {KEY_DISPLAY[sec].map((k) => (
                    <div key={k} className="bg-muted/40 rounded-md p-3 border border-border">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        <StatLabel abbr={k} />
                      </div>
                      <div className="font-mono-stat text-xl font-bold text-sa-blue-deep">
                        {formatStat(latest?.[sec]?.[k])}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4">Trends Over Time</h3>
                {renderTrend(sec, sec === "batting" ? ["H","HR","RBI","R"] : sec === "pitching" ? ["SO","BB","H","ER"] : ["TC","PO","A","E"])}
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
};

export default TeamTotals;
