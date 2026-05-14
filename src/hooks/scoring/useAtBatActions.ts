"use client";

import { useState } from "react";
import { defaultAdvances } from "@/lib/scoring/advances";
import { postEvent } from "@/lib/scoring/events-client";
import {
  autoRBI,
  describePlay,
  finalCount,
  isInPlay,
} from "@/lib/scoring/at-bat-helpers";
import type {
  AtBatPayload,
  AtBatResult,
  K3ReachSource,
  PitchType,
  ReplayState,
} from "@/lib/scoring/types";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";
import type { FielderPosition } from "@/components/scoring/DefensiveDiamond";
import type { UseGameEventsResult } from "./useGameEvents";
import { announceAutoEndHalf } from "./useGameEvents";

// Sentinel marking the gap between "In play" tap on PitchPad and the user
// picking the actual outcome. Banner + OutcomeGrid both light up to direct
// the next tap at an in-play option, but no drag/fielder UI engages until
// the outcome is chosen (which transitions armedResult to a real AtBatResult).
export const ARMED_IN_PLAY_PENDING = "IN_PLAY_PENDING" as const;
export type ArmedState = AtBatResult | typeof ARMED_IN_PLAY_PENDING;

export interface UseAtBatActionsArgs {
  gameId: string;
  state: ReplayState;
  lastSeq: number;
  names: Map<string, string>;
  weAreBatting: boolean;
  currentSlot: ReplayState["our_lineup"][number] | null;
  currentOpponentBatterId: string | null;
  submitting: boolean;
  setSubmitting: UseGameEventsResult["setSubmitting"];
  applyPostResult: UseGameEventsResult["applyPostResult"];
  applyOptimistic: UseGameEventsResult["applyOptimistic"];
  rollbackOptimistic: UseGameEventsResult["rollbackOptimistic"];
  opposingProfileCache?: Map<string, OpposingBatterProfile>;
}

/** Additive fields the In Play sheet can attach to an armed result. Threaded
 *  from `onOutcomePicked` through `armedExtras` to the final `submitAtBat`
 *  call so the drag-to-fielder flow preserves them. Today only `foul_out` —
 *  Stage 3 will add `fielder_chain`, `batted_ball_type`, `error_step_index`. */
export interface AtBatExtras {
  foul_out?: boolean;
}

export interface UseAtBatActionsResult {
  armedResult: ArmedState | null;
  setArmedResult: (v: ArmedState | null) => void;
  onOutcomePicked: (result: AtBatResult, extras?: AtBatExtras) => void;
  submitAtBat: (
    result: AtBatResult,
    spray: { x: number; y: number; fielder: FielderPosition } | null,
    k3Reach?: K3ReachSource,
    extras?: AtBatExtras,
  ) => Promise<void>;
  submitPitch: (pitchType: PitchType) => Promise<void>;
  onFielderDrop: (x: number, y: number, fielder: FielderPosition) => void;
  /** Commit the armed result with no spray. Reads internal armedResult +
   *  armedExtras so the caller doesn't need to know which extras were
   *  stashed on outcome selection (foul_out, etc). No-op if no live arm. */
  skipLocation: () => void;
}

/**
 * At-bat + pitch submission. Owns the armed-result state machine that lets
 * a coach tap an in-play outcome, then drop the fielder on the diamond to
 * capture spray + position.
 */
// Mirrors the server's `closingResultForPitch` predicate. Returns true when
// a tap on `pitchType` against `state` will produce a visible client-side
// change worth applying optimistically. False for closing pitches (would
// briefly show 4-X / X-3 before the chain response replaces state) and for
// hbp / in_play (no count change; the runner advance is in the chained AB,
// not the pitch).
function shouldOptimisticPitch(pitchType: PitchType, state: ReplayState): boolean {
  if (pitchType === "hbp" || pitchType === "in_play") return false;
  if (state.current_balls >= 3) {
    if (pitchType === "ball" || pitchType === "pitchout" || pitchType === "intentional_ball") return false;
  }
  if (state.current_strikes >= 2) {
    if (pitchType === "called_strike" || pitchType === "swinging_strike" || pitchType === "foul_tip_caught") return false;
  }
  return true;
}

