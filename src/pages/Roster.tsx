import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Users, Lock } from "lucide-react";
import { currentSeasonYear, isSeasonClosed, seasonLabel } from "@/lib/season";

interface PlayerRow {
  id: string;
  jersey_number: string;
  first_name: string;
  last_name: string;
  season_year: number;
}

const Roster = () => {
  const [allPlayers, setAllPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestUpload, setLatestUpload] = useState<string | null>(null);
  const [season, setSeason] = useState<number>(currentSeasonYear());

  useEffect(() => {
    const load = async () => {
      const [{ data: p, error: pErr }, { data: u, error: uErr }] = await Promise.all([
        supabase.from("players").select("id, jersey_number, first_name, last_name, season_year"),
        supabase.from("csv_uploads").select("upload_date, season_year").order("upload_date", { ascending: false }),
      ]);
      if (pErr) toast.error(`Couldn't load roster: ${pErr.message}`);
      if (uErr) toast.error(`Couldn't load upload history: ${uErr.message}`);
      setAllPlayers((p ?? []) as PlayerRow[]);
      setLatestUpload(u?.[0]?.upload_date ?? null);
      setLoading(false);
    };
    load();
  }, []);

  const seasons = useMemo(() => {
    const yrs = new Set<number>([currentSeasonYear()]);
    allPlayers.forEach((p) => yrs.add(p.season_year));
    return Array.from(yrs).sort((a, b) => b - a);
  }, [allPlayers]);

  const players = useMemo(() => {
    return allPlayers
      .filter((p) => p.season_year === season)
      .slice()
      .sort((a, b) => (parseInt(a.jersey_number) || 999) - (parseInt(b.jersey_number) || 999));
  }, [allPlayers, season]);

  const closed = isSeasonClosed(season);

  return (
    <div className="container mx-auto px-6 py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Roster</p>
          <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep">The Volunteers</h2>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {latestUpload && (
              <p className="text-sm text-muted-foreground">
                Stats current through <span className="font-semibold text-foreground">{new Date(latestUpload).toLocaleDateString()}</span>
              </p>
            )}
            {closed && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-sa-orange bg-sa-orange/10 px-2 py-1 rounded">
                <Lock className="w-3 h-3" /> Archived season
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span>{players.length}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : players.length === 0 ? (
        <Card className="p-12 text-center bg-sa-grey-soft border-dashed">
          <Upload className="w-10 h-10 mx-auto mb-4 text-sa-blue" />
          <h3 className="font-display text-2xl text-sa-blue-deep mb-2">No roster for {season}</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            {closed
              ? `The ${season} season has no roster on record.`
              : "Upload your first weekly stats workbook to populate this season's roster."}
          </p>
          {!closed && (
            <Link
              to="/upload"
              className="inline-flex items-center gap-2 bg-sa-orange text-white px-6 py-3 rounded-md font-semibold uppercase tracking-wider text-sm shadow-orange hover:bg-sa-orange-glow transition-colors"
            >
              <Upload className="w-4 h-4" /> Upload Stats
            </Link>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {players.map((p) => (
            <Link
              key={p.id}
              to={`/player/${p.id}`}
              className="group relative bg-card border border-border rounded-lg overflow-hidden shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all"
            >
              <div className="bg-gradient-blue h-2" />
              <div className="p-5 flex items-center gap-4">
                <div className="font-display text-5xl text-sa-orange leading-none w-16 text-center font-mono-stat">
                  {p.jersey_number || "—"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    #{p.jersey_number || "—"} · {p.first_name}
                  </p>
                  <p className="font-display text-2xl text-sa-blue-deep truncate group-hover:text-sa-orange transition-colors">
                    {p.last_name}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Roster;
