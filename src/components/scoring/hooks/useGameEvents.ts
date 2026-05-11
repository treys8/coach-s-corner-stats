"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { replay } from "@/lib/scoring/replay";
import { defaultAdvances } from "@/lib/scoring/advances";
import { INITIAL_STATE } from "@/lib/scoring/types";
import type {
  AtBatPayload,
  AtBatResult,
  CorrectionPayload,
  GameEventRecord,
  PitchingChangePayload,
  ReplayState,
  SubstitutionPayload,
} from "@/lib/scoring/types";
import type { FielderPosition } from "@/components/scoring/DefensiveDiamond";
import { isInPlay } from "../shared/constants";
import {
  describePlay,
  finalCount,
  isOurHalf,
  nameById,
  postEvent,
  type RosterDisplay,
} from "../shared/lib";

const supabase = createClient();

export function useGameEvents({
  gameId,
  roster,
}: {
  gameId: string;
  roster: RosterDisplay[];
}) {
  const router = useRouter();
  const [state, setState] = useState<ReplayState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [balls, setBalls] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [armedResult, setArmedResult] = useState<AtBatResult | null>(null);
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
      setLoading(false);
    })();
    return () => { active = false; };
  }, [gameId]);

  const weAreBatting = state.current_batter_slot !== null && isOurHalf(state.we_are_home, state.half);
  const currentSlot = useMemo(
    () => state.our_lineup.find((s) => s.batting_order === state.current_batter_slot) ?? null,
    [state.our_lineup, state.current_batter_slot],
  );

  const submitAtBat = async (
    result: AtBatResult,
    spray: { x: number; y: number; fielder: FielderPosition } | null,
  ) => {
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
      spray_x: spray?.x ?? null,
      spray_y: spray?.y ?? null,
      fielder_position: spray?.fielder ?? null,
      runner_advances: advances,
      description: describePlay(result, runs, currentSlot?.player_id ?? null, names),
    };

    const applied = await postEvent(gameId, {
      client_event_id: crypto.randomUUID(),
      event_type: "at_bat",
      payload,
    });
    setSubmitting(false);
    if (!applied) return;

    setBalls(0);
    setStrikes(0);
    setArmedResult(null);
    setState(applied.live_state);
  };

  const onOutcomePicked = (result: AtBatResult) => {
    if (submitting) return;
    if (isInPlay(result)) {
      // Arm drag mode on the diamond; drop will capture spray + fielder.
      setArmedResult(result);
      return;
    }
    void submitAtBat(result, null);
  };

  const onFielderDrop = (x: number, y: number, fielder: FielderPosition) => {
    if (!armedResult) return;
    void submitAtBat(armedResult, { x, y, fielder });
  };

  const endHalfInning = async () => {
    if (submitting) return;
    setSubmitting(true);
    const applied = await postEvent(gameId, {
      client_event_id: crypto.randomUUID(),
      event_type: "inning_end",
      payload: { inning: state.inning, half: state.half },
    });
    setSubmitting(false);
    if (!applied) return;
    setState(applied.live_state);
  };

  const submitPitchingChange = async (newPitcherId: string) => {
    if (submitting) return;
    if (newPitcherId === state.current_pitcher_id) return;
    setSubmitting(true);
    const payload: PitchingChangePayload = {
      out_pitcher_id: state.current_pitcher_id,
      in_pitcher_id: newPitcherId,
    };
    const applied = await postEvent(gameId, {
      client_event_id: crypto.randomUUID(),
      event_type: "pitching_change",
      payload,
    });
    setSubmitting(false);
    if (!applied) return;
    toast.success(`Pitcher: ${names.get(newPitcherId) ?? "updated"}`);
    setState(applied.live_state);
  };

  const submitSubstitution = async (payload: SubstitutionPayload) => {
    if (submitting) return;
    setSubmitting(true);
    const applied = await postEvent(gameId, {
      client_event_id: crypto.randomUUID(),
      event_type: "substitution",
      payload,
    });
    setSubmitting(false);
    if (!applied) return;
    toast.success(`Sub: ${names.get(payload.in_player_id) ?? "updated"} → slot ${payload.batting_order}`);
    setState(applied.live_state);
  };

  // Edit the most recent at-bat by issuing a correction event. Recomputes
  // runner advances against the bases as they were before that play, so a
  // 1B → 2B edit (etc.) updates scoring/outs/bases consistently after replay.
  const editLastPlay = async (newResult: AtBatResult) => {
    if (submitting) return;
    const last = state.at_bats[state.at_bats.length - 1];
    if (!last) return;
    setSubmitting(true);

    const { data, error } = await supabase
      .from("game_events")
      .select("*")
      .eq("game_id", gameId)
      .order("sequence_number", { ascending: true });
    if (error) {
      setSubmitting(false);
      toast.error(`Couldn't load events: ${error.message}`);
      return;
    }
    const events = (data ?? []) as unknown as GameEventRecord[];
    const target = events.find((e) => e.id === last.event_id);
    if (!target) {
      setSubmitting(false);
      toast.error("Couldn't find the original event to correct.");
      return;
    }
    const before = events.filter((e) => e.sequence_number < target.sequence_number);
    const stateBefore = replay(before);
    const newAdvances = defaultAdvances(stateBefore.bases, last.batter_id, newResult);
    const rbi = newAdvances.filter((a) => a.to === "home").length;

    const correctedAtBat: AtBatPayload = {
      inning: last.inning,
      half: last.half,
      batter_id: last.batter_id,
      pitcher_id: last.pitcher_id,
      opponent_pitcher_id: last.opponent_pitcher_id,
      batting_order: last.batting_order,
      result: newResult,
      rbi,
      pitch_count: last.pitch_count,
      balls: last.balls,
      strikes: last.strikes,
      spray_x: last.spray_x,
      spray_y: last.spray_y,
      fielder_position: last.fielder_position,
      runner_advances: newAdvances,
      description: describePlay(newResult, rbi, last.batter_id, names),
    };

    const correction: CorrectionPayload = {
      superseded_event_id: target.id,
      corrected_event_type: "at_bat",
      corrected_payload: correctedAtBat,
    };

    const applied = await postEvent(gameId, {
      client_event_id: crypto.randomUUID(),
      event_type: "correction",
      payload: correction,
    });
    setSubmitting(false);
    if (!applied) return;
    toast.success("Last play updated");
    setState(applied.live_state);
  };

  const finalize = async () => {
    if (submitting) return;
    setSubmitting(true);
    // Deterministic id: retrying "finalize" must idempotent-collide.
    const applied = await postEvent(gameId, {
      client_event_id: `gf-${gameId}`,
      event_type: "game_finalized",
      payload: {},
    });
    setSubmitting(false);
    if (!applied) return;
    toast.success("Game finalized");
    // Parent page reads game.status from the games table; trigger a refetch.
    router.refresh();
  };

  return {
    state,
    loading,
    balls, setBalls,
    strikes, setStrikes,
    submitting,
    armedResult, setArmedResult,
    weAreBatting,
    currentSlot,
    names,
    onOutcomePicked,
    onFielderDrop,
    submitAtBat,
    endHalfInning,
    submitPitchingChange,
    submitSubstitution,
    editLastPlay,
    finalize,
  };
}