export function useAtBatActions({
  gameId,
  state,
  lastSeq,
  names,
  weAreBatting,
  currentSlot,
  currentOpponentBatterId,
  submitting,
  setSubmitting,
  applyPostResult,
  applyOptimistic,
  rollbackOptimistic,
  opposingProfileCache,
}: UseAtBatActionsArgs): UseAtBatActionsResult {
  const [armedResult, setArmedResult] = useState<ArmedState | null>(null);
  // Extras (foul_out, etc) stashed when the in-play outcome is picked, so
  // they ride through the drag-to-fielder gap and land on the AtBatPayload
  // at commit time. Cleared on submit, cancel, or set to null.
  const [armedExtras, setArmedExtras] = useState<AtBatExtras | null>(null);

  const setArmedResultClearing = (v: ArmedState | null) => {
    setArmedResult(v);
    if (v === null) setArmedExtras(null);
  };

  const submitAtBat = async (
    result: AtBatResult,
    spray: { x: number; y: number; fielder: FielderPosition } | null,
    k3Reach?: K3ReachSource,
    extras?: AtBatExtras,
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
      foul_out: extras?.foul_out,
    };

    const clientEventId = `ab-${state.inning}-${state.half}-${nextSeq}`;
    // Optimistic apply: runner_advances + score + new-PA reset all land
    // instantly. The server uses the same defaultAdvances logic so the
    // commit is effectively a no-op visually.
    applyOptimistic({
      id: `pending-${clientEventId}`,
      game_id: gameId,
      client_event_id: clientEventId,
      sequence_number: nextSeq,
      event_type: "at_bat",
      payload,
      supersedes_event_id: null,
      created_at: new Date().toISOString(),
    });
    const postResult = await postEvent(gameId, {
      client_event_id: clientEventId,
      event_type: "at_bat",
      payload,
    });
    if (!postResult.ok) {
      rollbackOptimistic();
      setSubmitting(false);
      return;
    }
    // The just-recorded PA changes this opponent's career line. Drop the
    // cached profile so the next cycle through the lineup refetches.
    if (!weAreBatting && currentOpponentBatterId) {
      opposingProfileCache?.delete(currentOpponentBatterId);
    }
    setArmedResult(null);
    setArmedExtras(null);
    applyPostResult(postResult);
    announceAutoEndHalf(postResult);
    setSubmitting(false);
  };

  const onOutcomePicked = (result: AtBatResult, extras?: AtBatExtras) => {
    if (submitting) return;
    if (isInPlay(result)) {
      // Arm drag mode on the diamond; drop will capture spray + fielder.
      // Transitions out of IN_PLAY_PENDING too — the user picked the
      // specific result, so the banner / grid now reflects it. Stash
      // extras (foul_out, ...) on armedExtras so onFielderDrop can pass
      // them through to submitAtBat.
      setArmedResult(result);
      setArmedExtras(extras ?? null);
      return;
    }
    // Non-in-play outcome (K, BB, HBP, etc.) clears any IN_PLAY_PENDING
    // arm and fires directly. Treats a stray pending arm as user-corrected.
    void submitAtBat(result, null, undefined, extras);
  };

  const submitPitch = async (pitchType: PitchType) => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const clientEventId = `pitch-${nextSeq}`;
    // Optimistic apply for the common case (non-closing ball/strike/foul).
    // Closing pitches and hbp/in_play skip optimistic because applyPitch
    // would briefly produce a count like 4-X / X-3 before the server's
    // chain response replaces state with the new-PA reset.
    const optimistic = shouldOptimisticPitch(pitchType, state);
    if (optimistic) {
      applyOptimistic({
        id: `pending-${clientEventId}`,
        game_id: gameId,
        client_event_id: clientEventId,
        sequence_number: nextSeq,
        event_type: "pitch",
        payload: { pitch_type: pitchType },
        supersedes_event_id: null,
        created_at: new Date().toISOString(),
      });
    }
    // One POST. The server inspects the pre-pitch state and atomically
    // emits the closing at_bat (if the pitch closes the PA) and the
    // inning_end (if the closing PA brings outs to 3). All persisted
    // events come back in result.events for the local fold.
    const result = await postEvent(gameId, {
      client_event_id: clientEventId,
      event_type: "pitch",
      payload: { pitch_type: pitchType },
    });
    if (!result.ok) {
      if (optimistic) rollbackOptimistic();
      setSubmitting(false);
      return;
    }
    // Invalidate cached opposing profile when the chain produced an at_bat
    // — same trigger as submitAtBat, so a 9-deep lineup cycle doesn't
    // surface stale career lines.
    if (
      !weAreBatting &&
      currentOpponentBatterId &&
      result.events.some((e) => e.event_type === "at_bat")
    ) {
      opposingProfileCache?.delete(currentOpponentBatterId);
    }
    applyPostResult(result);
    announceAutoEndHalf(result);
    // Tapping "In play" rolls straight into outcome selection. Setting
    // IN_PLAY_PENDING flags the OutcomeGrid (in-play row prominent, rest
    // dimmed) and the status banner so the coach doesn't have to hunt
    // for the right row on the next tap. Skipped if the server chain
    // already produced an at_bat (HBP closing pitch path, etc).
    if (
      pitchType === "in_play" &&
      !result.events.some((e) => e.event_type === "at_bat")
    ) {
      setArmedResult(ARMED_IN_PLAY_PENDING);
    }
    setSubmitting(false);
  };

  const onFielderDrop = (x: number, y: number, fielder: FielderPosition) => {
    if (!armedResult || armedResult === ARMED_IN_PLAY_PENDING) return;
    void submitAtBat(armedResult, { x, y, fielder }, undefined, armedExtras ?? undefined);
  };

  const skipLocation = () => {
    if (!armedResult || armedResult === ARMED_IN_PLAY_PENDING) return;
    void submitAtBat(armedResult, null, undefined, armedExtras ?? undefined);
  };

  return {
    armedResult,
    setArmedResult: setArmedResultClearing,
    onOutcomePicked,
    submitAtBat,
    submitPitch,
    onFielderDrop,
    skipLocation,
  };
}
