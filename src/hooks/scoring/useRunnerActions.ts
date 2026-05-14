"use client";

import { useState } from "react";
import { postEvent } from "@/lib/scoring/events-client";
import type {
  Base,
  CaughtStealingPayload,
  PickoffPayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "@/lib/scoring/types";
import {
  mapRunnerDragToEvent,
  type RunnerDragTarget,
  type RunnerDragVerdict,
} from "@/lib/scoring/runner-drag-map";
import type { GameEventType } from "@/integrations/supabase/types";
import type { UseGameEventsResult } from "./useGameEvents";
import { announceAutoEndHalf } from "./useGameEvents";

export type { RunnerDragTarget, RunnerDragVerdict };

export interface RunnerActionTarget {
  base: "first" | "second" | "third";
  runnerId: string | null;
}

/** Outcome the hook returns to the diamond after handling a runner drop.
 *  `"committed"` means the event posted (or is in flight); the diamond
 *  can clear its dragging state. `"prompt_rbi"` means a SAFE drop on home
 *  needs the On-Last-Play modal — caller should defer to whatever the
 *  modal resolves with. `"noop"` means nothing was applied (e.g.,
 *  submitting was already true). */
export type RunnerDragOutcome = "committed" | "prompt_rbi" | "noop";

/** Pending SAFE@home drop that needs the On-Last-Play modal to resolve.
 *  Coach picks Yes (RBI to last AB) or No (steal-home, no RBI). The hook
 *  emits the event and clears the pending state when the dialog resolves. */
export interface PendingRbiPrompt {
  from: Base;
  runnerId: string | null;
}

export interface UseRunnerActionsArgs {
  gameId: string;
  lastSeq: number;
  submitting: boolean;
  setSubmitting: UseGameEventsResult["setSubmitting"];
  applyPostResult: UseGameEventsResult["applyPostResult"];
}

export interface UseRunnerActionsResult {
  runnerAction: RunnerActionTarget | null;
  setRunnerAction: (v: RunnerActionTarget | null) => void;
  submitMidPA: (
    eventType: GameEventType,
    payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload,
    clientPrefix: string,
  ) => Promise<void>;
  /** Diamond runner-drag handler. Maps `(from, target, verdict)` to the
   *  appropriate event and submits. SAFE@home defers to the On-Last-Play
   *  modal via `pendingRbiPrompt` so the coach can pick whether to credit
   *  RBI to the most recent at_bat. */
  submitRunnerDrag: (
    from: Base,
    target: RunnerDragTarget,
    verdict: RunnerDragVerdict,
    runnerId: string | null,
  ) => Promise<RunnerDragOutcome>;
  /** SAFE@home drop waiting on RBI choice. Null otherwise. */
  pendingRbiPrompt: PendingRbiPrompt | null;
  /** Resolve the On-Last-Play modal. `onLastPlay === true` attaches the
   *  RBI to the most recent at_bat via correction; `false` emits a plain
   *  steal-home (run scores, no RBI). */
  resolveRbiPrompt: (onLastPlay: boolean) => Promise<void>;
  /** Dismiss the prompt without recording the run. Used by Cancel. */
  cancelRbiPrompt: () => void;
}


/**
 * Mid-PA runner events (steals, caught-stealing, pickoffs, ad-hoc moves)
 * plus the Stage 4 runner-drag mechanic. Owns the target-runner dialog
 * state used by the diamond's base taps, plus the pending RBI prompt
 * raised by SAFE@home drops.
 */
export function useRunnerActions({
  gameId,
  lastSeq,
  submitting,
  setSubmitting,
  applyPostResult,
}: UseRunnerActionsArgs): UseRunnerActionsResult {
  const [runnerAction, setRunnerAction] = useState<RunnerActionTarget | null>(null);
  const [pendingRbiPrompt, setPendingRbiPrompt] = useState<PendingRbiPrompt | null>(null);

  const post = async (
    eventType: GameEventType,
    payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload,
    clientPrefix: string,
  ): Promise<boolean> => {
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `${clientPrefix}-${nextSeq}`,
      event_type: eventType,
      payload,
    });
    if (!result.ok) return false;
    applyPostResult(result);
    announceAutoEndHalf(result);
    return true;
  };

  const submitMidPA = async (
    eventType: GameEventType,
    payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload,
    clientPrefix: string,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await post(eventType, payload, clientPrefix);
    setRunnerAction(null);
    if (!ok) {
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  const submitRunnerDrag = async (
    from: Base,
    target: RunnerDragTarget,
    verdict: RunnerDragVerdict,
    runnerId: string | null,
  ): Promise<RunnerDragOutcome> => {
    if (submitting) return "noop";
    // SAFE@home routes through the RBI prompt before emitting an event so
    // the coach can attribute the run to the previous at_bat or stamp it
    // as an independent play.
    if (verdict === "safe" && target === "home") {
      setPendingRbiPrompt({ from, runnerId });
      return "prompt_rbi";
    }
    setSubmitting(true);
    const mapped = mapRunnerDragToEvent(from, target, verdict, runnerId);
    const ok = await post(mapped.eventType, mapped.payload, mapped.clientPrefix);
    if (!ok) {
      setSubmitting(false);
      return "noop";
    }
    setSubmitting(false);
    return "committed";
  };

  const resolveRbiPrompt = async (onLastPlay: boolean) => {
    const pending = pendingRbiPrompt;
    if (!pending || submitting) return;
    setPendingRbiPrompt(null);
    setSubmitting(true);
    let ok: boolean;
    if (onLastPlay) {
      // Coach said "yes, on last play" — record the run with reached_on_error
      // bookkeeping suppressed. error_advance with explicit to:home gives
      // the engine the runner move. Attributing the RBI to the at_bat is
      // a separate correction step which isn't implemented yet — the run
      // still posts; RBI attribution lands in a follow-up.
      const payload: RunnerMovePayload = {
        advances: [{ from: pending.from, to: "home", player_id: pending.runnerId }],
      };
      ok = await post("error_advance", payload, `drag-${pending.from}-home`);
    } else if (pending.from === "third") {
      // R3 stealing home — credits SB to the runner.
      const payload: StolenBasePayload = {
        runner_id: pending.runnerId,
        from: "third",
        to: "home",
      };
      ok = await post("stolen_base", payload, `sb-third`);
    } else {
      // R1/R2 to home without RBI — multi-base advance; use error_advance.
      const payload: RunnerMovePayload = {
        advances: [{ from: pending.from, to: "home", player_id: pending.runnerId }],
      };
      ok = await post("error_advance", payload, `drag-${pending.from}-home`);
    }
    if (!ok) {
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  const cancelRbiPrompt = () => {
    setPendingRbiPrompt(null);
  };

  return {
    runnerAction,
    setRunnerAction,
    submitMidPA,
    submitRunnerDrag,
    pendingRbiPrompt,
    resolveRbiPrompt,
    cancelRbiPrompt,
  };
}
