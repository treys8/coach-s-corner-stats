"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTeam } from "@/lib/contexts/team";
import { useSchool } from "@/lib/contexts/school";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { currentSeasonYear } from "@/lib/season";
import type { GameStatus, GameLocation } from "@/integrations/supabase/types";
import type { GameStartedPayload, LineupSlot } from "@/lib/scoring/types";
import { LiveScoring } from "@/components/scoring/LiveScoring";

interface GameRow {
  id: string;
  team_id: string;
  game_date: string;
  game_time: string | null;
  opponent: string;
  location: GameLocation;
  status: GameStatus;
  team_score: number | null;
  opponent_score: number | null;
}

interface RosterPlayer {
  id: string;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
  primary_position: string | null;
}

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"] as const;
type Position = (typeof POSITIONS)[number];

const supabase = createClient();
const playerLabel = (p: RosterPlayer) =>
  `${p.jersey_number ? `#${p.jersey_number} ` : ""}${p.first_name} ${p.last_name}`;

export default function ScoreGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = use(params);
  const { team } = useTeam();
  const { school } = useSchool();
  const base = `/s/${school.slug}/${team.slug}/score`;

  const [game, setGame] = useState<GameRow | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [gameRes, rosterRes] = await Promise.all([
        supabase
          .from("games")
          .select("id, team_id, game_date, game_time, opponent, location, status, team_score, opponent_score")
          .eq("id", gameId)
          .maybeSingle(),
        supabase
          .from("roster_entries")
          .select("jersey_number, position, players!inner(id, first_name, last_name)")
          .eq("team_id", team.id)
          .eq("season_year", currentSeasonYear())
          .order("jersey_number", { ascending: true, nullsFirst: false }),
      ]);
      if (!active) return;
      if (gameRes.error || !gameRes.data) {
        toast.error(`Couldn't load game: ${gameRes.error?.message ?? "not found"}`);
        setGame(null);
      } else {
        setGame(gameRes.data as GameRow);
      }
      if (rosterRes.error) {
        toast.error(`Couldn't load roster: ${rosterRes.error.message}`);
      } else {
        const rows = (rosterRes.data ?? []) as unknown as Array<{
          jersey_number: string | null;
          position: string | null;
          players: { id: string; first_name: string; last_name: string };
        }>;
        setRoster(rows.map((r) => ({
          id: r.players.id,
          first_name: r.players.first_name,
          last_name: r.players.last_name,
          jersey_number: r.jersey_number,
          primary_position: r.position,
        })));
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [gameId, team.id]);

  if (loading) {
    return <div className="container mx-auto px-6 py-12 text-muted-foreground">Loading…</div>;
  }
  if (!game) {
    return (
      <div className="container mx-auto px-6 py-12">
        <p className="font-display text-2xl text-sa-blue-deep mb-2">Game not found</p>
        <Link href={base} className="text-sa-orange hover:underline text-sm">Back to score picker</Link>
      </div>
    );
  }
  if (game.team_id !== team.id) {
    return (
      <div className="container mx-auto px-6 py-12">
        <p className="font-display text-2xl text-sa-blue-deep mb-2">Not your game</p>
        <p className="text-sm text-muted-foreground">This game belongs to a different team.</p>
      </div>
    );
  }

  return (
    <main className="container mx-auto px-6 py-8 space-y-6">
      <GameHeader game={game} backHref={base} />
      {game.status === "draft" && (
        <PreGameForm
          game={game}
          roster={roster}
          onStarted={() => setGame({ ...game, status: "in_progress" })}
        />
      )}
      {game.status === "in_progress" && <LiveScoring gameId={game.id} />}
      {game.status === "final" && <FinalStub game={game} />}
    </main>
  );
}

function GameHeader({ game, backHref }: { game: GameRow; backHref: string }) {
  return (
    <header className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <Link href={backHref} className="text-xs text-muted-foreground hover:text-sa-orange uppercase tracking-wider">
          ← Score picker
        </Link>
        <p className="text-sm text-muted-foreground mt-1">
          {new Date(game.game_date + "T12:00:00").toLocaleDateString(undefined, {
            weekday: "long", month: "short", day: "numeric",
          })}
          {game.game_time ? ` · ${game.game_time.slice(0, 5)}` : ""}
        </p>
        <h2 className="font-display text-3xl text-sa-blue-deep">
          {game.location === "home" ? "vs" : game.location === "away" ? "@" : "neutral"}{" "}
          <span className="font-bold">{game.opponent}</span>
        </h2>
      </div>
      <Badge variant={game.status === "in_progress" ? "default" : game.status === "final" ? "outline" : "secondary"} className="uppercase">
        {game.status === "in_progress" ? "Live" : game.status === "final" ? "Final" : "Draft"}
      </Badge>
    </header>
  );
}

interface SlotState {
  batting_order: number;
  player_id: string | null;
  position: Position | null;
}

const emptyLineup = (): SlotState[] =>
  Array.from({ length: 9 }, (_, i) => ({ batting_order: i + 1, player_id: null, position: null }));

