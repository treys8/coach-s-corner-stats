"use client";

import { useState } from "react";
import { defaultAdvances } from "@/lib/scoring/advances";
import { postEvent } from "@/lib/scoring/events-client";
import {
  autoRBI,
  chainNotation,
  defaultBattedBallType,
  describePlay,
  finalCount,
  isInPlay,
} from "@/lib/scoring/at-bat-helpers";
import type {
  AtBatPayload,
  AtBatResult,
  BattedBallType,
  FielderTouch,
  K3ReachSource,
  PitchType,
  ReplayState,
  RunnerAdvance,
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
 *  call so the drag-to-fielder flow preserves them. Stage 3 added the
 *  fielder-chain triplet (chain, batted_ball_type, error_step_index) but
 *  those live in dedicated state, not here, since they're built up across
 *  multiple taps. `foul_out` stays as a simple notation hint. */
export interface AtBatExtras {
  foul_out?: boolean;
}

/** First-drag spray + fielder, captured separately from the chain so the
 *  spray chart point stays anchored to where the ball was first touched
 *  even if subsequent drag steps move the focus to other parts of the
 *  field. */
interface SprayCapture {
  x: number;
  y: number;
  fielder: FielderPosition;
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
    chainExtras?: ChainExtras,
    advancesOverride?: RunnerAdvance[],
  ) => Promise<void>;
  submitPitch: (pitchType: PitchType) => Promise<void>;
  /** Drag-and-drop callback from the diamond. First call captures the
   *  spray + first-touch fielder; subsequent calls extend the chain. The
   *  hook converts each drop into a `FielderTouch`, inferring the `target`
   *  base from drop coordinates (when within `BASE_DROP_THRESHOLD`). */
  onFielderDrop: (x: number, y: number, fielder: FielderPosition) => void;
  /** Legacy v1 path: a fielder drop is treated as drop-and-commit (single
   *  chain step, no rail-side Commit button). v2 uses `onFielderDrop` +
   *  `commitArmed` instead so the chain can grow across multiple drops. */
  legacyDirectDrop: (x: number, y: number, fielder: FielderPosition) => void;
  /** Commit the armed result with no spray and no chain. Used by v1's
   *  "Skip location" footer button and v2's rail "Skip location" link
   *  (when the coach armed an outcome but doesn't want to chart the
   *  fielders). No-op if no live arm. */
  skipLocation: () => void;
  /** Stage 3 chain state — read by the rail to render notation, the
   *  batted-ball-type chip, and the Add-error affordance. */
  chain: FielderTouch[];
  battedBallType: BattedBallType | null;
  errorStepIndex: number | null;
  setBattedBallType: (t: BattedBallType | null) => void;
  setErrorStepIndex: (idx: number | null) => void;
  /** Pop the last chain step. Coach uses this when they dropped on the
   *  wrong base; cheaper than cancel + re-arm. */
  undoChainStep: () => void;
  /** Commit the armed at_bat. Threads chain + chip + error_step_index
   *  into the payload. The hook drives this from the rail's Commit
   *  button; works whether or not the coach captured a chain (empty
   *  chain = same as legacy Skip location). */
  commitArmed: () => void;
  /** Hit-vs-error prompt state. Non-null when the coach committed a
   *  drag chain that ends WITHOUT a base on a safe outcome (1B/2B/3B) —
   *  no default per v2 spec. Resolve via `resolveHitOrError`. */
  pendingHitOrError: { armedResult: AtBatResult; terminalFielder: string } | null;
  resolveHitOrError: (choice: "hit" | "error") => void;
  cancelHitOrError: () => void;
}

/** Internal chain-extras bundle threaded into submitAtBat. */
interface ChainExtras {
  fielder_chain?: FielderTouch[];
  batted_ball_type?: BattedBallType;
  error_step_index?: number | null;
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

// Distance (in 0..100 SVG units) within which a fielder drop snaps to a
// base — the drop counts as a throw to that base for chain notation.
// Tuned to match BASE_XY anchors in diamond-geometry: ~6 units = roughly
// the radius of a base diamond, enough to forgive a sloppy finger but
// tight enough that a drop near the mound doesn't read as "to second".
const BASE_DROP_THRESHOLD = 7;

// 0..100 SVG-coord base centers, mirrored from diamond-geometry so the
// hook can run the proximity check without importing the SVG geometry
// module directly (keeps the hook layer framework-agnostic).
const BASE_COORDS: Record<"first" | "second" | "third" | "home", [number, number]> = {
  first:  [66, 70],
  second: [50, 54],
  third:  [34, 70],
  home:   [50, 92],
};

// Pick the nearest base within BASE_DROP_THRESHOLD of (xPct, yPct) — both
// passed in 0..1. Returns null when no base is close enough (mid-relay
// drop, generic catch in the outfield, etc).
function nearestBase(xPct: number, yPct: number): "first" | "second" | "third" | "home" | null {
  const x = xPct * 100;
  const y = yPct * 100;
  let best: { base: "first" | "second" | "third" | "home"; d: number } | null = null;
  for (const [base, [bx, by]] of Object.entries(BASE_COORDS) as [
    "first" | "second" | "third" | "home",
    [number, number],
  ][]) {
    const d = Math.hypot(x - bx, y - by);
    if (d <= BASE_DROP_THRESHOLD && (!best || d < best.d)) {
      best = { base, d };
    }
  }
  return best?.base ?? null;
}

// Outfield positions don't field "fielded" grounders — they catch fly/line
// balls. The chain's first step infers action from the position so the
// notation comes out right (F8 vs 8-2).
const OUTFIELD = new Set(["LF", "CF", "RF"]);

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
  const [pendingHitOrError, setPendingHitOrError] = useState<
    { armedResult: AtBatResult; terminalFielder: string } | null
  >(null);
  // Extras (foul_out, etc) stashed when the in-play outcome is picked, so
  // they ride through the drag-to-fielder gap and land on the AtBatPayload
  // at commit time. Cleared on submit, cancel, or set to null.
  const [armedExtras, setArmedExtras] = useState<AtBatExtras | null>(null);
  // Stage 3 chain state. Built up across multiple drag drops on the
  // diamond; committed via `commitArmed` from the rail. All four reset
  // on submit / cancel / re-arm.
  const [chain, setChain] = useState<FielderTouch[]>([]);
  const [spray, setSpray] = useState<SprayCapture | null>(null);
  const [battedBallType, setBattedBallType] = useState<BattedBallType | null>(null);
  const [errorStepIndex, setErrorStepIndex] = useState<number | null>(null);

