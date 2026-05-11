"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTeam } from "@/lib/contexts/team";
import { useSchool } from "@/lib/contexts/school";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { currentSeasonYear } from "@/lib/season";
import { formatGameTime } from "@/lib/date-display";
import type { GameStatus, GameLocation, Json } from "@/integrations/supabase/types";
import type { GameStartedPayload, LineupSlot, OpposingLineupSlot } from "@/lib/scoring/types";
import { LiveScoring } from "@/components/scoring/LiveScoring";
import { OpposingLineupPicker } from "@/components/score/OpposingLineupPicker";
import { buildEmpty, slotHasIdentity, toLineupSlot, type OpposingSlotDraft } from "@/lib/opponents/lineup-sources";

interface GameRow {
  id: string;
  team_id: string;
  game_date: string;
  game_time: string | null;
  opponent: string;
  opponent_team_id: string | null;
  location: GameLocation;
  status: GameStatus;
  team_score: number | null;
  opponent_score: number | null;
  finalized_at: string | null;
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
          .select("id, team_id, game_date, game_time, opponent, opponent_team_id, location, status, team_score, opponent_score, finalized_at")
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
      {game.status === "in_progress" && (
        <LiveScoring
          gameId={game.id}
          roster={roster}
          teamShortLabel={school.short_name ?? school.name}
          opponentName={game.opponent}
        />
      )}
      {game.status === "final" && (
        <FinalStub
          game={game}
          onUnfinalized={() => setGame({ ...game, status: "in_progress", finalized_at: null })}
        />
      )}
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
          {game.game_time ? ` · ${formatGameTime(game.game_time)}` : ""}
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

const MIN_LINEUP_SIZE = 9;
const MAX_LINEUP_SIZE = 12;

const emptyLineup = (): SlotState[] =>
  Array.from({ length: MIN_LINEUP_SIZE }, (_, i) => ({
    batting_order: i + 1,
    player_id: null,
    position: null,
  }));

function PreGameForm({
  game,
  roster,
  onStarted,
}: {
  game: GameRow;
  roster: RosterPlayer[];
  onStarted: () => void;
}) {
  const { team } = useTeam();
  const { school } = useSchool();
  const [useDh, setUseDh] = useState(true);
  const [lineup, setLineup] = useState<SlotState[]>(emptyLineup);
  const [pitcherId, setPitcherId] = useState<string | null>(null);
  const [opposingDraft, setOpposingDraft] = useState<OpposingSlotDraft[]>(() => buildEmpty());
  const [oppUseDh, setOppUseDh] = useState(true);
  const [opposingPitcher, setOpposingPitcher] = useState("");
  const [opposingPitcherJersey, setOpposingPitcherJersey] = useState("");
  const [opponentIsPublicRoster, setOpponentIsPublicRoster] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Detect whether the opposing school has a public roster so the Pull
  // button can advertise (or hide) the affordance accurately.
  useEffect(() => {
    if (!game.opponent_team_id) {
      setOpponentIsPublicRoster(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("teams")
        .select("schools!inner(is_public_roster)")
        .eq("id", game.opponent_team_id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as unknown as { schools: { is_public_roster: boolean } } | null;
      setOpponentIsPublicRoster(row?.schools.is_public_roster ?? null);
    })();
    return () => { cancelled = true; };
  }, [game.opponent_team_id]);

  const weAreHome = game.location === "home" || game.location === "neutral";

  const updateSlot = (idx: number, patch: Partial<SlotState>) => {
    setLineup((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addSlot = () => {
    setLineup((prev) => {
      if (prev.length >= MAX_LINEUP_SIZE) return prev;
      return [...prev, { batting_order: prev.length + 1, player_id: null, position: null }];
    });
  };

  const removeLastSlot = () => {
    setLineup((prev) => {
      if (prev.length <= MIN_LINEUP_SIZE) return prev;
      return prev.slice(0, -1);
    });
  };

  const validate = (): string | null => {
    const filled = lineup.filter((s) => s.player_id);
    if (filled.length !== lineup.length) {
      return `All ${lineup.length} lineup slots need a player.`;
    }
    const ids = filled.map((s) => s.player_id);
    if (new Set(ids).size !== ids.length) return "A player can only appear once in the lineup.";
    // Slots 1..9 must have a defensive position. Slots 10..12 are extra
    // hitters and may have no position. Pitcher slot rules below.
    const missingPos = lineup.find(
      (s) => s.player_id && !s.position && s.batting_order <= 9,
    );
    if (missingPos) return `Slot ${missingPos.batting_order} needs a position.`;
    if (useDh && !pitcherId) return "Pick a starting pitcher.";
    if (!useDh && !lineup.some((s) => s.position === "P")) {
      return "Without DH, one of the batters must play P.";
    }

    // Opposing-side hard gate: every slot needs jersey OR last name (the
    // identity minimum). Defensive position is optional pre-game.
    const oppMissing = opposingDraft.findIndex((s) => !slotHasIdentity(s));
    if (oppMissing !== -1) {
      return `Opposing slot ${oppMissing + 1} needs a jersey number or last name.`;
    }
    if (oppUseDh && !opposingPitcher.trim() && !opposingPitcherJersey.trim()) {
      return "Opposing starting pitcher: enter a jersey number or last name.";
    }
    if (!oppUseDh && !opposingDraft.some((s) => s.position === "P")) {
      return "Opposing side: without DH, one batting slot must be tagged P.";
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

    setSubmitting(true);

    // Step 1: upsert opponent_players for every opposing slot + the
    // opposing starting pitcher (when present). Single round-trip via RPC.
    // The client_ref maps results back to slot indices.
    type UpsertRow = {
      client_ref: string;
      opponent_team_id: string | null;
      external_player_id: string | null;
      first_name: string | null;
      last_name: string | null;
      jersey_number: string | null;
      bats: string | null;
      throws: string | null;
      grad_year: number | null;
    };

    const upsertRows: UpsertRow[] = opposingDraft.map((s, i) => ({
      client_ref: `slot-${i}`,
      opponent_team_id: s.opponent_team_id,
      external_player_id: s.external_player_id,
      first_name: s.first_name?.trim() || null,
      last_name: s.last_name?.trim() || null,
      jersey_number: s.jersey_number?.trim() || null,
      bats: null,
      throws: null,
      grad_year: null,
    }));

    if (oppUseDh && (opposingPitcher.trim() || opposingPitcherJersey.trim())) {
      upsertRows.push({
        client_ref: "pitcher",
        opponent_team_id: game.opponent_team_id,
        external_player_id: null,
        first_name: null,
        last_name: opposingPitcher.trim() || null,
        jersey_number: opposingPitcherJersey.trim() || null,
        bats: null,
        throws: null,
        grad_year: null,
      });
    }

    const upsertRes = await supabase.rpc("upsert_opponent_players", {
      p_school: school.id,
      p_rows: upsertRows as unknown as Json,
    });
    if (upsertRes.error) {
      setSubmitting(false);
      toast.error(`Couldn't save opposing lineup: ${upsertRes.error.message}`);
      return;
    }
    const idByRef = new Map<string, string>();
    for (const r of upsertRes.data ?? []) {
      idByRef.set(r.client_ref, r.opponent_player_id);
    }

    const opposingLineup: OpposingLineupSlot[] = opposingDraft.map((s, i) => {
      const oppId = idByRef.get(`slot-${i}`) ?? null;
      return toLineupSlot({ ...s, opponent_player_id: oppId });
    });

    // Step 2: opposing starting pitcher. The legacy game_opponent_pitchers
    // table still backs at_bats.opponent_pitcher_id, so we mirror the
    // pitcher row into it (linked to the new opponent_players record via
    // opponent_player_id). Phase 1.5 retires this once at_bats migrates.
    let opponentPitcherId: string | null = null;
    const pitcherOppPlayerId = oppUseDh ? idByRef.get("pitcher") ?? null : null;
    const pitcherDisplayName = oppUseDh
      ? (opposingPitcher.trim() || opposingPitcherJersey.trim())
      : null;
    if (pitcherDisplayName) {
      const { data, error } = await supabase
        .from("game_opponent_pitchers")
        .insert({
          game_id: game.id,
          name: pitcherDisplayName,
          opponent_player_id: pitcherOppPlayerId,
        })
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
      we_are_home: weAreHome,
      use_dh: useDh,
      starting_lineup: lineupPayload,
      starting_pitcher_id: startingPitcherId,
      opponent_starting_pitcher_id: opponentPitcherId,
      opposing_lineup: opposingLineup,
      opponent_use_dh: oppUseDh,
      league_type: team.league_type,
      nfhs_state: team.nfhs_state,
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
  if (pitcherId) usedIds.add(pitcherId);

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
          {lineup.map((slot, i) => {
            const isExtra = slot.batting_order > 9;
            return (
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
                  {isExtra ? (
                    <div className="flex items-center justify-center h-9 px-3 rounded-md border border-dashed text-xs uppercase tracking-wider text-muted-foreground">
                      EH (extra hitter)
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSlot}
            disabled={lineup.length >= MAX_LINEUP_SIZE}
          >
            + Add batting slot
          </Button>
          {lineup.length > MIN_LINEUP_SIZE && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={removeLastSlot}
              disabled={!!lineup[lineup.length - 1]?.player_id}
            >
              − Remove slot {lineup.length}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Slots 10–12 are extra hitters — no defensive position needed.
          </p>
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

      <div className="border-t pt-6">
        <OpposingLineupPicker
          myTeamId={team.id}
          gameId={game.id}
          opponentName={game.opponent}
          opponentTeamId={game.opponent_team_id}
          opponentIsPublicRoster={opponentIsPublicRoster}
          draft={opposingDraft}
          setDraft={setOpposingDraft}
          useDh={oppUseDh}
          setUseDh={setOppUseDh}
          opposingPitcherName={opposingPitcher}
          setOpposingPitcherName={setOpposingPitcher}
          opposingPitcherJersey={opposingPitcherJersey}
          setOpposingPitcherJersey={setOpposingPitcherJersey}
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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function FinalStub({ game, onUnfinalized }: { game: GameRow; onUnfinalized: () => void }) {
  const [submitting, setSubmitting] = useState(false);

  const finalizedAt = game.finalized_at ? new Date(game.finalized_at) : null;
  const eligible =
    finalizedAt !== null && Date.now() - finalizedAt.getTime() < SEVEN_DAYS_MS;

  const handleUnfinalize = async () => {
    if (submitting) return;
    setSubmitting(true);
    const eventsRes = await supabase
      .from("game_events")
      .select("id, event_type, sequence_number")
      .eq("game_id", game.id)
      .order("sequence_number", { ascending: false });
    if (eventsRes.error) {
      setSubmitting(false);
      toast.error(`Couldn't load events: ${eventsRes.error.message}`);
      return;
    }
    const events = (eventsRes.data ?? []) as Array<{
      id: string; event_type: string; sequence_number: number;
    }>;
    const finalizeEvent = events.find((e) => e.event_type === "game_finalized");
    if (!finalizeEvent) {
      setSubmitting(false);
      toast.error("Couldn't find the finalize event for this game.");
      return;
    }
    const nextSeq = (events[0]?.sequence_number ?? 0) + 1;
    const res = await fetch(`/api/games/${game.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_event_id: `unfinal-${nextSeq}`,
        sequence_number: nextSeq,
        event_type: "correction",
        payload: {
          superseded_event_id: finalizeEvent.id,
          corrected_event_type: null,
          corrected_payload: null,
        },
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      toast.error(`Couldn't un-finalize: ${detail.error ?? res.statusText}`);
      return;
    }
    toast.success("Game un-finalized");
    onUnfinalized();
  };

  return (
    <Card className="p-6 space-y-3">
      <h3 className="font-display text-xl text-sa-blue-deep">Game complete</h3>
      <p className="font-mono-stat text-3xl text-sa-blue-deep">
        {game.team_score ?? "—"} <span className="text-muted-foreground">–</span> {game.opponent_score ?? "—"}
      </p>
      {finalizedAt && (
        <p className="text-xs text-muted-foreground">
          Finalized {finalizedAt.toLocaleString()}
        </p>
      )}
      <div className="pt-2 border-t flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          disabled={submitting || !eligible}
          onClick={handleUnfinalize}
          className="border-sa-orange text-sa-orange hover:bg-sa-orange hover:text-white"
        >
          {submitting ? "Un-finalizing…" : "Un-finalize game"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {eligible
            ? "Available for 7 days after finalize. Reopens scoring and clears tablet stat rollups."
            : "Un-finalize is only available within 7 days of finalize."}
        </p>
      </div>
    </Card>
  );
}
