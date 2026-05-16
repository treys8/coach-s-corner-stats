"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { replay } from "@/lib/scoring/replay";
import { defaultAdvances } from "@/lib/scoring/advances";
import { INITIAL_STATE } from "@/lib/scoring/types";
import { postEvent, type PostBody } from "@/lib/scoring/events-client";
import {
  autoRBI,
  describeEvent,
  describePlay,
  finalCount,
  isInPlay,
  isOurHalf,
} from "@/lib/scoring/at-bat-helpers";
import type {
  AtBatPayload,
  AtBatResult,
  CaughtStealingPayload,
  CorrectionPayload,
  GameEventRecord,
  K3ReachSource,
  PickoffPayload,
  PitchType,
  PitchingChangePayload,
  ReplayState,
  RunnerMovePayload,
  StolenBasePayload,
  SubstitutionPayload,
} from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";
import type { FielderPosition } from "@/components/scoring/DefensiveDiamond";

export interface RosterDisplay {
  id: string;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
}

export interface UseLiveScoringArgs {
  gameId: string;
  roster: RosterDisplay[];
}

export interface RunnerActionTarget {
  base: "first" | "second" | "third";
  runnerId: string | null;
}

const supabase = createClient();

function nameById(roster: RosterDisplay[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of roster) {
    const num = p.jersey_number ? `#${p.jersey_number} ` : "";
    m.set(p.id, `${num}${p.first_name} ${p.last_name}`);
  }
  return m;
}

