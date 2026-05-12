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
  opposingProfileCache?: Map<string, OpposingBatterProfile>;
}

export interface UseAtBatActionsResult {
  armedResult: AtBatResult | null;
  setArmedResult: (v: AtBatResult | null) => void;
  onOutcomePicked: (result: AtBatResult) => void;
  submitAtBat: (
    result: AtBatResult,
    spray: { x: number; y: number; fielder: FielderPosition } | null,
    k3Reach?: K3ReachSource,
  ) => Promise<void>;
  submitPitch: (pitchType: PitchType) => Promise<void>;
  onFielderDrop: (x: number, y: number, fielder: FielderPosition) => void;
}

/**
 * At-bat + pitch submission. Owns the armed-result state machine that lets
 * a coach tap an in-play outcome, then drop the fielder on the diamond to
 * capture spray + position.
 */
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
  opposingProfileCache,
}: UseAtBatActionsArgs): UseAtBatActionsResult {
  const [armedResult, setArmedResult] = useState<AtBatResult | null>(null);

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
    if (
      !weAreBatting &&
      currentOpponentBatterId &&
      result.events.some((e) => e.event_type === "at_bat")
    ) {
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

  return {
    armedResult,
    setArmedResult,
    onOutcomePicked,
    submitAtBat,
    submitPitch,
    onFielderDrop,
  };
}