  const resetChain = () => {
    setChain([]);
    setSpray(null);
    setBattedBallType(null);
    setErrorStepIndex(null);
  };

  const setArmedResultClearing = (v: ArmedState | null) => {
    setArmedResult(v);
    if (v === null) {
      setArmedExtras(null);
      resetChain();
    } else if (v !== ARMED_IN_PLAY_PENDING) {
      // Transition from IN_PLAY_PENDING → concrete result. Smart-default
      // the batted-ball-type chip based on the picked outcome (FO→fly,
      // LO→line, PO→pop, SF→fly, SAC→bunt). Coach can override before
      // committing.
      setBattedBallType((cur) => cur ?? defaultBattedBallType(v));
    }
  };

  const submitAtBat = async (
    result: AtBatResult,
    spray: { x: number; y: number; fielder: FielderPosition } | null,
    k3Reach?: K3ReachSource,
    extras?: AtBatExtras,
    chainExtras?: ChainExtras,
    advancesOverride?: RunnerAdvance[],
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
    // advancesOverride takes precedence over k3 and defaults — the hit-vs-
    // error path uses it to preserve the batter's destination when the
    // outcome is rewritten to E (defaultAdvances for E returns []).
    const advances: RunnerAdvance[] = advancesOverride
      ? advancesOverride.map((a) => ({
          // Re-stamp the batter-source player_id so opposing-PA paths get
          // a stable reachId instead of whatever the caller computed.
          ...a,
          player_id: a.from === "batter" ? reachId : a.player_id,
        }))
      : k3Reach
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

    // Stage 3: when a fielder_chain was captured, the first-touch position
    // is the canonical `fielder_position` for legacy back-compat. The
    // spray (x, y) still comes from the first-drop coords, which the
    // diamond passes through `onFielderDrop`.
    const chainFromExtras = chainExtras?.fielder_chain;
    const fielderPosition =
      chainFromExtras && chainFromExtras.length > 0
        ? chainFromExtras[0].position
        : spray?.fielder ?? null;
    // Append a scorebook-notation suffix to the description when we have a
    // chain — e.g., "Ground out by Koester — 6-3". Otherwise fall through
    // to the legacy describePlay output.
    const baseDescription = describePlay(result, runs, ourBatterId, names);
    const notation = chainFromExtras
      ? chainNotation(chainFromExtras, result, chainExtras?.error_step_index ?? null, extras?.foul_out)
      : null;
    const finalDescription = notation
      ? `${baseDescription} — ${notation}`
      : baseDescription;

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
      fielder_position: fielderPosition,
      runner_advances: advances,
      description: finalDescription,
      batter_reached_on_k3: k3Reach,
      foul_out: extras?.foul_out,
      fielder_chain: chainExtras?.fielder_chain,
      batted_ball_type: chainExtras?.batted_ball_type,
      error_step_index: chainExtras?.error_step_index ?? null,
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
    resetChain();
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
      // Smart-default the batted-ball-type chip from the picked outcome
      // (FO→fly, LO→line, PO→pop, SF→fly, SAC→bunt). Coach can override
      // in the rail before committing.
      setBattedBallType((cur) => cur ?? defaultBattedBallType(result));
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
    // First drop: stash spray + first-touch fielder, append a "fielded" or
    // "caught" touch depending on whether it was an outfielder. Subsequent
    // drops append a "received" touch and infer `target` from drop coords.
    setChain((prev) => {
      if (prev.length === 0) {
        setSpray({ x, y, fielder });
        // First-touch action depends on batted-ball type and fielder type.
        // - Fly/pop to an outfielder → "caught"
        // - Outfielder otherwise (line-drive grounder through) → "fielded"
        // - Infielder → "fielded"
        // When the chip hasn't been set yet (coach picked the outcome but
        // didn't reach the chip), pick caught for OF on outright fly-out
        // results and fielded everywhere else — refines after the chip
        // lands if needed.
        const isOf = OUTFIELD.has(fielder);
        const looksFly =
          battedBallType === "fly" ||
          battedBallType === "pop" ||
          armedResult === "FO" ||
          armedResult === "PO" ||
          armedResult === "SF" ||
          armedResult === "IF";
        const action: FielderTouch["action"] = isOf && looksFly ? "caught" : "fielded";
        return [{ position: fielder, action }];
      }
      const base = nearestBase(x, y);
      const touch: FielderTouch = base
        ? { position: fielder, action: "received", target: base === "home" ? "home" : base }
        : { position: fielder, action: "received" };
      return [...prev, touch];
    });
  };

