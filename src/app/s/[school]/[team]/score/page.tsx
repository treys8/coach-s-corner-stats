"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTeam } from "@/lib/contexts/team";
import { useSchool } from "@/lib/contexts/school";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { currentSeasonYear } from "@/lib/season";
import type { GameStatus, GameLocation } from "@/integrations/supabase/types";

interface ScorableGame {
  id: string;
  game_date: string;
  game_time: string | null;
  opponent: string;
  location: GameLocation;
  status: GameStatus;
}

const supabase = createClient();
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ScoreIndexPage() {
  const { team } = useTeam();
  const { school } = useSchool();
  const router = useRouter();
  const base = `/s/${school.slug}/${team.slug}/score`;

  const [games, setGames] = useState<ScorableGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ opponent: "", location: "home" as GameLocation, time: "" });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("games")
      .select("id, game_date, game_time, opponent, location, status")
      .eq("team_id", team.id)
      .in("status", ["draft", "in_progress"])
      .gte("game_date", todayIso())
      .order("game_date", { ascending: true })
      .order("game_time", { ascending: true, nullsFirst: false });
    if (error) {
      toast.error(`Couldn't load games: ${error.message}`);
      setGames([]);
    } else {
      setGames((data ?? []) as ScorableGame[]);
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [team.id]);

  const createAdHoc = async () => {
    if (!form.opponent.trim()) {
      toast.error("Opponent name required");
      return;
    }
    setCreating(true);
    const { data, error } = await supabase
      .from("games")
      .insert({
        team_id: team.id,
        season_year: currentSeasonYear(),
        game_date: todayIso(),
        game_time: form.time || null,
        opponent: form.opponent.trim(),
        location: form.location,
        status: "draft",
      })
      .select("id")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(`Couldn't create game: ${error?.message ?? "unknown"}`);
      return;
    }
    router.push(`${base}/${data.id}`);
  };

  return (
    <main className="container mx-auto px-6 py-8 space-y-8">
      <header>
        <h2 className="font-display text-3xl text-sa-blue-deep">Score a Game</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a game to start scoring. Live scores show on the public scoreboard until you finalize.
        </p>
      </header>

      <section className="space-y-3">
        <h3 className="font-display text-lg text-sa-blue uppercase tracking-wider">Today &amp; upcoming</h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : games.length === 0 ? (
          <p className="text-sm text-muted-foreground">No draft or in-progress games. Create one below.</p>
        ) : (
          <ul className="space-y-2">
            {games.map((g) => (
              <li key={g.id}>
                <Link
                  href={`${base}/${g.id}`}
                  className="block hover:no-underline"
                >
                  <Card className="p-4 flex items-center gap-4 hover:border-sa-orange transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">
                        {new Date(g.game_date + "T12:00:00").toLocaleDateString(undefined, {
                          weekday: "short", month: "short", day: "numeric",
                        })}
                        {g.game_time ? ` · ${g.game_time.slice(0, 5)}` : ""}
                      </p>
                      <p className="font-display text-xl text-sa-blue-deep truncate">
                        {g.location === "home" ? "vs" : g.location === "away" ? "@" : "neutral"}{" "}
                        <span className="font-bold">{g.opponent}</span>
                      </p>
                    </div>
                    <Badge variant={g.status === "in_progress" ? "default" : "secondary"} className="uppercase">
                      {g.status === "in_progress" ? "Live" : "Draft"}
                    </Badge>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-lg text-sa-blue uppercase tracking-wider">Create ad-hoc game</h3>
        <Card className="p-4 space-y-4 max-w-xl">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="opp">Opponent</Label>
              <Input
                id="opp"
                value={form.opponent}
                onChange={(e) => setForm({ ...form, opponent: e.target.value })}
                placeholder="Northside HS"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="time">Start time (optional)</Label>
              <Input
                id="time"
                type="time"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1 max-w-xs">
            <Label>Location</Label>
            <Select
              value={form.location}
              onValueChange={(v) => setForm({ ...form, location: v as GameLocation })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="home">Home</SelectItem>
                <SelectItem value="away">Away</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={createAdHoc} disabled={creating}>
            {creating ? "Creating…" : "Create game and continue"}
          </Button>
        </Card>
      </section>
    </main>
  );
}
