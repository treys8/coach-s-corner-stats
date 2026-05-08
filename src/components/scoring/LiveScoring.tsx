"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { replay } from "@/lib/scoring/replay";
import { defaultAdvances } from "@/lib/scoring/advances";
import { INITIAL_STATE } from "@/lib/scoring/types";
import { FieldTap, type SprayHit } from "./FieldTap";
import type {
  AtBatPayload,
  AtBatResult,
  GameEventRecord,
  PitchingChangePayload,
  ReplayState,
} from "@/lib/scoring/types";
import { toast } from "sonner";

export interface RosterDisplay {
  id: string;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
}

interface LiveScoringProps {
  gameId: string;
  roster: RosterDisplay[];
}

function nameById(roster: RosterDisplay[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of roster) {
    const num = p.jersey_number ? `#${p.jersey_number} ` : "";
    m.set(p.id, `${num}${p.first_name} ${p.last_name}`);
  }
  return m;
}

const supabase = createClient();

// Outcome buttons grouped for layout. Field-tap (spray + fielder position
// capture) is deferred to a follow-up commit; this MVP records the result
// only and infers fielder position from the outcome (e.g., GO → "infield").
const NON_CONTACT: AtBatResult[] = ["K_swinging", "K_looking", "BB", "HBP"];
const HITS: AtBatResult[] = ["1B", "2B", "3B", "HR"];
const OUTS_IN_PLAY: AtBatResult[] = ["FO", "GO", "LO", "PO"];

const RESULT_LABEL: Record<AtBatResult, string> = {
  K_swinging: "K↘", K_looking: "Kᴸ",
  BB: "BB", IBB: "IBB", HBP: "HBP",
  "1B": "1B", "2B": "2B", "3B": "3B", HR: "HR",
  FO: "Fly out", GO: "Ground out", LO: "Line out", PO: "Popout", IF: "Infield fly",
  FC: "FC", SAC: "SAC", SF: "SF", E: "Error", DP: "DP", TP: "TP",
};

const RESULT_DESC: Partial<Record<AtBatResult, string>> = {
  K_swinging: "Strikeout swinging",
  K_looking: "Strikeout looking",
  BB: "Walk", IBB: "Intentional walk", HBP: "Hit by pitch",
  "1B": "Single", "2B": "Double", "3B": "Triple", HR: "Home run",
  FO: "Flyout", GO: "Groundout", LO: "Lineout", PO: "Popout",
};

