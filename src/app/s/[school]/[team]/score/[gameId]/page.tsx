"use client";

import { use, useEffect, useMemo, useState } from "react";
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

  // In-progress games take over the viewport — no constrained `<main>`
  // container or page-level GameHeader chrome competing for vertical space.
  // LiveScoring sets up its own 100dvh 3-row grid.
  if (game.status === "in_progress") {
    return (
      <LiveScoring
        gameId={game.id}
        roster={roster}
        teamShortLabel={school.short_name ?? school.name}
        opponentName={game.opponent}
        schoolId={school.id}
        myTeamId={team.id}
        gameDate={game.game_date}
        opponentTeamId={game.opponent_team_id}
        backHref={base}
        onFinalized={() =>
          setGame({
            ...game,
            status: "final",
            finalized_at: game.finalized_at ?? new Date().toISOString(),
          })
        }
      />
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

const LINEUP_SIZE = 9;

const FIELDING_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

const emptyLineup = (): SlotState[] =>
  Array.from({ length: LINEUP_SIZE }, (_, i) => ({
    batting_order: i + 1,
    player_id: null,
    position: null,
  }));

// Returns an error message if the lineup has duplicate positions, conflicts
// with the standalone DH-covered fielder, or doesn't cover all 9 fielding
// positions. Pass slot positions in batting order. With DH, exactly one slot
// is "DH" and the standalone box covers dhCoversPos.
function checkLineupPositions(
  slotPositions: Array<string | null>,
  useDh: boolean,
  dhCoversPos: string,
  prefix = "",
): string | null {
  const seen = new Set<string>();
  for (const p of slotPositions) {
    if (!p) continue;
    if (seen.has(p)) {
      return `${prefix}${p} is assigned to more than one batting slot.`;
    }
    seen.add(p);
  }
  if (useDh && seen.has(dhCoversPos)) {
    return `${prefix}${dhCoversPos} is on both a batting slot and the standalone fielder box.`;
  }
  const covered = new Set<string>();
  for (const p of slotPositions) {
    if (p && p !== "DH") covered.add(p);
  }
  if (useDh) covered.add(dhCoversPos);
  const missing = FIELDING_POSITIONS.filter((p) => !covered.has(p));
  if (missing.length > 0) {
    return `${prefix}missing fielding position${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`;
  }
  return null;
}

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
  // Which defensive position our DH bats for. "P" reproduces the classic
  // "DH hits for the pitcher" shape; any other value means the standalone
  // box captures the fielder-not-batting and the pitcher must be in the
  // batting order at position="P".
  const [dhCoversPos, setDhCoversPos] = useState<Position>("P");
  const [opposingDraft, setOpposingDraft] = useState<OpposingSlotDraft[]>(() => buildEmpty());
  const [oppUseDh, setOppUseDh] = useState(true);
  const [oppDhCoversPos, setOppDhCoversPos] = useState<Position>("P");
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

  // Reset DH-cover state when DH is turned off so the standalone box and
  // its position picker can't carry stale values into a non-DH submit.
  useEffect(() => {
    if (!useDh) {
      setDhCoversPos("P");
      setPitcherId(null);
    }
  }, [useDh]);
  useEffect(() => {
    if (!oppUseDh) {
      setOppDhCoversPos("P");
    }
  }, [oppUseDh]);

  const validationError = useMemo<string | null>(() => {
    const filled = lineup.filter((s) => s.player_id);
    if (filled.length !== lineup.length) {
      return `All ${LINEUP_SIZE} lineup slots need a player.`;
    }
    const ids = filled.map((s) => s.player_id);
    if (new Set(ids).size !== ids.length) return "A player can only appear once in the lineup.";
    const missingPos = lineup.find((s) => s.player_id && !s.position);
    if (missingPos) return `Slot ${missingPos.batting_order} needs a position.`;
    if (useDh && !pitcherId) {
      return dhCoversPos === "P"
        ? "Pick a starting pitcher."
        : `Pick the player at ${dhCoversPos}.`;
    }
    const ourPositionError = checkLineupPositions(
      lineup.map((s) => s.position),
      useDh,
      dhCoversPos,
    );
    if (ourPositionError) return ourPositionError;

    // Opposing-side hard gate: every slot needs jersey OR last name (the
    // identity minimum) AND a defensive position.
    const oppMissingIdentity = opposingDraft.findIndex((s) => !slotHasIdentity(s));
    if (oppMissingIdentity !== -1) {
      return `Opposing slot ${oppMissingIdentity + 1} needs a jersey number or last name.`;
    }
    const oppMissingPos = opposingDraft.findIndex((s) => !s.position);
    if (oppMissingPos !== -1) {
      return `Opposing slot ${oppMissingPos + 1} needs a defensive position.`;
    }
    if (oppUseDh && !opposingPitcher.trim() && !opposingPitcherJersey.trim()) {
      return oppDhCoversPos === "P"
        ? "Opposing starting pitcher: enter a jersey number or last name."
        : `Opposing player at ${oppDhCoversPos}: enter a jersey number or last name.`;
    }
    const oppPositionError = checkLineupPositions(
      opposingDraft.map((s) => s.position),
      oppUseDh,
      oppDhCoversPos,
      "Opposing side: ",
    );
    if (oppPositionError) return oppPositionError;
    return null;
  }, [
    lineup,
    pitcherId,
    useDh,
    dhCoversPos,
    opposingDraft,
    oppUseDh,
    oppDhCoversPos,
    opposingPitcher,
    opposingPitcherJersey,
  ]);

  const submit = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const startingPitcherId = useDh
      ? dhCoversPos === "P"
        ? pitcherId
        : (lineup.find((s) => s.position === "P")?.player_id ?? null)
      : (lineup.find((s) => s.position === "P")?.player_id ?? null);

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

    // The standalone opposing box holds the pitcher when DH covers P, and
    // the fielder-only player otherwise. Key the upsert by role so the
    // resolver below can grab the right row.
    const standaloneOppKey: "pitcher" | "fielding-only" =
      oppDhCoversPos === "P" ? "pitcher" : "fielding-only";
    if (oppUseDh && (opposingPitcher.trim() || opposingPitcherJersey.trim())) {
      upsertRows.push({
        client_ref: standaloneOppKey,
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
    //
    // When opp DH covers P, the pitcher is the standalone box. Otherwise
    // the pitcher is the P-tagged batting slot, and the standalone box
    // holds the fielder-only player.
    let opponentPitcherId: string | null = null;
    let opponentFieldingOnlyId: string | null = null;
    let pitcherOppPlayerId: string | null = null;
    let pitcherDisplayName: string | null = null;
    if (oppUseDh && oppDhCoversPos === "P") {
      pitcherOppPlayerId = idByRef.get("pitcher") ?? null;
      pitcherDisplayName =
        opposingPitcher.trim() || opposingPitcherJersey.trim() || null;
    } else if (oppUseDh && oppDhCoversPos !== "P") {
      // DH covers a non-pitcher position. The standalone box holds that
      // fielder-only player; the pitcher is whichever opposing batter is
      // tagged P. Mirror that batter into game_opponent_pitchers so
      // at_bats.opponent_pitcher_id has a row to reference (matches the
      // legacy path for the common DH-for-P case).
      opponentFieldingOnlyId = idByRef.get("fielding-only") ?? null;
      const pIdx = opposingDraft.findIndex((s) => s.position === "P");
      if (pIdx !== -1) {
        const pSlot = opposingDraft[pIdx];
        pitcherOppPlayerId = idByRef.get(`slot-${pIdx}`) ?? null;
        pitcherDisplayName =
          pSlot.last_name?.trim() || pSlot.jersey_number?.trim() || null;
      }
    }
    // When !oppUseDh, today's flow inserts no game_opponent_pitchers row
    // (opponent_starting_pitcher_id stays null). Preserving that for now —
    // it's a separate pre-existing concern.
    if (pitcherDisplayName) {
      // Upsert on (game_id, name) so retrying Start Game (network hiccup,
      // partial save, returning to pre-game) reuses the existing row instead
      // of colliding with the unique constraint.
      const { data, error } = await supabase
        .from("game_opponent_pitchers")
        .upsert(
          {
            game_id: game.id,
            name: pitcherDisplayName,
            opponent_player_id: pitcherOppPlayerId,
          },
          { onConflict: "game_id,name" },
        )
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
      dh_covers_position: useDh ? dhCoversPos : null,
      fielding_only_player_id:
        useDh && dhCoversPos !== "P" ? pitcherId : null,
      opponent_dh_covers_position: oppUseDh ? oppDhCoversPos : null,
      opponent_fielding_only_player_id:
        oppUseDh && oppDhCoversPos !== "P" ? opponentFieldingOnlyId : null,
    };

    const res = await fetch(`/api/games/${game.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_event_id: `gs-${game.id}`,
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
      <h3 className="font-display text-2xl text-sa-blue-deep">Pre-game setup</h3>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="font-display text-sm uppercase tracking-wider text-sa-blue">
              Our lineup ({school.short_name ?? school.name})
            </h4>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={useDh} onCheckedChange={(v) => setUseDh(!!v)} />
              Use DH
            </label>
          </div>

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
                      {POSITIONS.filter((pos) => {
                        // Always keep the current selection in the list so
                        // the trigger can render it after dhCoversPos
                        // changes and would otherwise hide the value.
                        if (pos === slot.position) return true;
                        if (pos === "DH" && !useDh) return false;
                        // The DH-covered position is filled by the
                        // standalone fielder-only player; no batter holds
                        // it.
                        if (useDh && dhCoversPos !== "P" && pos === dhCoversPos) return false;
                        return true;
                      }).map((pos) => (
                        <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>

          {useDh && (
            <div>
              <Label>
                {dhCoversPos === "P"
                  ? "Starting pitcher (with DH, batting separately)"
                  : `Player at ${dhCoversPos} (DH hits for them)`}
              </Label>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-3">
                  <Select
                    value={dhCoversPos}
                    onValueChange={(v) => setDhCoversPos(v as Position)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {POSITIONS.filter((pos) => pos !== "DH").map((pos) => (
                        <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-9">
                  <Select value={pitcherId ?? ""} onValueChange={(v) => setPitcherId(v || null)}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={dhCoversPos === "P" ? "— pick pitcher —" : "— pick fielder —"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {roster
                        .filter((p) => !usedIds.has(p.id) || p.id === pitcherId)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>{playerLabel(p)}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {dhCoversPos === "P"
                  ? "DH bats; pitcher doesn't bat."
                  : `DH bats; the player at ${dhCoversPos} fields but doesn't bat. Pitcher must be in the batting order at P.`}
              </p>
            </div>
          )}
        </section>

        <div className="lg:border-l lg:pl-6 border-t lg:border-t-0 pt-6 lg:pt-0">
          <OpposingLineupPicker
            myTeamId={team.id}
            gameId={game.id}
            gameDate={game.game_date}
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
            dhCoversPos={oppDhCoversPos}
            setDhCoversPos={(v) => setOppDhCoversPos(v as Position)}
          />
        </div>
      </div>

      <div className="pt-4 border-t space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={submit}
            disabled={submitting || validationError !== null}
            className="bg-sa-orange hover:bg-sa-orange/90"
          >
            {submitting ? "Starting…" : "Start game"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {weAreHome ? "We bat in the bottom of each inning." : "We bat in the top of each inning."}
          </p>
        </div>
        {validationError && (
          <p className="text-sm text-amber-600">{validationError}</p>
        )}
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
