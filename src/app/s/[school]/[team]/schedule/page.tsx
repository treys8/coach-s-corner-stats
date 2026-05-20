"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Calendar, Lock } from "lucide-react";
import { toast } from "sonner";
import { currentSeasonYear, isSeasonLockedFor, seasonLabel } from "@/lib/season";
import { fetchTeamSeasonLocks, type SeasonLockRow } from "@/lib/season-locks";
import { useTeam } from "@/lib/contexts/team";
import { useSchool } from "@/lib/contexts/school";
import { formatDatePart, localToday } from "@/lib/date-display";
import { GameFormDialog } from "@/components/schedule/GameFormDialog";
import { GameRow } from "@/components/schedule/GameRow";
import type { Game } from "@/components/schedule/types";
import { EndSeasonDialog } from "@/components/season/EndSeasonDialog";

const supabase = createClient();

export default function SchedulePage() {
  const { team } = useTeam();
  const { school } = useSchool();
  const [games, setGames] = useState<Game[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState<number>(currentSeasonYear());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [locks, setLocks] = useState<Map<number, SeasonLockRow>>(new Map());
  const [endSeasonOpen, setEndSeasonOpen] = useState(false);

  const load = async () => {
    const [{ data, error }, locksMap] = await Promise.all([
      supabase
        .from("games")
        .select("*")
        .eq("team_id", team.id)
        .order("game_date", { ascending: true }),
      fetchTeamSeasonLocks(supabase, team.id),
    ]);
    if (error) {
      toast.error(`Couldn't load schedule: ${error.message}`);
      return;
    }
    const all = (data ?? []) as Game[];
    setGames(all);
    const yrs = Array.from(new Set([currentSeasonYear(), ...all.map((g) => g.season_year)])).sort((a, b) => b - a);
    setSeasons(yrs);
    setLocks(locksMap);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id]);

  const lockedYears = useMemo(() => new Set(locks.keys()), [locks]);
  const closed = isSeasonLockedFor(season, lockedYears);
  const manualLock = locks.get(season);
  // "End Season" button only makes sense before May 31 — past that, the
  // season is auto-closed and there's nothing left to do.
  const canArchive = !closed;

  const openAdd = () => {
    setEditingGame(null);
    setDialogOpen(true);
  };
  const openEdit = (g: Game) => {
    setEditingGame(g);
    setDialogOpen(true);
  };

  const today = localToday(school.timezone);
  const seasonGames = games.filter((g) => g.season_year === season);
  const upcoming = closed ? [] : seasonGames.filter((g) => g.game_date >= today);
  const past = closed ? seasonGames.slice().reverse() : seasonGames.filter((g) => g.game_date < today).reverse();

  return (
    <div className="container mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Schedule</p>
          <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep">Season Slate</h2>
          {closed && (
            <p className="text-xs uppercase tracking-wider text-sa-orange font-bold mt-2 inline-flex items-center gap-1">
              <Lock className="w-3 h-3" />
              {seasonLabel(season)} · Archived
              {manualLock
                ? ` (closed ${formatDatePart(manualLock.locked_at, "short", school.timezone)})`
                : " (closed May 31)"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {seasons.map((y) => (
                <SelectItem key={y} value={String(y)}>{seasonLabel(y)}{isSeasonLockedFor(y, lockedYears) ? " (closed)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={openAdd}
            disabled={closed}
            className="bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange disabled:opacity-50"
          >
            <Plus className="w-4 h-4 mr-1" /> Add Game
          </Button>
          {canArchive && (
            <Button
              variant="outline"
              onClick={() => setEndSeasonOpen(true)}
              className="border-sa-blue text-sa-blue hover:bg-sa-blue/5"
              title="Archive the current season so it can't be edited"
            >
              <Lock className="w-4 h-4 mr-1" /> End Season
            </Button>
          )}
          <GameFormDialog
            teamId={team.id}
            open={dialogOpen}
            editingGame={editingGame}
            onOpenChange={setDialogOpen}
            onSaved={load}
          />
          <EndSeasonDialog
            open={endSeasonOpen}
            onOpenChange={setEndSeasonOpen}
            teamId={team.id}
            teamName={team.name}
            seasonYear={season}
            onArchived={load}
          />
        </div>
      </div>

      {games.length === 0 ? (
        <Card className="p-12 text-center bg-sa-grey-soft border-dashed">
          <Calendar className="w-10 h-10 mx-auto mb-4 text-sa-blue" />
          <h3 className="font-display text-2xl text-sa-blue-deep mb-2">No games scheduled</h3>
          <p className="text-muted-foreground">Click "Add Game" to start building the season slate.</p>
        </Card>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h3 className="font-display text-xl text-sa-blue uppercase tracking-wider mb-3">Upcoming</h3>
              <div className="space-y-2">
                {upcoming.map((g) => (
                  <GameRow key={g.id} game={g} closed={closed} onEdit={openEdit} onChange={load} />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h3 className="font-display text-xl text-sa-blue uppercase tracking-wider mb-3">Past Games</h3>
              <div className="space-y-2">
                {past.map((g) => (
                  <GameRow key={g.id} game={g} closed={closed} onEdit={openEdit} onChange={load} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
