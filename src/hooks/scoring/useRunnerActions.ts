"use client";

import { useState } from "react";
import { postEvent } from "@/lib/scoring/events-client";
import type {
  CaughtStealingPayload,
  PickoffPayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";
import type { UseGameEventsResult } from "./useGameEvents";
import { announceAutoEndHalf } from "./useGameEvents";

export interface RunnerActionTarget {
  base: "first" | "second" | "third";
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
}

/**
 * Mid-PA runner events (steals, caught-stealing, pickoffs, ad-hoc moves).
 * Owns the target-runner dialog state used by the diamond's base taps and
 * the runners sheet.
 */
export function useRunnerActions({
  gameId,
  lastSeq,
  submitting,
  setSubmitting,
  applyPostResult,
}: UseRunnerActionsArgs): UseRunnerActionsResult {
  const [runnerAction, setRunnerAction] = useState<RunnerActionTarget | null>(null);

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

  return { runnerAction, setRunnerAction, submitMidPA };
}
