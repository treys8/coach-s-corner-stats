import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { StatLabel } from "@/components/StatTooltip";
import { formatStat } from "@/lib/csvParser";
import { KEY_BATTING, KEY_PITCHING, KEY_FIELDING } from "@/lib/glossary";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Player { id: string; jersey_number: string; first_name: string; last_name: string }
type SectionStats = Record<string, string | number>;
interface Snapshot {
  upload_date: string;
  stats: { batting?: SectionStats; pitching?: SectionStats; fielding?: SectionStats } | SectionStats;
}

type Section = "batting" | "pitching" | "fielding";

const TREND: Record<Section, string[]> = {
  batting: ["AVG", "OBP", "SLG", "OPS", "H", "HR", "RBI"],
  pitching: ["ERA", "WHIP", "SO", "BB", "IP"],
  fielding: ["FPCT", "TC", "E"],
};

/** Returns the section block from a snapshot, regardless of legacy or new shape. */
const sectionOf = (snap: Snapshot, section: Section): SectionStats => {
  const s = snap.stats as { batting?: SectionStats; pitching?: SectionStats; fielding?: SectionStats };
  if (s && (s.batting || s.pitching || s.fielding)) return s[section] ?? {};
  return {};
};

const PlayerDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState({ batting: false, pitching: false, fielding: false });

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const [{ data: pl }, { data: snaps }] = await Promise.all([
        supabase.from("players").select("*").eq("id", id).maybeSingle(),
        supabase.from("stat_snapshots").select("upload_date, stats").eq("player_id", id).order("upload_date", { ascending: true }),
      ]);
      setPlayer(pl as Player);
      setSnapshots((snaps ?? []) as unknown as Snapshot[]);
      setLoading(false);
    };
    load();
  }, [id]);

  const latestSnap = snapshots[snapshots.length - 1];

  if (loading) {
    return <div className="container mx-auto px-6 py-10"><Skeleton className="h-32 mb-6" /><Skeleton className="h-96" /></div>;
  }
  if (!player) {
    return (
      <div className="container mx-auto px-6 py-10 text-center">
        <p className="text-muted-foreground">Player not found.</p>
        <Link to="/" className="text-sa-orange underline">Back to roster</Link>
      </div>
    );
  }

  const renderStatGrid = (section: Section, keyStats: string[]) => {
    const latest = latestSnap ? sectionOf(latestSnap, section) : {};
    const allKeys = Object.keys(latest);
    if (allKeys.length === 0) {
      return <p className="text-sm text-muted-foreground italic">No {section} stats yet — upload a CSV to populate.</p>;
    }
    const expanded = showAll[section];
    const visible = expanded ? allKeys : keyStats.filter((k) => k in latest);
    return (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {visible.map((k) => (
            <div key={k} className="bg-muted/40 rounded-md p-3 border border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                <StatLabel abbr={k} />
              </div>
              <div className="font-mono-stat text-xl font-bold text-sa-blue-deep">{formatStat(latest[k])}</div>
            </div>
          ))}
        </div>
        {allKeys.length > visible.length || expanded ? (
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowAll((s) => ({ ...s, [section]: !s[section] }))}>
            {expanded ? <><ChevronUp className="w-4 h-4 mr-1" /> Show key stats</> : <><ChevronDown className="w-4 h-4 mr-1" /> Show all {allKeys.length} stats</>}
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
      const block = sectionOf(s, section);
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
      <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-sa-orange mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to roster
      </Link>

      <div className="bg-gradient-blue text-white rounded-lg p-8 mb-8 shadow-elevated relative overflow-hidden">
        <div className="absolute -right-8 -bottom-12 font-display text-[14rem] leading-none text-sa-orange/20 select-none font-mono-stat">
          {player.jersey_number || "—"}
        </div>
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold mb-1">#{player.jersey_number}</p>
          <h2 className="font-display text-6xl md:text-7xl">{player.first_name} {player.last_name}</h2>
          <p className="text-white/70 mt-2 text-sm">
            {snapshots.length} weekly snapshot{snapshots.length === 1 ? "" : "s"} · latest {latestSnap ? new Date(latestSnap.upload_date).toLocaleDateString() : "—"}
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
          return (
            <TabsContent key={sec} value={sec} className="space-y-6 mt-6">
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4 capitalize">{sec} Stats</h3>
                {renderStatGrid(sec, keyStats)}
              </Card>
              <Card className="p-6">
                <h3 className="font-display text-2xl text-sa-blue-deep mb-4">Trends Over Time</h3>
                {renderTrend(sec)}
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default PlayerDetail;