export function LiveScoring({ gameId, roster }: LiveScoringProps) {
  const router = useRouter();
  const [state, setState] = useState<ReplayState>(INITIAL_STATE);
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [balls, setBalls] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [pitchChangeOpen, setPitchChangeOpen] = useState(false);
  const [pendingSpray, setPendingSpray] = useState<SprayHit | null>(null);
  const names = useMemo(() => nameById(roster), [roster]);

  // Load all events for this game and run replay() to get the canonical
  // live state. Cheap — Phase 1 has at most a few hundred events per game.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("game_events")
        .select("*")
        .eq("game_id", gameId)
        .order("sequence_number", { ascending: true });
      if (!active) return;
      if (error) {
        toast.error(`Couldn't load events: ${error.message}`);
        setLoading(false);
        return;
      }
      const events = (data ?? []) as unknown as GameEventRecord[];
      setState(replay(events));
      setLastSeq(events.reduce((m, e) => Math.max(m, e.sequence_number), 0));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [gameId]);

  const weAreBatting = state.current_batter_slot !== null && isOurHalf(state.we_are_home, state.half);
  const currentSlot = useMemo(
    () => state.our_lineup.find((s) => s.batting_order === state.current_batter_slot) ?? null,
    [state.our_lineup, state.current_batter_slot],
  );

  const submitAtBat = async (result: AtBatResult) => {
    if (submitting) return;
    setSubmitting(true);
    const advances = defaultAdvances(state.bases, weAreBatting ? currentSlot?.player_id ?? null : null, result);
    const runs = advances.filter((a) => a.to === "home").length;
    const { balls: finalBalls, strikes: finalStrikes } = finalCount(result, balls, strikes);

    const payload: AtBatPayload = {
      inning: state.inning,
      half: state.half,
      batter_id: weAreBatting ? currentSlot?.player_id ?? null : null,
      pitcher_id: weAreBatting ? null : state.current_pitcher_id,
      opponent_pitcher_id: weAreBatting ? state.current_opponent_pitcher_id : null,
      batting_order: weAreBatting ? state.current_batter_slot : null,
      result,
      rbi: runs,
      pitch_count: finalBalls + finalStrikes,
      balls: finalBalls,
      strikes: finalStrikes,
      spray_x: isInPlay(result) ? pendingSpray?.x ?? null : null,
      spray_y: isInPlay(result) ? pendingSpray?.y ?? null : null,
      fielder_position: isInPlay(result) ? pendingSpray?.fielder ?? null : null,
      runner_advances: advances,
      description: describePlay(result, runs, currentSlot?.player_id ?? null, names),
    };

    const nextSeq = lastSeq + 1;
    const clientEventId = `ab-${state.inning}-${state.half}-${nextSeq}`;
    const ok = await postEvent(gameId, {
      client_event_id: clientEventId,
      sequence_number: nextSeq,
      event_type: "at_bat",
      payload,
    });
    setSubmitting(false);
    if (!ok) return;

    setBalls(0);
    setStrikes(0);
    setPendingSpray(null);
    await refresh();
  };

  const endHalfInning = async () => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `ie-${state.inning}-${state.half}-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "inning_end",
      payload: { inning: state.inning, half: state.half },
    });
    setSubmitting(false);
    if (!ok) return;
    await refresh();
  };

  const submitPitchingChange = async (newPitcherId: string) => {
    if (submitting) return;
    if (newPitcherId === state.current_pitcher_id) return;
    setSubmitting(true);
    const payload: PitchingChangePayload = {
      out_pitcher_id: state.current_pitcher_id,
      in_pitcher_id: newPitcherId,
    };
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `pc-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "pitching_change",
      payload,
    });
    setSubmitting(false);
    setPitchChangeOpen(false);
    if (!ok) return;
    toast.success(`Pitcher: ${names.get(newPitcherId) ?? "updated"}`);
    await refresh();
  };

  const finalize = async () => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `gf-${gameId}`,
      sequence_number: nextSeq,
      event_type: "game_finalized",
      payload: {},
    });
    setSubmitting(false);
    setConfirmFinalize(false);
    if (!ok) return;
    toast.success("Game finalized");
    // Parent page reads game.status from the games table; trigger a refetch.
    router.refresh();
  };

  const refresh = async () => {
    const { data } = await supabase
      .from("game_events")
      .select("*")
      .eq("game_id", gameId)
      .order("sequence_number", { ascending: true });
    const events = (data ?? []) as unknown as GameEventRecord[];
    setState(replay(events));
    setLastSeq(events.reduce((m, e) => Math.max(m, e.sequence_number), 0));
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading live state…</div>;
  }

  return (
    <div className="space-y-4">
      <TopBar state={state} weAreBatting={weAreBatting} />
      <BatterCard state={state} weAreBatting={weAreBatting} currentSlot={currentSlot} names={names} />
      <BallStrikeCounter
        balls={balls}
        strikes={strikes}
        onBalls={setBalls}
        onStrikes={setStrikes}
      />
      <FieldTap
        pending={pendingSpray}
        onTap={setPendingSpray}
        onClear={() => setPendingSpray(null)}
        disabled={submitting || state.outs >= 3}
      />
      <OutcomeGrid disabled={submitting || state.outs >= 3} onPick={submitAtBat} />
      <FlowControls
        onEndHalf={endHalfInning}
        onPitchingChange={() => setPitchChangeOpen(true)}
        onFinalize={() => setConfirmFinalize(true)}
        disabled={submitting}
        outs={state.outs}
      />
      {state.last_play_text && (
        <Card className="p-3 bg-muted/40 text-sm">
          <span className="text-muted-foreground">Last play: </span>
          {state.last_play_text}
        </Card>
      )}
      <PitchingChangeDialog
        open={pitchChangeOpen}
        onOpenChange={setPitchChangeOpen}
        roster={roster}
        currentPitcherId={state.current_pitcher_id}
        names={names}
        onPick={submitPitchingChange}
        disabled={submitting}
      />
      <FinalizeDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        state={state}
        onConfirm={finalize}
        disabled={submitting}
      />
    </div>
  );
}

// ---- Sub-components --------------------------------------------------------

function TopBar({ state, weAreBatting }: { state: ReplayState; weAreBatting: boolean }) {
  const teamLabel = weAreBatting ? "↑ batting" : "fielding";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="font-mono-stat text-3xl text-sa-blue-deep">
          <span className="text-muted-foreground text-base mr-2">us</span>
          {state.team_score}
          <span className="text-muted-foreground mx-2">–</span>
          {state.opponent_score}
          <span className="text-muted-foreground text-base ml-2">opp</span>
        </div>
        <div className="text-sm text-sa-blue uppercase tracking-wider font-semibold">
          {state.half === "top" ? "Top" : "Bot"} {state.inning} · {state.outs} out{state.outs === 1 ? "" : "s"} · {teamLabel}
        </div>
        <Diamond bases={state.bases} />
      </div>
    </Card>
  );
}