  const undoChainStep = () => {
    setChain((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      if (next.length === 0) setSpray(null);
      // Clamp errorStepIndex inside the same updater so the check uses the
      // freshly-computed next.length, not a closure-captured chain.length
      // (which would silently drift if undo were tapped rapidly).
      setErrorStepIndex((cur) => (cur !== null && cur >= next.length ? null : cur));
      return next;
    });
  };

  // Outcomes where the batter reaches safely AND the play could have been
  // a hit or an error depending on judgment — v2 spec calls for an
  // always-prompt when the drag chain ends without a base target.
  const isSafeHitResult = (r: AtBatResult): boolean =>
    r === "1B" || r === "2B" || r === "3B";

  const commitArmed = () => {
    if (!armedResult || armedResult === ARMED_IN_PLAY_PENDING) return;
    // Hit-vs-Error ambiguity check: safe outcome + drag chain with at
    // least one step + terminal step has no base target = no default per
    // play-catalog §10.7. Prompt the coach before committing. If the
    // coach already explicitly set an error step or picked "Error"
    // (armed E), no prompt — they've already declared judgment.
    if (
      isSafeHitResult(armedResult) &&
      chain.length > 0 &&
      errorStepIndex === null &&
      chain[chain.length - 1].target === undefined
    ) {
      setPendingHitOrError({
        armedResult,
        terminalFielder: chain[chain.length - 1].position,
      });
      return;
    }
    commitArmedNow(errorStepIndex);
  };

  // The actual commit, separated so resolveHitOrError can drive it with a
  // possibly-overridden error_step_index.
  const commitArmedNow = (effectiveErrorStepIndex: number | null) => {
    if (!armedResult || armedResult === ARMED_IN_PLAY_PENDING) return;
    const chainExtras: ChainExtras | undefined =
      chain.length > 0 || battedBallType !== null
        ? {
            fielder_chain: chain.length > 0 ? chain : undefined,
            batted_ball_type: battedBallType ?? undefined,
            error_step_index: effectiveErrorStepIndex,
          }
        : undefined;
    void submitAtBat(
      armedResult,
      spray,
      undefined,
      armedExtras ?? undefined,
      chainExtras,
    );
  };

  const resolveHitOrError = (choice: "hit" | "error") => {
    if (!pendingHitOrError) return;
    const armed = pendingHitOrError.armedResult;
    setPendingHitOrError(null);
    if (choice === "hit") {
      commitArmedNow(errorStepIndex);
      return;
    }
    // Error: rewrite to result=E, attribute the terminal step as the
    // error, BUT keep the batter AND existing-runner pushes that the
    // original armed outcome would have produced. `defaultAdvances("E")`
    // returns [] (E is the coach-override case), so we synthesize the
    // plan from the armed outcome and pass it via advancesOverride. The
    // engine's batterReachedOnError flag taints reached_on_error
    // correctly because result===E; auto-RBI returns 0 for E regardless.
    const terminalIdx = chain.length - 1;
    // player_id=null on the batter row — submitAtBat re-stamps it to
    // the correct reachId (ours or opposing) before posting.
    const synthesizedAdvances = defaultAdvances(state.bases, null, armed);
    void submitAtBat(
      "E",
      spray,
      undefined,
      armedExtras ?? undefined,
      {
        fielder_chain: chain.length > 0 ? chain : undefined,
        batted_ball_type: battedBallType ?? undefined,
        error_step_index: terminalIdx,
      },
      synthesizedAdvances,
    );
  };

  const cancelHitOrError = () => setPendingHitOrError(null);

  // Legacy single-tap commit path used by v1 — one drop = immediate
  // submit with spray + fielder_position only (no chain capture). Keeps
  // pre-Stage-3 events shaped exactly like before so the legacy rollup
  // path keeps crediting them.
  const legacyDirectDrop = (x: number, y: number, fielder: FielderPosition) => {
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
    legacyDirectDrop,
    skipLocation,
    chain,
    battedBallType,
    errorStepIndex,
    setBattedBallType,
    setErrorStepIndex,
    undoChainStep,
    commitArmed,
    pendingHitOrError,
    resolveHitOrError,
    cancelHitOrError,
  };
}
