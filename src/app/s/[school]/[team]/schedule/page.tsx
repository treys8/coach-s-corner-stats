"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, MapPin, Calendar, CheckCircle2, Globe, Pencil } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { seasonYearFor, isSeasonClosed, currentSeasonYear, seasonLabel } from "@/lib/season";
import { useTeam } from "@/lib/contexts/team";

interface Game {
  id: string;
  game_date: string;
  game_time: string | null;
  opponent: string;
  location: string;
  team_score: number | null;
  opponent_score: number | null;
  result: string | null;
  notes: string | null;
  season_year: number;
  is_final: boolean;
}

const gameSchema = z.object({
  game_date: z.string().min(1, "Date required"),
  game_time: z.string().optional(),
  opponent: z.string().trim().min(1, "Opponent required").max(100),
  location: z.enum(["home", "away", "neutral"]),
  team_score: z.string().optional(),
  opponent_score: z.string().optional(),
  result: z.enum(["", "W", "L", "T"]).optional(),
  notes: z.string().max(500).optional(),
});

const supabase = createClient();

const DEFAULT_FORM = {
  game_date: "", game_time: "", opponent: "", location: "home",
  team_score: "", opponent_score: "", result: "", notes: "",
};

export default function SchedulePage() {
  const { team } = useTeam();
  const [games, setGames] = useState<Game[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState<number>(currentSeasonYear());
  const [form, setForm] = useState(DEFAULT_FORM);

  const load = async () => {
    const { data, error } = await supabase
      .from("games")
      .select("*")
      .eq("team_id", team.id)
      .order("game_date", { ascending: true });
    if (error) {
      toast.error(`Couldn't load schedule: ${error.message}`);
      return;
    }
    const all = (data ?? []) as Game[];
    setGames(all);
    const yrs = Array.from(new Set([currentSeasonYear(), ...all.map((g) => g.season_year)])).sort((a, b) => b - a);
    setSeasons(yrs);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id]);

  const closed = isSeasonClosed(season);

  const closeDialog = () => {
    setOpen(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
  };

  const openEdit = (g: Game) => {
    setEditingId(g.id);
    setForm({
      game_date: g.game_date,
      game_time: g.game_time?.slice(0, 5) ?? "",
      opponent: g.opponent,
      location: g.location,
      team_score: g.team_score === null ? "" : String(g.team_score),
      opponent_score: g.opponent_score === null ? "" : String(g.opponent_score),
      result: g.result ?? "",
      notes: g.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async () => {
    const parsed = gameSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const yr = seasonYearFor(form.game_date);
    if (isSeasonClosed(yr)) {
      toast.error(`The ${yr} season is closed.`);
      return;
    }
    // Provisional is_home derivation matching 20260509160000_..._backfill_is_home.sql:
    // home/neutral → true, away → false. Will be refined when the opponent picker
    // wire-up adds an explicit choice for neutral games.
    const payload = {
      team_id: team.id,
      game_date: form.game_date,
      game_time: form.game_time || null,
      opponent: form.opponent.trim(),
      location: form.location as "home" | "away" | "neutral",
      is_home: form.location !== "away",
      team_score: form.team_score === "" ? null : Number(form.team_score),
      opponent_score: form.opponent_score === "" ? null : Number(form.opponent_score),
      result: (form.result || null) as "W" | "L" | "T" | null,
      notes: form.notes || null,
    };
    const { error } = editingId
      ? await supabase.from("games").update(payload).eq("id", editingId)
      : await supabase.from("games").insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingId ? "Game updated" : "Game added");
    closeDialog();
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this game?")) return;
    const { error } = await supabase.from("games").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Game removed");
    load();
  };

  const setFinal = async (g: Game, isFinal: boolean) => {
    if (isFinal) {
      if (g.team_score === null || g.opponent_score === null || !g.result) {
        toast.error("Add the score and result before marking final.");
        return;
      }
      if (!confirm("Mark this game final? It'll appear on the public Scores page.")) return;
    }
    // Write `status` — the games_sync_status_is_final trigger derives is_final
    // and stamps finalized_at. Writing is_final directly leaves status='draft',
    // which keeps the game off /scores even though the user marked it final.
    const { error } = await supabase
      .from("games")
      .update(
        isFinal
          ? { status: "final" as const }
          : { status: "draft" as const, finalized_at: null },
      )
      .eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isFinal ? "Game finalized" : "Game un-finalized");
    load();
  };

  const today = new Date().toISOString().slice(0, 10);
  const seasonGames = games.filter((g) => g.season_year === season);
  const upcoming = closed ? [] : seasonGames.filter((g) => g.game_date >= today);
  const past = closed ? seasonGames.slice().reverse() : seasonGames.filter((g) => g.game_date < today).reverse();

  const renderGame = (g: Game) => {
    const isPast = g.game_date < today;
    const resultColor = g.result === "W" ? "bg-sa-blue text-white" : g.result === "L" ? "bg-sa-orange text-white" : "bg-sa-grey text-white";
    return (
      <div key={g.id} className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg shadow-card group">
        <div className="text-center w-16 flex-shrink-0 border-r pr-4">
          <p className="font-display text-2xl text-sa-blue-deep leading-none">{new Date(g.game_date).toLocaleDateString(undefined, { day: "numeric" })}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{new Date(g.game_date).toLocaleDateString(undefined, { month: "short" })}</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase font-bold tracking-wider text-sa-orange">{g.location === "home" ? "vs" : g.location === "away" ? "@" : "neutral"}</span>
            <h3 className="font-display text-xl text-sa-blue-deep truncate">{g.opponent}</h3>
            {isPast && g.result && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${resultColor}`}>
                {g.result} {g.team_score ?? "-"}-{g.opponent_score ?? "-"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            {g.game_time && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{g.game_time.slice(0, 5)}</span>}
            <span className="flex items-center gap-1 capitalize"><MapPin className="w-3 h-3" />{g.location}</span>
            {g.is_final && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sa-blue">
                <Globe className="w-3 h-3" /> On public Scores
              </span>
            )}
          </div>
          {g.notes && <p className="text-xs text-muted-foreground mt-1 italic truncate">{g.notes}</p>}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isPast && g.result && g.team_score !== null && g.opponent_score !== null && (
            g.is_final ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-sa-blue hover:text-sa-blue-deep"
                onClick={() => setFinal(g, false)}
                title="Remove from public Scores"
              >
                Un-finalize
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-sa-blue hover:text-sa-blue-deep"
                onClick={() => setFinal(g, true)}
                title="Publish to public Scores page"
              >
                <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Final
              </Button>
            )
          )}
          <Button variant="ghost" size="icon" onClick={() => openEdit(g)} disabled={closed} title="Edit game">
            <Pencil className="w-4 h-4 text-sa-blue" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => remove(g.id)}>
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Schedule</p>
          <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep">Season Slate</h2>
          {closed && (
            <p className="text-xs uppercase tracking-wider text-sa-orange font-bold mt-2">
              {seasonLabel(season)} · Archived (closed May 31)
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {seasons.map((y) => (
                <SelectItem key={y} value={String(y)}>{seasonLabel(y)}{isSeasonClosed(y) ? " (closed)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeDialog())}>
            <DialogTrigger asChild>
              <Button disabled={closed} className="bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange disabled:opacity-50">
                <Plus className="w-4 h-4 mr-1" /> Add Game
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display text-2xl">{editingId ? "Edit Game" : "Add Game"}</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Date</Label><Input type="date" value={form.game_date} onChange={(e) => setForm({ ...form, game_date: e.target.value })} /></div>
                  <div><Label>Time</Label><Input type="time" value={form.game_time} onChange={(e) => setForm({ ...form, game_time: e.target.value })} /></div>
                </div>
                <div><Label>Opponent</Label><Input value={form.opponent} onChange={(e) => setForm({ ...form, opponent: e.target.value })} placeholder="Magnolia Heights" /></div>
                <div>
                  <Label>Location</Label>
                  <Select value={form.location} onValueChange={(v) => setForm({ ...form, location: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="home">Home</SelectItem>
                      <SelectItem value="away">Away</SelectItem>
                      <SelectItem value="neutral">Neutral</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Result</Label>
                    <Select value={form.result} onValueChange={(v) => setForm({ ...form, result: v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="W">Win</SelectItem>
                        <SelectItem value="L">Loss</SelectItem>
                        <SelectItem value="T">Tie</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Our score</Label><Input type="number" value={form.team_score} onChange={(e) => setForm({ ...form, team_score: e.target.value })} /></div>
                  <div><Label>Their score</Label><Input type="number" value={form.opponent_score} onChange={(e) => setForm({ ...form, opponent_score: e.target.value })} /></div>
                </div>
                <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} rows={2} /></div>
              </div>
              <DialogFooter><Button onClick={submit} className="bg-sa-blue hover:bg-sa-blue-deep">{editingId ? "Save Changes" : "Save Game"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
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
              <div className="space-y-2">{upcoming.map(renderGame)}</div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h3 className="font-display text-xl text-sa-blue uppercase tracking-wider mb-3">Past Games</h3>
              <div className="space-y-2">{past.map(renderGame)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
