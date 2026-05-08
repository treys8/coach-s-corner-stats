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
import type {
  AtBatPayload,
  AtBatResult,
  GameEventRecord,
  ReplayState,
} from "@/lib/scoring/types";
import { toast } from "sonner";

interface LiveScoringProps {
  gameId: string;
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

export function LiveScoring({ gameId }: LiveScoringProps) {
  const router = useRouter();
  const [state, setState] = useState<ReplayState>(INITIAL_STATE);
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pitchCount, setPitchCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);

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

    const payload: AtBatPayload = {
      inning: state.inning,
      half: state.half,
      batter_id: weAreBatting ? currentSlot?.player_id ?? null : null,
      pitcher_id: weAreBatting ? null : state.current_pitcher_id,
      opponent_pitcher_id: weAreBatting ? state.current_opponent_pitcher_id : null,
      batting_order: weAreBatting ? state.current_batter_slot : null,
      result,
      rbi: runs,
      pitch_count: pitchCount,
      spray_x: null,
      spray_y: null,
      fielder_position: null,
      runner_advances: advances,
      description: describePlay(result, runs, currentSlot?.player_id ?? null),
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

    setPitchCount(0);
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
      <BatterCard state={state} weAreBatting={weAreBatting} currentSlot={currentSlot} />
      <PitchCounter value={pitchCount} onChange={setPitchCount} />
      <OutcomeGrid disabled={submitting || state.outs >= 3} onPick={submitAtBat} />
      <FlowControls
        onEndHalf={endHalfInning}
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
}: {
  state: ReplayState;
  weAreBatting: boolean;
  currentSlot: ReplayState["our_lineup"][number] | null;
}) {
  if (!weAreBatting) {
    return (
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Opponent at bat</p>
        <p className="font-display text-xl text-sa-blue-deep">
          Pitching: {state.current_pitcher_id ? "our P" : "(no pitcher set)"}
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">At bat — slot {state.current_batter_slot}</p>
      <p className="font-display text-xl text-sa-blue-deep">
        {currentSlot?.player_id ? `Player ${currentSlot.player_id.slice(0, 8)}…` : "(empty slot)"}
        {currentSlot?.position ? <span className="text-muted-foreground text-sm ml-2">{currentSlot.position}</span> : null}
      </p>
    </Card>
  );
}

function PitchCounter({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">Pitches</span>
      <Button size="sm" variant="outline" onClick={() => onChange(Math.max(0, value - 1))}>−</Button>
      <span className="font-mono-stat text-xl w-8 text-center">{value}</span>
      <Button size="sm" variant="outline" onClick={() => onChange(value + 1)}>+</Button>
      <span className="text-xs text-muted-foreground">resets after each at-bat</span>
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
  onFinalize,
  disabled,
  outs,
}: {
  onEndHalf: () => void;
  onFinalize: () => void;
  disabled: boolean;
  outs: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
      <Button variant="outline" disabled={disabled} onClick={onEndHalf}>
        End ½ inning
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

function describePlay(result: AtBatResult, runs: number, batterId: string | null): string {
  const base = RESULT_DESC[result] ?? result;
  const who = batterId ? "" : " (opp)";
  if (runs === 0) return `${base}${who}`;
  return `${base}${who} — ${runs} run${runs === 1 ? "" : "s"}`;
}
