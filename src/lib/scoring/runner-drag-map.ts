// Pure mapping from a Stage 4 runner-drag drop to the live-scoring event
// we post. Kept separate from the React hook so unit tests don't pull in
// the Supabase client (which initializes at module load and requires env
// vars). The hook re-exports the types it needs.

import type { GameEventType } from "@/integrations/supabase/types";
import type {
  Base,
  CaughtStealingPayload,
  PickoffPayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "./types";

export type RunnerDragTarget = Base | "home";
export type RunnerDragVerdict = "safe" | "out";

// Base ordering used by the drag mapper to classify forward/backward
// distance. 0=first, 1=second, 2=third, 3=home.
const BASE_INDEX: Record<Base | "home", number> = {
  first: 0,
  second: 1,
  third: 2,
  home: 3,
};

export interface MappedRunnerDragEvent {
  eventType: GameEventType;
  payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload;
  clientPrefix: string;
}

/** Map a SAFE/OUT drop to the event we'll post. SAFE@home is intentionally
 *  NOT mapped here: that case raises the On-Last-Play RBI prompt instead
 *  of emitting an event directly. The caller is responsible for detecting
 *  and short-circuiting that case before calling this. */
export function mapRunnerDragToEvent(
  from: Base,
  target: RunnerDragTarget,
  verdict: RunnerDragVerdict,
  runnerId: string | null,
): MappedRunnerDragEvent {
  if (verdict === "safe") {
    const fromIdx = BASE_INDEX[from];
    const toIdx = BASE_INDEX[target];
    const isForwardOne = toIdx === fromIdx + 1;
    if (isForwardOne) {
      return {
        eventType: "stolen_base",
        payload: { runner_id: runnerId, from, to: target } as StolenBasePayload,
        clientPrefix: `sb-${from}`,
      };
    }
    // Any other SAFE drop (multi-base advance, drop on same base, or
    // backward drag for un-advance) emits a generic runner_move via
    // `error_advance`. The replay engine accepts any from→to in
    // RunnerMovePayload.
    return {
      eventType: "error_advance",
      payload: {
        advances: [{ from, to: target, player_id: runnerId }],
      } as RunnerMovePayload,
      clientPrefix: `drag-${from}-${target}`,
    };
  }

  // OUT verdict — classify by drop location.
  if (target === "home") {
    return {
      eventType: "error_advance",
      payload: {
        advances: [{ from, to: "out", player_id: runnerId }],
      } as RunnerMovePayload,
      clientPrefix: `dragout-${from}-home`,
    };
  }
  const fromIdx = BASE_INDEX[from];
  const toIdx = BASE_INDEX[target];
  if (toIdx === fromIdx) {
    return {
      eventType: "pickoff",
      payload: { runner_id: runnerId, from } as PickoffPayload,
      clientPrefix: `po-${from}`,
    };
  }
  if (toIdx === fromIdx + 1) {
    return {
      eventType: "caught_stealing",
      payload: { runner_id: runnerId, from } as CaughtStealingPayload,
      clientPrefix: `cs-${from}`,
    };
  }
  return {
    eventType: "error_advance",
    payload: {
      advances: [{ from, to: "out", player_id: runnerId }],
    } as RunnerMovePayload,
    clientPrefix: `dragout-${from}-${target}`,
  };
}
