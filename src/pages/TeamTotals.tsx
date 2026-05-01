import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatLabel } from "@/components/StatTooltip";
import { formatStat } from "@/lib/csvParser";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Snapshot { player_id: string; upload_date: string; stats: Record<string, string | number> }

// Stats that should be summed across the team (counting stats)
const SUM_STATS = new Set(["GP","PA","AB","H","1B","2B","3B","HR","RBI","R","BB","SO","HBP","SAC","SF","SB","CS","XBH","TB",
  "IP","BF","#P","W","L","SV","ER","SO","BB","H","K","TC","A","PO","E","DP","TP","INN"]);
// Rates are recomputed; for simplicity we'll average them across players (rough)
const RATE_STATS = ["AVG","OBP","SLG","OPS","ERA","WHIP","FPCT","BAA"];

const TEAM_KEY = ["GP","H","HR","RBI","R","BB","SO","SB","AVG","OBP","SLG","OPS","ERA","WHIP","FPCT"];

const TeamTotals = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("stat_snapshots").select("player_id, upload_date, stats").order("upload_date", { ascending: true });
      setSnapshots((data ?? []) as unknown as Snapshot[]);
      setLoading(false);
    };
    load();
  }, []);

  // Aggregate per upload_date: sum counting stats across players, average rate stats
  const byDate = useMemo(() => {
    const map = new Map<string, Snapshot[]>();
    for (const s of snapshots) {
      if (!map.has(s.upload_date)) map.set(s.upload_date, []);
      map.get(s.upload_date)!.push(s);
    }
    const result: { date: string; agg: Record<string, number> }[] = [];
    for (const [date, list] of Array.from(map.entries()).sort()) {
      const agg: Record<string, number> = {};
      const rateCounts: Record<string, number> = {};
      for (const snap of list) {
        for (const [k, v] of Object.entries(snap.stats)) {
          if (typeof v !== "number") continue;
          if (SUM_STATS.has(k)) {
            agg[k] = (agg[k] ?? 0) + v;
          } else if (RATE_STATS.includes(k)) {
            agg[k] = (agg[k] ?? 0) + v;
            rateCounts[k] = (rateCounts[k] ?? 0) + 1;
          } else {
            // default: sum
            agg[k] = (agg[k] ?? 0) + v;
          }
        }
      }
      for (const k of RATE_STATS) {
        if (rateCounts[k]) agg[k] = agg[k] / rateCounts[k];
      }
      result.push({ date, agg });
    }
    return result;
  }, [snapshots]);

  const latest = byDate[byDate.length - 1]?.agg ?? {};
  const trendData = byDate.map((d) => ({ date: new Date(d.date).toLocaleDateString(undefined,{month:"short",day:"numeric"}), ...d.agg }));

  if (loading) return <div className="container mx-auto px-6 py-10"><Skeleton className="h-96" /></div>;

  return (
    <div className="container mx-auto px-6 py-10">
      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Team</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">Total Volunteers</h2>
      <p className="text-sm text-muted-foreground mb-8">
        {byDate.length === 0
          ? "Upload a stats CSV to see team totals."
          : `Aggregated across ${snapshots.filter((s)=>s.upload_date===byDate[byDate.length-1].date).length} players · latest ${new Date(byDate[byDate.length-1].date).toLocaleDateString()}`}
      </p>

      {byDate.length === 0 ? (
        <Card className="p-12 text-center bg-sa-grey-soft border-dashed">
          <p className="text-muted-foreground">No data yet.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-10">
            {TEAM_KEY.map((k) => (
              <div key={k} className="bg-card border border-border rounded-md p-4 shadow-card">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  <StatLabel abbr={k} />
                </div>
                <div className="font-mono-stat text-2xl font-bold text-sa-blue-deep">{formatStat(latest[k])}</div>
              </div>
            ))}
          </div>

          <Tabs defaultValue="offense" className="w-full">
            <TabsList>
              <TabsTrigger value="offense">Offense Trends</TabsTrigger>
              <TabsTrigger value="pitching">Pitching Trends</TabsTrigger>
            </TabsList>
            <TabsContent value="offense" className="mt-6">
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4">Hits, HR, RBI, Runs</h3>
                {byDate.length < 2 ? (
                  <p className="text-sm text-muted-foreground italic">Trends appear after the second weekly upload.</p>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RTooltip contentStyle={{ background: "hsl(var(--sa-blue-deep))", border: "1px solid hsl(var(--sa-orange))", color: "white", fontSize: 12 }} />
                        <Line type="monotone" dataKey="H" stroke="#FF4A00" strokeWidth={2} />
                        <Line type="monotone" dataKey="HR" stroke="#0021A5" strokeWidth={2} />
                        <Line type="monotone" dataKey="RBI" stroke="#A7A8AA" strokeWidth={2} />
                        <Line type="monotone" dataKey="R" stroke="#001f6b" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="pitching" className="mt-6">
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4">Strikeouts & Walks</h3>
                {byDate.length < 2 ? (
                  <p className="text-sm text-muted-foreground italic">Trends appear after the second weekly upload.</p>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RTooltip contentStyle={{ background: "hsl(var(--sa-blue-deep))", border: "1px solid hsl(var(--sa-orange))", color: "white", fontSize: 12 }} />
                        <Line type="monotone" dataKey="SO" stroke="#FF4A00" strokeWidth={2} name="Strikeouts" />
                        <Line type="monotone" dataKey="BB" stroke="#0021A5" strokeWidth={2} name="Walks" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
};

export default TeamTotals;