function PreGameForm({
  game,
  roster,
  onStarted,
}: {
  game: GameRow;
  roster: RosterPlayer[];
  onStarted: () => void;
}) {
  const [useDh, setUseDh] = useState(true);
  const [lineup, setLineup] = useState<SlotState[]>(emptyLineup);
  const [pitcherId, setPitcherId] = useState<string | null>(null);
  const [opposingPitcher, setOpposingPitcher] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const weAreHome = game.location === "home" || game.location === "neutral";

  const updateSlot = (idx: number, patch: Partial<SlotState>) => {
    setLineup((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const validate = (): string | null => {
    const filled = lineup.filter((s) => s.player_id);
    if (filled.length !== 9) return "All 9 lineup slots need a player.";
    const ids = filled.map((s) => s.player_id);
    if (new Set(ids).size !== ids.length) return "A player can only appear once in the lineup.";
    const missingPos = lineup.find((s) => s.player_id && !s.position);
    if (missingPos) return `Slot ${missingPos.batting_order} needs a position.`;
    if (useDh && !pitcherId) return "Pick a starting pitcher.";
    if (!useDh && !lineup.some((s) => s.position === "P")) {
      return "Without DH, one of the 9 batters must play P.";
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    const startingPitcherId =
      useDh ? pitcherId : (lineup.find((s) => s.position === "P")?.player_id ?? null);

    const lineupPayload: LineupSlot[] = lineup.map((s) => ({
      batting_order: s.batting_order,
      player_id: s.player_id,
      position: s.position,
    }));

    const payload: GameStartedPayload = {
      we_are_home: weAreHome,
      use_dh: useDh,
      starting_lineup: lineupPayload,
      starting_pitcher_id: startingPitcherId,
      opponent_starting_pitcher_id: null,
    };

    setSubmitting(true);
    let opponentPitcherId: string | null = null;
    const oppName = opposingPitcher.trim();
    if (oppName) {
      const { data, error } = await supabase
        .from("game_opponent_pitchers")
        .insert({ game_id: game.id, name: oppName })
        .select("id")
        .single();
      if (error || !data) {
        setSubmitting(false);
        toast.error(`Couldn't save opposing pitcher: ${error?.message ?? "unknown"}`);
        return;
      }
      opponentPitcherId = data.id;
    }

    const eventPayload: GameStartedPayload = {
      ...payload,
      opponent_starting_pitcher_id: opponentPitcherId,
    };

    const res = await fetch(`/api/games/${game.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_event_id: `gs-${game.id}`,
        sequence_number: 1,
        event_type: "game_started",
        payload: eventPayload,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      toast.error(`Couldn't start game: ${detail.error ?? res.statusText}`);
      return;
    }
    toast.success("Game started");
    onStarted();
  };

  const usedIds = new Set(lineup.map((s) => s.player_id).filter(Boolean) as string[]);

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-display text-2xl text-sa-blue-deep">Pre-game setup</h3>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={useDh} onCheckedChange={(v) => setUseDh(!!v)} />
          Use DH
        </label>
      </div>

      <div>
        <h4 className="font-display text-sm uppercase tracking-wider text-sa-blue mb-3">Batting order</h4>
        <div className="space-y-2">
          {lineup.map((slot, i) => (
            <div key={slot.batting_order} className="grid grid-cols-12 items-center gap-2">
              <div className="col-span-1 text-right font-mono-stat font-bold text-sa-blue-deep">
                {slot.batting_order}
              </div>
              <div className="col-span-7">
                <Select
                  value={slot.player_id ?? ""}
                  onValueChange={(v) => updateSlot(i, { player_id: v || null })}
                >
                  <SelectTrigger><SelectValue placeholder="— pick player —" /></SelectTrigger>
                  <SelectContent>
                    {roster
                      .filter((p) => !usedIds.has(p.id) || p.id === slot.player_id)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>{playerLabel(p)}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4">
                <Select
                  value={slot.position ?? ""}
                  onValueChange={(v) => updateSlot(i, { position: (v || null) as Position | null })}
                  disabled={!slot.player_id}
                >
                  <SelectTrigger><SelectValue placeholder="position" /></SelectTrigger>
                  <SelectContent>
                    {POSITIONS.filter((pos) => pos !== "DH" || useDh).map((pos) => (
                      <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
      </div>

      {useDh && (
        <div className="max-w-md">
          <Label>Starting pitcher (with DH, batting separately)</Label>
          <Select value={pitcherId ?? ""} onValueChange={(v) => setPitcherId(v || null)}>
            <SelectTrigger><SelectValue placeholder="— pick pitcher —" /></SelectTrigger>
            <SelectContent>
              {roster
                .filter((p) => !usedIds.has(p.id))
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>{playerLabel(p)}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="max-w-md">
        <Label htmlFor="opp-pitch">Opposing starting pitcher (optional)</Label>
        <Input
          id="opp-pitch"
          placeholder="e.g. Smith"
          value={opposingPitcher}
          onChange={(e) => setOpposingPitcher(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3 pt-2 border-t">
        <Button onClick={submit} disabled={submitting} className="bg-sa-orange hover:bg-sa-orange/90">
          {submitting ? "Starting…" : "Start game"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {weAreHome ? "We bat in the bottom of each inning." : "We bat in the top of each inning."}
        </p>
      </div>
    </Card>
  );
}

function FinalStub({ game }: { game: GameRow }) {
  return (
    <Card className="p-6 space-y-2">
      <h3 className="font-display text-xl text-sa-blue-deep">Game complete</h3>
      <p className="font-mono-stat text-3xl text-sa-blue-deep">
        {game.team_score ?? "—"} <span className="text-muted-foreground">–</span> {game.opponent_score ?? "—"}
      </p>
    </Card>
  );
}