function Diamond({ bases }: { bases: ReplayState["bases"] }) {
  const Base = ({ filled, label }: { filled: boolean; label: string }) => (
    <span
      title={`${label}: ${filled ? "occupied" : "empty"}`}
      className={`inline-block h-4 w-4 border border-sa-blue-deep rotate-45 ${
        filled ? "bg-sa-orange" : "bg-transparent"
      }`}
    />
  );
  return (
    <div className="flex items-center gap-2 text-xs">
      <Base filled={bases.third !== null} label="3rd" />
      <Base filled={bases.second !== null} label="2nd" />
      <Base filled={bases.first !== null} label="1st" />
    </div>
  );
}

function BatterCard({
  state,
  weAreBatting,
  currentSlot,
  names,
}: {
  state: ReplayState;
  weAreBatting: boolean;
  currentSlot: ReplayState["our_lineup"][number] | null;
  names: Map<string, string>;
}) {
  if (!weAreBatting) {
    const pitcherName = state.current_pitcher_id ? names.get(state.current_pitcher_id) : null;
    return (
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Opponent at bat</p>
        <p className="font-display text-xl text-sa-blue-deep">
          Pitching: {pitcherName ?? "(no pitcher set)"}
        </p>
      </Card>
    );
  }
  const batterName = currentSlot?.player_id ? names.get(currentSlot.player_id) : null;
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">At bat — slot {state.current_batter_slot}</p>
      <p className="font-display text-xl text-sa-blue-deep">
        {batterName ?? "(empty slot)"}
        {currentSlot?.position ? <span className="text-muted-foreground text-sm ml-2">{currentSlot.position}</span> : null}
      </p>
    </Card>
  );
}

function BallStrikeCounter({
  balls,
  strikes,
  onBalls,
  onStrikes,
}: {
  balls: number;
  strikes: number;
  onBalls: (n: number) => void;
  onStrikes: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <Counter label="Balls" max={4} value={balls} onChange={onBalls} />
      <Counter label="Strikes" max={3} value={strikes} onChange={onStrikes} />
      <span className="font-mono-stat text-2xl text-sa-blue-deep">{balls}-{strikes}</span>
      <span className="text-xs text-muted-foreground">resets after each at-bat</span>
    </div>
  );
}

function Counter({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground w-12">{label}</span>
      <Button size="sm" variant="outline" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>−</Button>
      <span className="font-mono-stat text-xl w-6 text-center">{value}</span>
      <Button size="sm" variant="outline" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</Button>
    </div>
  );
}

function OutcomeGrid({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
}) {
  return (
    <div className="space-y-2">
      <ButtonRow disabled={disabled} onPick={onPick} results={NON_CONTACT} variant="default" />
      <ButtonRow disabled={disabled} onPick={onPick} results={HITS} variant="hit" />
      <ButtonRow disabled={disabled} onPick={onPick} results={OUTS_IN_PLAY} variant="out" />
    </div>
  );
}

function ButtonRow({
  disabled,
  onPick,
  results,
  variant,
}: {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  results: AtBatResult[];
  variant: "default" | "hit" | "out";
}) {
  const cls =
    variant === "hit"
      ? "bg-sa-orange hover:bg-sa-orange/90 text-white"
      : variant === "out"
        ? "bg-muted hover:bg-muted/80 text-foreground"
        : "bg-sa-blue hover:bg-sa-blue/90 text-white";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {results.map((r) => (
        <Button
          key={r}
          disabled={disabled}
          onClick={() => onPick(r)}
          className={`h-16 text-lg font-bold ${cls}`}
          title={RESULT_DESC[r] ?? r}
        >
          {RESULT_LABEL[r]}
        </Button>
      ))}
    </div>
  );
}

function FlowControls({
  onEndHalf,
  onPitchingChange,
  onFinalize,
  disabled,
  outs,
}: {
  onEndHalf: () => void;
  onPitchingChange: () => void;
  onFinalize: () => void;
  disabled: boolean;
  outs: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
      <Button variant="outline" disabled={disabled} onClick={onEndHalf}>
        End ½ inning
      </Button>
      <Button variant="outline" disabled={disabled} onClick={onPitchingChange}>
        Pitching change
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={onFinalize}
        className="border-sa-orange text-sa-orange hover:bg-sa-orange hover:text-white"
      >
        Finalize game
      </Button>
      {outs >= 3 && (
        <span className="text-xs uppercase tracking-wider text-sa-orange font-semibold">
          3 outs — end the half-inning to continue
        </span>
      )}
    </div>
  );
}

