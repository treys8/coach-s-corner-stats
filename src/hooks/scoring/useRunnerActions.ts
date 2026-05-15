"use client";

import { useState } from "react";
import { postEvent } from "@/lib/scoring/events-client";
import type {
  Base,
  CaughtStealingPayload,
  PickoffPayload,
  ReplayState,
  RunnerMovePayload,
  StolenBasePayload,
} from "@/lib/scoring/types";
import {
  mapRunnerDragToEvent,
  type RunnerDragTarget,
  type RunnerDragVerdict,
} from "@/lib/scoring/runner-drag-map";
import type { GameEventType } from "@/integrations/supabase/types";
import type { FielderPosition } from "@/components/scoring/diamond-geometry";
import type { UseGameEventsResult } from "./useGameEvents";
import { announceAutoEndHalf } from "./useGameEvents";

/** Pending runner advance awaiting attribution. `phase` is read by the
 *  dialog to gate which options are shown — pitch-required choices
 *  (SB/WP/PB) are hidden when there's no pitch in flight, and post-play
 *  choices (tag-up, advanced-on-throw) are hidden during an at-bat. */
export interface PendingRunnerAttribution {
  from: Base;
  to: Base;
  runnerId: string | null;
  phase: "post_play" | "during_at_bat";
}

export type RunnerAttributionChoice =
  | "stolen_base"
  | "advanced_on_throw"
  | "tag_up_advance"
  | "fielding_error"
  | "throwing_error"
  | "wild_pitch"
  | "passed_ball"
  | "defensive_indifference";

export type { RunnerDragTarget, RunnerDragVerdict };

export interface RunnerActionTarget {
  base: "first" | "second" | "third";
  runnerId: string | null;
}

/** Outcome the hook returns to the diamond after handling a runner drop.
 *  `"committed"` means the event posted (or is in flight); the diamond
 *  can clear its dragging state. `"prompt_rbi"` means a SAFE drop on home
 *  needs the On-Last-Play modal — caller should defer to whatever the
 *  modal resolves with. `"prompt_attribution"` means a between-PA forward
 *  drag triggered the SB/error/WP/PB picker — also deferred. `"noop"`
 *  means nothing was applied (e.g., submitting was already true). */
export type RunnerDragOutcome = "committed" | "prompt_rbi" | "prompt_attribution" | "noop";

/** Pending SAFE@home drop that needs the On-Last-Play modal to resolve.
 *  Coach picks Yes (RBI to last AB) or No (steal-home, no RBI). The hook
 *  emits the event and clears the pending state when the dialog resolves. */
export interface PendingRbiPrompt {
  from: Base;
  runnerId: string | null;
}

export interface UseRunnerActionsArgs {
  gameId: string;
  state: ReplayState;
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
  /** Between-PA forward-one SAFE drag awaiting attribution. Null otherwise. */
  pendingRunnerAttribution: PendingRunnerAttribution | null;
  /** Resolve the between-PA attribution dialog. Emits the correct event
   *  (stolen_base / wild_pitch / passed_ball / error_advance) based on the
   *  choice. Fielder position is required for error variants. */
  resolveRunnerAttribution: (
    choice: RunnerAttributionChoice,
    fielderPosition: FielderPosition | null,
  ) => Promise<void>;
  /** Dismiss the attribution prompt without recording a move. */
  cancelRunnerAttribution: () => void;
}


/**
 * Mid-PA runner events (steals, caught-stealing, pickoffs, ad-hoc moves)
 * plus the Stage 4 runner-drag mechanic. Owns the target-runner dialog
 * state used by the diamond's base taps, plus the pending RBI prompt
 * raised by SAFE@home drops.
 */
