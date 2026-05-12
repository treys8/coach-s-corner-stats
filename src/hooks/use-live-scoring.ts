"use client";

import type { OpposingBatterProfile } from "@/lib/opponents/profile";
import { useGameEvents } from "./scoring/useGameEvents";
import { useReplayState, type RosterDisplay } from "./scoring/useReplayState";
import { useAtBatActions } from "./scoring/useAtBatActions";
import { useRunnerActions } from "./scoring/useRunnerActions";
import { useFlowActions } from "./scoring/useFlowActions";

export type { RosterDisplay };

export interface UseLiveScoringArgs {
  gameId: string;
  roster: RosterDisplay[];
  /** Optional cache the orchestrator owns so a recorded opposing PA can
   *  invalidate the just-batted slot's career line (prevents stale data
   *  when cycling through a 9-deep lineup). */
  opposingProfileCache?: Map<string, OpposingBatterProfile>;
  /** Called after a finalize event lands so the parent can swap to
   *  FinalStub from its own local state (no SSR refresh required). */
  onFinalized?: () => void;
}

export type { RunnerActionTarget } from "./scoring/useRunnerActions";

/**
 * Composes the four scoring hooks into the public surface LiveScoring.tsx
 * consumes. Kept intentionally thin so each underlying concern (events,
 * derivation, at-bat actions, runner actions, flow actions) can evolve
 * independently.
 */
export function useLiveScoring({
  gameId,
  roster,
  opposingProfileCache,
  onFinalized,
}: UseLiveScoringArgs) {
  const gameEvents = useGameEvents(gameId);
  const {
    state,
    events,
    lastSeq,
    loading,
    submitting,
    setSubmitting,
    refresh,
    applyPostResult,
    applyOptimistic,
    rollbackOptimistic,
  } = gameEvents;

  const derived = useReplayState({ state, events, roster });
  const { names, weAreBatting, currentSlot, currentOppSlot, currentOpponentBatterId, lastUndoableEvent } = derived;

  const atBatActions = useAtBatActions({
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
  });

  const runnerActions = useRunnerActions({
    gameId,
    lastSeq,
    submitting,
    setSubmitting,
    applyPostResult,
  });

  const flowActions = useFlowActions({
    gameId,
    state,
    lastSeq,
    names,
    lastUndoableEvent,
    submitting,
    setSubmitting,
    applyPostResult,
    onFinalized,
  });

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
    ...atBatActions,
    ...runnerActions,
    ...flowActions,
  };
}