export function useLiveScoring({ gameId, roster }: UseLiveScoringArgs) {
  const router = useRouter();
  const [state, setState] = useState<ReplayState>(INITIAL_STATE);
  const [events, setEvents] = useState<GameEventRecord[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Distinct from `submitting`: true only while postEvent is mid-backoff
  // after at least one failed attempt. Used by the status bar to show
  // "Retrying…" vs. the usual "Saving…" indicator.
  const [retrying, setRetrying] = useState(false);
  // Track concurrent in-flight posts so a slow retry from an earlier call
  // doesn't drop the indicator while a later post is still going.
  const retryDepth = useRef(0);
  const [armedResult, setArmedResult] = useState<AtBatResult | null>(null);
  const [runnerAction, setRunnerAction] = useState<RunnerActionTarget | null>(null);

  // Wrap postEvent to thread the hook's retrying flag through every call
  // site automatically. All in-hook submitters use this instead of the raw
  // module function.
  const post = useCallback(
    (body: PostBody): Promise<boolean> =>
      postEvent(gameId, body, {
        onRetryingChange: (active) => {
          if (active) {
            retryDepth.current += 1;
            if (retryDepth.current === 1) setRetrying(true);
          } else {
            retryDepth.current = Math.max(0, retryDepth.current - 1);
            if (retryDepth.current === 0) setRetrying(false);
          }
        },
      }),
    [gameId],
  );

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
      const loaded = (data ?? []) as unknown as GameEventRecord[];
      setState(replay(loaded));
      setEvents(loaded);
      setLastSeq(loaded.reduce((m, e) => Math.max(m, e.sequence_number), 0));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [gameId]);

  const weAreBatting = state.current_batter_slot !== null && isOurHalf(state.we_are_home, state.half);
  const currentSlot = useMemo(
    () => state.our_lineup.find((s) => s.batting_order === state.current_batter_slot) ?? null,
    [state.our_lineup, state.current_batter_slot],
  );

  // The most recent event a coach can revert. Walks the event log backwards,
  // skipping void/correction events and events already superseded by a prior
  // correction. `game_started` is intentionally not undoable from the live
  // screen (un-finalize lives on the FinalStub).
  const lastUndoableEvent = useMemo(() => {
    const supersededIds = new Set<string>();
    for (const ev of events) {
      if (ev.event_type === "correction") {
        const p = ev.payload as CorrectionPayload;
        supersededIds.add(p.superseded_event_id);
      }
    }
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.event_type === "correction") continue;
      if (supersededIds.has(ev.id)) continue;
      if (ev.event_type === "game_started") return null;
      return ev;
    }
    return null;
  }, [events]);

  // Returns the new snapshot so callers can act on the post-refresh state
  // synchronously without waiting for React to flush the next render
  // (auto-end-half needs to compare prev vs new outs in the same tick).
  const refresh = async (): Promise<{ state: ReplayState; events: GameEventRecord[] } | null> => {
    const { data, error } = await supabase
      .from("game_events")
      .select("*")
      .eq("game_id", gameId)
      .order("sequence_number", { ascending: true });
    if (error) return null;
    const refreshed = (data ?? []) as unknown as GameEventRecord[];
    const newState = replay(refreshed);
    setState(newState);
    setEvents(refreshed);
    setLastSeq(refreshed.reduce((m, e) => Math.max(m, e.sequence_number), 0));
    return { state: newState, events: refreshed };
  };

  // If a posted event caused outs to cross 3, auto-emit `inning_end` so the
  // coach doesn't have to tap End ½ inning every half.
  const maybeAutoEndHalf = async (
    prevOuts: number,
    snap: { state: ReplayState; events: GameEventRecord[] },
  ) => {
    if (prevOuts >= 3) return;
    if (snap.state.outs < 3) return;
    if (snap.state.status !== "in_progress") return;
    const nextSeq = snap.events.reduce((m, e) => Math.max(m, e.sequence_number), 0) + 1;
    const halfLabel = snap.state.half === "top" ? "Top" : "Bot";
    const inning = snap.state.inning;
    const ok = await post({
      client_event_id: `ie-auto-${inning}-${snap.state.half}-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "inning_end",
      payload: { inning, half: snap.state.half },
    });
    if (!ok) return;
    toast.success(`End ${halfLabel} ${inning}. Tap Undo to revert.`);
    await refresh();
  };

  const submitAtBat = async (
    result: AtBatResult,
    spray: { x: number; y: number; fielder: FielderPosition } | null,
    k3Reach?: K3ReachSource,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    const prevOuts = state.outs;
    const batterId = weAreBatting ? currentSlot?.player_id ?? null : null;
    // K3-reach: pitcher gets the K, batter goes to first instead of being out.
    // Override defaultAdvances with an explicit batter→first plan; downstream
    // RBI logic excludes runs from the tainted batter (E/PB) automatically.
    const advances = k3Reach
      ? [{ from: "batter" as const, to: "first" as const, player_id: batterId }]
      : defaultAdvances(state.bases, batterId, result);
    const runs = advances.filter((a) => a.to === "home").length;
    const rbi = autoRBI(advances, result, state.bases);
    // If pitches are logged for this PA, the engine will derive the final
    // count from them — pass the live values along anyway as a hint, with
    // finalCount() as the no-pitch-trail fallback.
    const trailEmpty = state.current_pa_pitches.length === 0;
    const { balls: finalBalls, strikes: finalStrikes } = trailEmpty
      ? finalCount(result, state.current_balls, state.current_strikes)
      : { balls: state.current_balls, strikes: state.current_strikes };

    const payload: AtBatPayload = {
      inning: state.inning,
      half: state.half,
      batter_id: weAreBatting ? currentSlot?.player_id ?? null : null,
      pitcher_id: weAreBatting ? null : state.current_pitcher_id,
      opponent_pitcher_id: weAreBatting ? state.current_opponent_pitcher_id : null,
      batting_order: weAreBatting ? state.current_batter_slot : null,
      result,
      rbi,
      pitch_count: finalBalls + finalStrikes,
      balls: finalBalls,
      strikes: finalStrikes,
      spray_x: spray?.x ?? null,
      spray_y: spray?.y ?? null,
      fielder_position: spray?.fielder ?? null,
      runner_advances: advances,
      description: describePlay(result, runs, currentSlot?.player_id ?? null, names),
      batter_reached_on_k3: k3Reach,
    };

    const nextSeq = lastSeq + 1;
    const clientEventId = `ab-${state.inning}-${state.half}-${nextSeq}`;
    const ok = await post({
      client_event_id: clientEventId,
      sequence_number: nextSeq,
      event_type: "at_bat",
      payload,
    });
    if (!ok) {
      setSubmitting(false);
      return;
    }
    setArmedResult(null);
    const snap = await refresh();
    if (snap) await maybeAutoEndHalf(prevOuts, snap);
    setSubmitting(false);
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

  // If this pitch closes the at-bat, auto-emit the corresponding outcome
  // with the next sequence number so the coach doesn't have to tap BB/K/HBP
  // after filling the count.
  const closingResultForPitch = (pitchType: PitchType): AtBatResult | null => {
    if (pitchType === "ball" && state.current_balls === 3) return "BB";
    if (pitchType === "pitchout" && state.current_balls === 3) return "BB";
    if (pitchType === "intentional_ball" && state.current_balls === 3) return "IBB";
    if (pitchType === "called_strike" && state.current_strikes === 2) return "K_looking";
    if (pitchType === "swinging_strike" && state.current_strikes === 2) return "K_swinging";
    if (pitchType === "foul_tip_caught" && state.current_strikes === 2) return "K_swinging";
    if (pitchType === "hbp") return "HBP";
    return null;
  };

  const submitPitch = async (pitchType: PitchType) => {
    if (submitting) return;
    setSubmitting(true);
    const prevOuts = state.outs;
    const baseSeq = lastSeq + 1;
    const okPitch = await post({
      client_event_id: `pitch-${baseSeq}`,
      sequence_number: baseSeq,
      event_type: "pitch",
      payload: { pitch_type: pitchType },
    });
    if (!okPitch) {
      setSubmitting(false);
      return;
    }

    const closing = closingResultForPitch(pitchType);
    if (closing) {
      const batterId = weAreBatting ? currentSlot?.player_id ?? null : null;
      const advances = defaultAdvances(state.bases, batterId, closing);
      const runs = advances.filter((a) => a.to === "home").length;
      const rbi = autoRBI(advances, closing, state.bases);
      const fallback = finalCount(closing, state.current_balls, state.current_strikes);
      const abPayload: AtBatPayload = {
        inning: state.inning,
        half: state.half,
        batter_id: batterId,
        pitcher_id: weAreBatting ? null : state.current_pitcher_id,
        opponent_pitcher_id: weAreBatting ? state.current_opponent_pitcher_id : null,
        batting_order: weAreBatting ? state.current_batter_slot : null,
        result: closing,
        rbi,
        pitch_count: fallback.balls + fallback.strikes,
        balls: fallback.balls,
        strikes: fallback.strikes,
        spray_x: null,
        spray_y: null,
        fielder_position: null,
        runner_advances: advances,
        description: describePlay(closing, runs, batterId, names),
      };
      const okAB = await post({
        client_event_id: `ab-auto-${state.inning}-${state.half}-${baseSeq + 1}`,
        sequence_number: baseSeq + 1,
        event_type: "at_bat",
        payload: abPayload,
      });
      if (!okAB) {
        // Pitch persisted but the auto-AB didn't. Refresh so the count
        // updates; coach can tap the outcome manually to finish the PA.
        await refresh();
        setSubmitting(false);
        return;
      }
    }

    const snap = await refresh();
    if (snap) await maybeAutoEndHalf(prevOuts, snap);
    setSubmitting(false);
  };

  const onFielderDrop = (x: number, y: number, fielder: FielderPosition) => {
    if (!armedResult) return;
    void submitAtBat(armedResult, { x, y, fielder });
  };

  const submitMidPA = async (
    eventType: GameEventType,
    payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload,
    clientPrefix: string,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    const prevOuts = state.outs;
    const nextSeq = lastSeq + 1;
    const ok = await post({
      client_event_id: `${clientPrefix}-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: eventType,
      payload,
    });
    setRunnerAction(null);
    if (!ok) {
      setSubmitting(false);
      return;
    }
    const snap = await refresh();
    if (snap) await maybeAutoEndHalf(prevOuts, snap);
    setSubmitting(false);
  };

  const endHalfInning = async () => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await post({
      client_event_id: `ie-${state.inning}-${state.half}-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "inning_end",
      payload: { inning: state.inning, half: state.half },
    });
    setSubmitting(false);
    if (!ok) return;
    await refresh();
  };

  // In a non-DH game, the new pitcher must occupy a slot in the batting
  // order. If they're not in the lineup yet, we substitute them into the
  // outgoing pitcher's slot and then record the pitching change. If they're
  // already in the lineup as a fielder, we substitute their slot's position
  // to "P" so the diamond and stats reflect the change.
  const submitPitchingChange = async (newPitcherId: string) => {
    if (submitting) return false;
    if (newPitcherId === state.current_pitcher_id) return false;
    setSubmitting(true);

    const lineupSlotOf = (pid: string | null) =>
      state.our_lineup.find((s) => s.player_id === pid) ?? null;
    const oldSlot = lineupSlotOf(state.current_pitcher_id);
    const newSlot = lineupSlotOf(newPitcherId);

    let leadingSub: SubstitutionPayload | null = null;
    if (!state.use_dh) {
      if (newSlot) {
        leadingSub = {
          out_player_id: newPitcherId,
          in_player_id: newPitcherId,
          batting_order: newSlot.batting_order,
          position: "P",
          sub_type: "regular",
        };
      } else if (oldSlot) {
        leadingSub = {
          out_player_id: state.current_pitcher_id!,
          in_player_id: newPitcherId,
          batting_order: oldSlot.batting_order,
          position: "P",
          sub_type: "regular",
        };
      }
    }

    let nextSeq = lastSeq + 1;
    if (leadingSub) {
      const okSub = await post({
        client_event_id: `sub-pc-${nextSeq}`,
        sequence_number: nextSeq,
        event_type: "substitution",
        payload: leadingSub,
      });
      if (!okSub) {
        setSubmitting(false);
        return false;
      }
      nextSeq += 1;
    }

    const payload: PitchingChangePayload = {
      out_pitcher_id: state.current_pitcher_id,
      in_pitcher_id: newPitcherId,
    };
    const ok = await post({
      client_event_id: `pc-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "pitching_change",
      payload,
    });
    setSubmitting(false);
    if (!ok) return false;
    toast.success(`Pitcher: ${names.get(newPitcherId) ?? "updated"}`);
    await refresh();
    return true;
  };

  const submitMoundVisit = async (): Promise<{ forcedRemoval: boolean }> => {
    if (submitting || !state.current_pitcher_id) return { forcedRemoval: false };
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await post({
      client_event_id: `dc-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "defensive_conference",
      payload: {
        pitcher_id: state.current_pitcher_id,
        inning: state.inning,
      },
    });
    setSubmitting(false);
    if (!ok) return { forcedRemoval: false };
    // After the conference is recorded, alert at the warning thresholds.
    // Count is post-event since refresh() will re-fold from the server.
    const newCount = state.defensive_conferences.filter(
      (c) => c.pitcher_id === state.current_pitcher_id,
    ).length + 1;
    let forcedRemoval = false;
    if (newCount >= 4) {
      toast.warning("4th conference — pitcher must be removed (NFHS 3-4-1)");
      forcedRemoval = true;
    } else if (newCount === 3) {
      toast.warning("3rd conference — next visit forces a pitching change");
    }
    await refresh();
    return { forcedRemoval };
  };

  const submitSubstitution = async (payload: SubstitutionPayload): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await post({
      client_event_id: `sub-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "substitution",
      payload,
    });
    setSubmitting(false);
    if (!ok) return false;
    toast.success(`Sub: ${names.get(payload.in_player_id) ?? "updated"} → slot ${payload.batting_order}`);
    await refresh();
    return true;
  };

  // Edit the most recent at-bat by issuing a correction event. Receives a
  // fully-built corrected payload from the edit dialog (result, count, and
  // per-runner advances all editable).
  const editLastPlay = async (
    supersededEventId: string,
    correctedAtBat: AtBatPayload,
  ): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const correction: CorrectionPayload = {
      superseded_event_id: supersededEventId,
      corrected_event_type: "at_bat",
      corrected_payload: correctedAtBat,
    };
    const nextSeq = lastSeq + 1;
    const ok = await post({
      client_event_id: `corr-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "correction",
      payload: correction,
    });
    setSubmitting(false);
    if (!ok) return false;
    toast.success("Last play updated");
    await refresh();
    return true;
  };

  const finalize = async (): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await post({
      client_event_id: `gf-${gameId}`,
      sequence_number: nextSeq,
      event_type: "game_finalized",
      payload: {},
    });
    setSubmitting(false);
    if (!ok) return false;
    toast.success("Game finalized");
    router.refresh();
    return true;
  };

  // One-tap undo. Posts a void correction superseding the most recent live
  // event. Undoing a corrected at_bat removes BOTH the original and the
  // correction from replay.
  const submitUndo = async () => {
    if (submitting || !lastUndoableEvent) return;
    setSubmitting(true);
    const target = lastUndoableEvent;
    const label = describeEvent(target, names);
    const nextSeq = lastSeq + 1;
    const ok = await post({
      client_event_id: `undo-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "correction",
      payload: {
        superseded_event_id: target.id,
        corrected_event_type: null,
        corrected_payload: null,
      } as CorrectionPayload,
    });
    if (!ok) {
      setSubmitting(false);
      return;
    }
    toast.success(`Undid: ${label}`);
    // Hold the submitting flag through refresh so `events` updates before
    // a fast double-tap can re-target the same event.
    await refresh();
    setSubmitting(false);
  };

  return {
    state,
    loading,
    submitting,
    retrying,
    names,
    weAreBatting,
    currentSlot,
    lastUndoableEvent,
    armedResult,
    setArmedResult,
    runnerAction,
    setRunnerAction,
    onOutcomePicked,
    submitAtBat,
    submitPitch,
    onFielderDrop,
    submitMidPA,
    endHalfInning,
    submitPitchingChange,
    submitMoundVisit,
    submitSubstitution,
    editLastPlay,
    finalize,
    submitUndo,
  };
}