export function useRunnerActions({
  gameId,
  state,
  lastSeq,
  submitting,
  setSubmitting,
  applyPostResult,
}: UseRunnerActionsArgs): UseRunnerActionsResult {
  const [runnerAction, setRunnerAction] = useState<RunnerActionTarget | null>(null);
  const [pendingRbiPrompt, setPendingRbiPrompt] = useState<PendingRbiPrompt | null>(null);
  const [pendingRunnerAttribution, setPendingRunnerAttribution] =
    useState<PendingRunnerAttribution | null>(null);

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
    // Any SAFE forward runner-drag is ambiguous on its own — could be a
    // stolen base, an error, a wild pitch, a passed ball, or defensive
    // indifference. Per the runner-advance-attribution rule, the app
    // must prompt every time a runner moves without an explicit play
    // (i.e., the gesture itself doesn't say why). SAFE @ home is the one
    // exception — handled by the RBI prompt above. See
    // [[runner-advance-attribution]].
    if (
      verdict === "safe" &&
      target !== "home" &&
      isForward(from, target)
    ) {
      // No pitch recorded yet in the current PA = the previous play just
      // ended. Pitch-required attributions (SB/WP/PB) don't apply. The
      // dialog reads `phase` to filter its option list.
      const phase: "post_play" | "during_at_bat" =
        state.current_pa_pitches.length === 0 ? "post_play" : "during_at_bat";
      setPendingRunnerAttribution({ from, to: target, runnerId, phase });
      return "prompt_attribution";
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

  const resolveRunnerAttribution = async (
    choice: RunnerAttributionChoice,
    fielderPosition: FielderPosition | null,
  ) => {
    const pending = pendingRunnerAttribution;
    if (!pending || submitting) return;
    setPendingRunnerAttribution(null);
    setSubmitting(true);
    let ok: boolean;
    switch (choice) {
      case "stolen_base": {
        const payload: StolenBasePayload = {
          runner_id: pending.runnerId,
          from: pending.from,
          to: pending.to,
        };
        ok = await post("stolen_base", payload, `sb-${pending.from}`);
        break;
      }
      case "wild_pitch":
      case "passed_ball": {
        const payload: RunnerMovePayload = {
          advances: [{ from: pending.from, to: pending.to, player_id: pending.runnerId }],
        };
        ok = await post(choice, payload, `${choice}-${pending.from}`);
        break;
      }
      case "fielding_error":
      case "throwing_error": {
        const payload: RunnerMovePayload = {
          advances: [{ from: pending.from, to: pending.to, player_id: pending.runnerId }],
          error_fielder_position: fielderPosition ?? undefined,
          error_type: choice === "fielding_error" ? "fielding" : "throwing",
        };
        ok = await post("error_advance", payload, `err-${pending.from}-${pending.to}`);
        break;
      }
      case "advanced_on_throw": {
        // First-class event — runner takes an extra base on the throw
        // with no error charged. Engine treats it as earned, no taint,
        // no fielder-error attribution (WP/balk-style).
        const payload: RunnerMovePayload = {
          advances: [{ from: pending.from, to: pending.to, player_id: pending.runnerId }],
          attribution_label: ATTRIBUTION_LABELS[choice],
        };
        ok = await post("advance_on_throw", payload, `${choice}-${pending.from}-${pending.to}`);
        break;
      }
      case "tag_up_advance":
      case "defensive_indifference": {
        // Pure runner-movement events — no SB credit, no error. The
        // engine has no dedicated event types for these; they emit as
        // error_advance with an attribution_label so the timeline
        // description renders correctly and a future stats pass can
        // suppress the error bookkeeping for these specific variants.
        const payload: RunnerMovePayload = {
          advances: [{ from: pending.from, to: pending.to, player_id: pending.runnerId }],
          attribution_label: ATTRIBUTION_LABELS[choice],
        };
        ok = await post("error_advance", payload, `${choice}-${pending.from}-${pending.to}`);
        break;
      }
    }
    if (!ok) {
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  const cancelRunnerAttribution = () => {
    setPendingRunnerAttribution(null);
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
    pendingRunnerAttribution,
    resolveRunnerAttribution,
    cancelRunnerAttribution,
  };
}

const BASE_INDEX: Record<Base | "home", number> = {
  first: 0,
  second: 1,
  third: 2,
  home: 3,
};

// True for any forward drag — forward-one (1B→2B) or multi-base (1B→3B).
// Same-base or backward drags fall through to the existing mapper (no
// prompt) since those are typically corrections, not advances.
function isForward(from: Base, target: RunnerDragTarget): boolean {
  return BASE_INDEX[target] > BASE_INDEX[from];
}

const ATTRIBUTION_LABELS: Record<
  "advanced_on_throw" | "tag_up_advance" | "defensive_indifference",
  string
> = {
  advanced_on_throw: "Advanced on the throw",
  tag_up_advance: "Tag-up advance",
  defensive_indifference: "Defensive indifference",
};
