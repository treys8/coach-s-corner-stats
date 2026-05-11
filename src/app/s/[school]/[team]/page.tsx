"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Users, Lock } from "lucide-react";
import { currentSeasonYear, isSeasonClosed, seasonLabel } from "@/lib/season";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";

interface RosterRow {
  player_id: string;
  jersey_number: string | null;
  first_name: string;
  last_name: string;
  season_year: number;
}

const supabase = createClient();

export default function RosterPage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const [allEntries, setAllEntries] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestUpload, setLatestUpload] = useState<string | null>(null);
  const [season, setSeason] = useState<number>(currentSeasonYear());

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      const [{ data: entries, error: rErr }, { data: uploads, error: uErr }] = await Promise.all([
        supabase
          .from("roster_entries")
          .select("player_id, jersey_number, season_year, players(first_name, last_name)")
          .eq("team_id", team.id),
        supabase
          .from("csv_uploads")
          .select("upload_date, season_year")
          .eq("team_id", team.id)
          .order("upload_date", { ascending: false }),
      ]);
      if (rErr) toast.error(`Couldn't load roster: ${rErr.message}`);
      if (uErr) toast.error(`Couldn't load upload history: ${uErr.message}`);
      const rows: RosterRow[] = ((entries ?? []) as unknown as Array<{
        player_id: string;
        jersey_number: string | null;
        season_year: number;
        players: { first_name: string; last_name: string } | null;
      }>)
        .filter((e) => e.players)
        .map((e) => ({
          player_id: e.player_id,
          jersey_number: e.jersey_number,
          season_year: e.season_year,
          first_name: e.players!.first_name,
          last_name: e.players!.last_name,
        }));
      setAllEntries(rows);
      setLatestUpload(uploads?.[0]?.upload_date ?? null);
      setLoading(false);
    };
    load();
  }, [team.id]);

  const seasons = useMemo(() => {
    const yrs = new Set<number>([currentSeasonYear()]);
    allEntries.forEach((e) => yrs.add(e.season_year));
    return Array.from(yrs).sort((a, b) => b - a);
  }, [allEntries]);

  const players = useMemo(() => {
    return allEntries
      .filter((e) => e.season_year === season)
      .slice()
      .sort((a, b) => {
        // parseInt("0") || 999 was 999 — would have sent #0 to the bottom.
        // Treat null / blank / non-numeric as 999 so #0 sorts to the top while
        // missing jerseys still sort last.
        const score = (j: string | null) => {
          if (j == null || j.trim() === "") return 999;
          const n = Number(j);
          return Number.isFinite(n) ? n : 999;
        };
        return score(a.jersey_number) - score(b.jersey_number);
      });
  }, [allEntries, season]);

  const closed = isSeasonClosed(season);

  return (
    <div className="container mx-auto px-6 py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Roster</p>
          <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep">{team.name}</h2>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {latestUpload && (
              <p className="text-sm text-muted-foreground">
                Stats current through{" "}
                <span className="font-semibold text-foreground">
                  {new Date(latestUpload).toLocaleDateString()}
                </span>
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
              : "Upload your roster to set jersey numbers up front, or upload a stats workbook to populate it from there."}
          </p>
          {!closed && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href={`/s/${school.slug}/${team.slug}/upload/roster`}
                className="inline-flex items-center gap-2 bg-sa-orange text-white px-6 py-3 rounded-md font-semibold uppercase tracking-wider text-sm shadow-orange hover:bg-sa-orange-glow transition-colors"
              >
                <Upload className="w-4 h-4" /> Upload Roster
              </Link>
              <Link
                href={`/s/${school.slug}/${team.slug}/upload/stats`}
                className="inline-flex items-center gap-2 border border-sa-blue text-sa-blue px-6 py-3 rounded-md font-semibold uppercase tracking-wider text-sm hover:bg-sa-blue/5 transition-colors"
              >
                <Upload className="w-4 h-4" /> Upload Stats
              </Link>
            </div>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {players.map((p) => (
            <Link
              key={p.player_id}
              href={`/s/${school.slug}/${team.slug}/player/${p.player_id}`}
              className="group relative bg-card border border-border rounded-lg overflow-hidden shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all"
            >
              <div className="bg-gradient-blue h-2" />
              <div className="p-5 flex items-center gap-4">
                <div className="font-display text-5xl text-sa-orange leading-none w-16 text-center font-mono-stat">
                  {p.jersey_number || "—"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {p.first_name}
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
}
