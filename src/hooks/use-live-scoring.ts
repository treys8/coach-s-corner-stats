"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { replay } from "@/lib/scoring/replay";
import { defaultAdvances } from "@/lib/scoring/advances";
import { INITIAL_STATE } from "@/lib/scoring/types";
import { postEvent, type PostResult } from "@/lib/scoring/events-client";
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
import type { OpposingBatterProfile } from "@/lib/opponents/profile";
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
  /** Optional cache the orchestrator owns so a recorded opposing PA can
   *  invalidate the just-batted slot's career line (prevents stale data
   *  when cycling through a 9-deep lineup). */
  opposingProfileCache?: Map<string, OpposingBatterProfile>;
}

export interface RunnerActionTarget {
  base: "first" | "second" | "third";
  runnerId: string | null;
}

// Running snapshot threaded between chained applyPostResult calls in the
// same handler. React doesn't update closure-captured state across awaits,
// so without this each subsequent apply would clobber the previous one's
// effect on `events` / `lastSeq`.
interface Snapshot {
  state: ReplayState;
  events: GameEventRecord[];
  lastSeq: number;
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

export function useLiveScoring({ gameId, roster, opposingProfileCache }: UseLiveScoringArgs) {
  const router = useRouter();
  const [state, setState] = useState<ReplayState>(INITIAL_STATE);
  const [events, setEvents] = useState<GameEventRecord[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [armedResult, setArmedResult] = useState<AtBatResult | null>(null);
  const [runnerAction, setRunnerAction] = useState<RunnerActionTarget | null>(null);

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
  const currentOppSlot = useMemo(
    () => state.opposing_lineup.find((s) => s.batting_order === state.current_opp_batter_slot) ?? null,
    [state.opposing_lineup, state.current_opp_batter_slot],
  );
  const currentOpponentBatterId = !weAreBatting ? currentOppSlot?.opponent_player_id ?? null : null;

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

  // Cold-start / fallback path: full DB refetch + replay. Used by the
  // initial-load useEffect and rare callers that mutate via their own fetch
  // (e.g. EditOpposingLineupDialog). The hot path (PA-level submits) skips
  // this — the API already returns the canonical state in `live_state`.
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

  // Fold the server-returned PostResult into local state synchronously.
  // result.events may contain 1–3 events when the server emitted a chain
  // (closing at_bat after a count-closing pitch; auto inning_end on the
  // third out); they're appended in order to the local events array and
  // result.state is the post-chain canonical state.
  //
  // `from` overrides the closure-captured events/lastSeq. Required by the
  // few handlers that still chain locally (submitPitchingChange threads a
  // leading substitution into the pitching_change apply): without it, the
  // second call reads stale closure state and would overwrite the first
  // apply's effect on `events`/`lastSeq`.
  const applyPostResult = (
    result: PostResult,
    from?: { events: GameEventRecord[]; lastSeq: number },
  ): Snapshot | null => {
    if (!result.state) return null;
    const baseEvents = from?.events ?? events;
    const baseLastSeq = from?.lastSeq ?? lastSeq;
    const newEvents = result.events.length > 0
      ? [...baseEvents, ...result.events]
      : baseEvents;
    const newLastSeq = result.events.reduce(
      (m, e) => Math.max(m, e.sequence_number),
      baseLastSeq,
    );
    setState(result.state);
    setEvents(newEvents);
    setLastSeq(newLastSeq);
    return { state: result.state, events: newEvents, lastSeq: newLastSeq };
  };

  // Server-derived auto-end-half: a request that brings outs to 3 returns an
  // inning_end event in the same POST chain (see server.ts applyEvent).
  // The local fold below folds them in order; we surface a toast iff the
  // server actually emitted one.
  const announceAutoEndHalf = (result: PostResult) => {
    const ie = result.events.find((e) => e.event_type === "inning_end");
    if (!ie || !result.state) return;
    // Toast uses the half/inning that JUST ended — read off the inning_end
    // payload, not the post-fold state (state has already advanced).
    const payload = ie.payload as { inning?: number; half?: "top" | "bottom" };
    const inning = payload.inning ?? result.state.inning;
    const half = payload.half ?? result.state.half;
    const halfLabel = half === "top" ? "Top" : "Bot";
    toast.success(`End ${halfLabel} ${inning}. Tap Undo to revert.`);
  };

  const submitAtBat = async (
    result: AtBatResult,
    spray: { x: number; y: number; fielder: FielderPosition } | null,
    k3Reach?: K3ReachSource,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ourBatterId = weAreBatting ? currentSlot?.player_id ?? null : null;
    // ID used for the runner_advance that puts the BATTER on a base.
    // For our team: their roster id (may be null on an empty slot).
    // For the opposing team: prefer their opposing-lineup id (when entered);
    // otherwise synthesize a per-PA id so the base still lights up — the
    // engine's null-guard would otherwise silently drop the runner. Display
    // already falls back to R1/R2/R3 for IDs not in our roster Map.
    const reachId = weAreBatting
      ? ourBatterId
      : currentOpponentBatterId ?? `opp-pa-${state.inning}-${state.half}-${nextSeq}`;
    // K3-reach: pitcher gets the K, batter goes to first instead of being out.
    // Override defaultAdvances with an explicit batter→first plan; downstream
    // RBI logic excludes runs from the tainted batter (E/PB) automatically.
    const advances = k3Reach
      ? [{ from: "batter" as const, to: "first" as const, player_id: reachId }]
      : defaultAdvances(state.bases, reachId, result);
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
      batter_id: ourBatterId,
      opponent_batter_id: currentOpponentBatterId,
      pitcher_id: weAreBatting ? null : state.current_pitcher_id,
      opponent_pitcher_id: weAreBatting ? state.current_opponent_pitcher_id : null,
      batting_order: weAreBatting ? state.current_batter_slot : state.current_opp_batter_slot,
      result,
      rbi,
      pitch_count: finalBalls + finalStrikes,
      balls: finalBalls,
      strikes: finalStrikes,
      spray_x: spray?.x ?? null,
      spray_y: spray?.y ?? null,
      fielder_position: spray?.fielder ?? null,
      runner_advances: advances,
      description: describePlay(result, runs, ourBatterId, names),
      batter_reached_on_k3: k3Reach,
    };

    const clientEventId = `ab-${state.inning}-${state.half}-${nextSeq}`;
    const postResult = await postEvent(gameId, {
      client_event_id: clientEventId,
      event_type: "at_bat",
      payload,
    });
    if (!postResult.ok) {
      setSubmitting(false);
      return;
    }
    // The just-recorded PA changes this opponent's career line. Drop the
    // cached profile so the next cycle through the lineup refetches.
    if (!weAreBatting && currentOpponentBatterId) {
      opposingProfileCache?.delete(currentOpponentBatterId);
    }
    setArmedResult(null);
    applyPostResult(postResult);
    announceAutoEndHalf(postResult);
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

  const submitPitch = async (pitchType: PitchType) => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    // One POST. The server inspects the pre-pitch state and atomically
    // emits the closing at_bat (if the pitch closes the PA) and the
    // inning_end (if the closing PA brings outs to 3). All persisted
    // events come back in result.events for the local fold.
    const result = await postEvent(gameId, {
      client_event_id: `pitch-${nextSeq}`,
      event_type: "pitch",
      payload: { pitch_type: pitchType },
    });
    if (!result.ok) {
      setSubmitting(false);
      return;
    }
    // Invalidate cached opposing profile when the chain produced an at_bat
    // — same trigger as submitAtBat, so a 9-deep lineup cycle doesn't
    // surface stale career lines.
    if (!weAreBatting && currentOpponentBatterId && result.events.some((e) => e.event_type === "at_bat")) {
      opposingProfileCache?.delete(currentOpponentBatterId);
    }
    applyPostResult(result);
    announceAutoEndHalf(result);
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
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `${clientPrefix}-${nextSeq}`,
      event_type: eventType,
      payload,
    });
    setRunnerAction(null);
    if (!result.ok) {
      setSubmitting(false);
      return;
    }
    applyPostResult(result);
    announceAutoEndHalf(result);
    setSubmitting(false);
  };

  const endHalfInning = async () => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `ie-${state.inning}-${state.half}-${nextSeq}`,
      event_type: "inning_end",
      payload: { inning: state.inning, half: state.half },
    });
    setSubmitting(false);
    if (!result.ok) return;
    applyPostResult(result);
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
    let subResult: PostResult | null = null;
    if (leadingSub) {
      subResult = await postEvent(gameId, {
        client_event_id: `sub-pc-${nextSeq}`,
        event_type: "substitution",
        payload: leadingSub,
      });
      if (!subResult.ok) {
        setSubmitting(false);
        return false;
      }
      nextSeq += 1;
    }

    const payload: PitchingChangePayload = {
      out_pitcher_id: state.current_pitcher_id,
      in_pitcher_id: newPitcherId,
    };
    const result = await postEvent(gameId, {
      client_event_id: `pc-${nextSeq}`,
      event_type: "pitching_change",
      payload,
    });
    setSubmitting(false);
    if (!result.ok) {
      // The leading sub already persisted server-side. Reflect it locally so
      // the lineup view stays consistent.
      if (subResult) applyPostResult(subResult);
      return false;
    }
    toast.success(`Pitcher: ${names.get(newPitcherId) ?? "updated"}`);
    // Thread the leading-sub snapshot into the pitching-change apply so the
    // sub event isn't dropped from the local events array.
    const subSnap = subResult ? applyPostResult(subResult) : null;
    if (subSnap) applyPostResult(result, subSnap);
    else applyPostResult(result);
    return true;
  };

  const submitMoundVisit = async (): Promise<{ forcedRemoval: boolean }> => {
    if (submitting || !state.current_pitcher_id) return { forcedRemoval: false };
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `dc-${nextSeq}`,
      event_type: "defensive_conference",
      payload: {
        pitcher_id: state.current_pitcher_id,
        inning: state.inning,
      },
    });
    setSubmitting(false);
    if (!result.ok) return { forcedRemoval: false };
    // Alert at the warning thresholds. The post-fold count comes from the
    // returned state; fall back to the +1 estimate if state is missing.
    const newCount = result.state
      ? result.state.defensive_conferences.filter(
          (c) => c.pitcher_id === state.current_pitcher_id,
        ).length
      : state.defensive_conferences.filter(
          (c) => c.pitcher_id === state.current_pitcher_id,
        ).length + 1;
    let forcedRemoval = false;
    if (newCount >= 4) {
      toast.warning("4th conference — pitcher must be removed (NFHS 3-4-1)");
      forcedRemoval = true;
    } else if (newCount === 3) {
      toast.warning("3rd conference — next visit forces a pitching change");
    }
    applyPostResult(result);
    return { forcedRemoval };
  };

  const submitSubstitution = async (payload: SubstitutionPayload): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `sub-${nextSeq}`,
      event_type: "substitution",
      payload,
    });
    setSubmitting(false);
    if (!result.ok) return false;
    toast.success(`Sub: ${names.get(payload.in_player_id) ?? "updated"} → slot ${payload.batting_order}`);
    applyPostResult(result);
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
    const result = await postEvent(gameId, {
      client_event_id: `corr-${nextSeq}`,
      event_type: "correction",
      payload: correction,
    });
    setSubmitting(false);
    if (!result.ok) return false;
    toast.success("Last play updated");
    applyPostResult(result);
    return true;
  };

  const finalize = async (): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const result = await postEvent(gameId, {
      client_event_id: `gf-${gameId}`,
      event_type: "game_finalized",
      payload: {},
    });
    setSubmitting(false);
    if (!result.ok) return false;
    toast.success("Game finalized");
    applyPostResult(result);
    // The page re-renders FinalStub off `state.status === "final"`, but the
    // server-side `games.status` update needs to land in the SSR snapshot
    // before any subsequent page load. Phase 3 removes this — see plan.
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
    const result = await postEvent(gameId, {
      client_event_id: `undo-${nextSeq}`,
      event_type: "correction",
      payload: {
        superseded_event_id: target.id,
        corrected_event_type: null,
        corrected_payload: null,
      } as CorrectionPayload,
    });
    if (!result.ok) {
      setSubmitting(false);
      return;
    }
    toast.success(`Undid: ${label}`);
    // Hold the submitting flag through the local fold so `events` updates
    // before a fast double-tap can re-target the same event.
    applyPostResult(result);
    setSubmitting(false);
  };

  return {
    state,
    loading,
    submitting,
    names,
    weAreBatting,
    currentSlot,
    currentOppSlot,
    currentOpponentBatterId,
    lastSeq,
    refresh,
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