function PitchingChangeDialog({
  open,
  onOpenChange,
  roster,
  currentPitcherId,
  names,
  onPick,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  roster: RosterDisplay[];
  currentPitcherId: string | null;
  names: Map<string, string>;
  onPick: (id: string) => void;
  disabled: boolean;
}) {
  const currentName = currentPitcherId ? names.get(currentPitcherId) : null;
  const candidates = roster.filter((p) => p.id !== currentPitcherId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pitching change</DialogTitle>
          <DialogDescription>
            {currentName ? <>Currently on the mound: <span className="font-semibold">{currentName}</span>. Tap a player to bring them in.</> : <>Tap a player to put them on the mound.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {candidates.map((p) => {
              const num = p.jersey_number ? `#${p.jersey_number} ` : "";
              return (
                <Button
                  key={p.id}
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onPick(p.id)}
                  className="h-14 justify-start text-left"
                >
                  <span className="font-mono-stat text-sa-blue-deep mr-2">{num}</span>
                  <span>{p.first_name} {p.last_name}</span>
                </Button>
              );
            })}
          </div>
          {candidates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No other players on the roster.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinalizeDialog({
  open,
  onOpenChange,
  state,
  onConfirm,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  state: ReplayState;
  onConfirm: () => void;
  disabled: boolean;
}) {
  const result =
    state.team_score > state.opponent_score ? "Win"
    : state.team_score < state.opponent_score ? "Loss"
    : "Tie";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finalize this game?</DialogTitle>
          <DialogDescription>
            The game will appear as final on the public scoreboard. You can un-finalize from the
            schedule page within 7 days if you need to fix something.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-center space-y-1">
          <p className="font-mono-stat text-4xl text-sa-blue-deep">
            {state.team_score} <span className="text-muted-foreground">–</span> {state.opponent_score}
          </p>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{result}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={disabled} onClick={onConfirm} className="bg-sa-orange hover:bg-sa-orange/90">
            {disabled ? "Finalizing…" : "Yes, finalize"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Helpers ---------------------------------------------------------------

function isOurHalf(weAreHome: boolean, half: "top" | "bottom"): boolean {
  return weAreHome ? half === "bottom" : half === "top";
}

// Spray + fielder are only meaningful for outcomes where the ball was put in
// play. Strikeouts, walks, HBPs leave them null even if the user happened to
// tap the field before submitting (defensive — UI clears the tap regardless).
const NON_CONTACT_RESULTS: ReadonlySet<AtBatResult> = new Set([
  "K_swinging", "K_looking", "BB", "IBB", "HBP",
]);

function isInPlay(result: AtBatResult): boolean {
  return !NON_CONTACT_RESULTS.has(result);
}

interface PostBody {
  client_event_id: string;
  sequence_number: number;
  event_type: string;
  payload: unknown;
}

async function postEvent(gameId: string, body: PostBody): Promise<boolean> {
  const res = await fetch(`/api/games/${gameId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    toast.error(`Couldn't save event: ${detail.error ?? res.statusText}`);
    return false;
  }
  return true;
}

// Auto-fill the count to match the outcome. Walks must be 4 balls; strikeouts
// must be 3 strikes. For balls put in play (hits, in-play outs, FC, E,
// sacs, DP/TP), the contact pitch counts as a strike — bump the strike
// count by one if there's room. HBP is treated as neither.
function finalCount(
  result: AtBatResult,
  balls: number,
  strikes: number,
): { balls: number; strikes: number } {
  if (result === "BB" || result === "IBB") return { balls: 4, strikes };
  if (result === "K_swinging" || result === "K_looking") return { balls, strikes: 3 };
  if (result === "HBP") return { balls, strikes };
  // Hits + in-play outs + FC + E + sacs + DP/TP — the in-play pitch is a strike.
  return { balls, strikes: Math.min(3, strikes + 1) };
}

function describePlay(
  result: AtBatResult,
  runs: number,
  batterId: string | null,
  names: Map<string, string>,
): string {
  const base = RESULT_DESC[result] ?? result;
  const who = batterId
    ? ` by ${names.get(batterId) ?? "us"}`
    : " (opp)";
  if (runs === 0) return `${base}${who}`;
  return `${base}${who} — ${runs} run${runs === 1 ? "" : "s"}`;
}
