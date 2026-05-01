import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, MapPin, Calendar } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { seasonYearFor, isSeasonClosed, currentSeasonYear, seasonLabel } from "@/lib/season";

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

const Schedule = () => {
  const [games, setGames] = useState<Game[]>([]);
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState<number>(currentSeasonYear());
  const [form, setForm] = useState({
    game_date: "", game_time: "", opponent: "", location: "home",
    team_score: "", opponent_score: "", result: "", notes: ""
  });

  const load = async () => {
    const { data } = await supabase.from("games").select("*").order("game_date", { ascending: true });
    const all = (data ?? []) as Game[];
    setGames(all);
    const yrs = Array.from(new Set([currentSeasonYear(), ...all.map((g) => g.season_year)])).sort((a, b) => b - a);
    setSeasons(yrs);
  };
  useEffect(() => { load(); }, []);

  const closed = isSeasonClosed(season);

  const submit = async () => {
    const parsed = gameSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const yr = seasonYearFor(form.game_date);
    if (isSeasonClosed(yr)) {
      toast.error(`The ${yr} season is closed. You can't add games to a past season.`);
      return;
    }
    const payload = {
      game_date: form.game_date,
      game_time: form.game_time || null,
      opponent: form.opponent.trim(),
      location: form.location,
      team_score: form.team_score === "" ? null : Number(form.team_score),
      opponent_score: form.opponent_score === "" ? null : Number(form.opponent_score),
      result: form.result || null,
      notes: form.notes || null,
      season_year: yr,
    };
    const { error } = await supabase.from("games").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Game added");
    setOpen(false);
    setForm({ game_date: "", game_time: "", opponent: "", location: "home", team_score: "", opponent_score: "", result: "", notes: "" });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this game?")) return;
    const { error } = await supabase.from("games").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Game removed");
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
            {g.game_time && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{g.game_time.slice(0,5)}</span>}
            <span className="flex items-center gap-1 capitalize"><MapPin className="w-3 h-3" />{g.location}</span>
          </div>
          {g.notes && <p className="text-xs text-muted-foreground mt-1 italic truncate">{g.notes}</p>}
        </div>
        <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100" onClick={() => remove(g.id)}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
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
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={closed} className="bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange disabled:opacity-50">
                <Plus className="w-4 h-4 mr-1" /> Add Game
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display text-2xl">Add Game</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={form.game_date} onChange={(e) => setForm({...form, game_date: e.target.value})} /></div>
                <div><Label>Time</Label><Input type="time" value={form.game_time} onChange={(e) => setForm({...form, game_time: e.target.value})} /></div>
              </div>
              <div><Label>Opponent</Label><Input value={form.opponent} onChange={(e) => setForm({...form, opponent: e.target.value})} placeholder="Magnolia Heights" /></div>
              <div><Label>Location</Label>
                <Select value={form.location} onValueChange={(v) => setForm({...form, location: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home">Home</SelectItem>
                    <SelectItem value="away">Away</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Result</Label>
                  <Select value={form.result} onValueChange={(v) => setForm({...form, result: v})}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="W">Win</SelectItem>
                      <SelectItem value="L">Loss</SelectItem>
                      <SelectItem value="T">Tie</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Our score</Label><Input type="number" value={form.team_score} onChange={(e) => setForm({...form, team_score: e.target.value})} /></div>
                <div><Label>Their score</Label><Input type="number" value={form.opponent_score} onChange={(e) => setForm({...form, opponent_score: e.target.value})} /></div>
              </div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} maxLength={500} rows={2} /></div>
            </div>
            <DialogFooter><Button onClick={submit} className="bg-sa-blue hover:bg-sa-blue-deep">Save Game</Button></DialogFooter>
          </DialogContent>
        </Dialog>
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
};

export default Schedule;
