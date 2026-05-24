"use client";

import { useMemo } from "react";
import { isOurHalf } from "@/lib/scoring/at-bat-helpers";
import type { CorrectionPayload, GameEventRecord, ReplayState } from "@/lib/scoring/types";

export interface RosterDisplay {
  id: string;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
}

function nameById(roster: RosterDisplay[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of roster) {
    const num = p.jersey_number ? `#${p.jersey_number} ` : "";
    m.set(p.id, `${num}${p.first_name} ${p.last_name}`);
  }
  return m;
}

export interface UseReplayStateArgs {
  state: ReplayState;
  events: GameEventRecord[];
  /** Synthetic records for still-queued outbox entries. Treated as the
   *  most-recent slice of the log (after `events`) so undo targets the
   *  genuinely-latest action, even when it hasn't synced. */
  queued?: GameEventRecord[];
  roster: RosterDisplay[];
}

export interface UseReplayStateResult {
  names: Map<string, string>;
  weAreBatting: boolean;
  currentSlot: ReplayState["our_lineup"][number] | null;
  currentOppSlot: ReplayState["opposing_lineup"][number] | null;
  currentOpponentBatterId: string | null;
  lastUndoableEvent: GameEventRecord | null;
}

/**
 * Pure-derivation hook: turns the raw event log + replay state into the
 * memoized values the UI and action hooks need (roster name map, current
 * slot, last-undoable event, etc.). No I/O, no setters.
 */
export function useReplayState({
  state,
  events,
  queued,
  roster,
}: UseReplayStateArgs): UseReplayStateResult {
  const names = useMemo(() => nameById(roster), [roster]);

  const weAreBatting =
    state.current_batter_slot !== null && isOurHalf(state.we_are_home, state.half);

  const currentSlot = useMemo(
    () => state.our_lineup.find((s) => s.batting_order === state.current_batter_slot) ?? null,
    [state.our_lineup, state.current_batter_slot],
  );
  const currentOppSlot = useMemo(
    () => state.opposing_lineup.find((s) => s.batting_order === state.current_opp_batter_slot) ?? null,
    [state.opposing_lineup, state.current_opp_batter_slot],
  );
  const currentOpponentBatterId = !weAreBatting
    ? currentOppSlot?.opponent_player_id ?? null
    : null;

  const lastUndoableEvent = useMemo(
    () => deriveLastUndoableEvent(events, queued),
    [events, queued],
  );

  return {
    names,
    weAreBatting,
    currentSlot,
    currentOppSlot,
    currentOpponentBatterId,
    lastUndoableEvent,
  };
}

/**
 * Pure helper for the undo flow: walks the event log newest-first, skipping
 * corrections and already-superseded events. `game_started` is intentionally
 * not undoable from the live screen (un-finalize lives on the FinalStub).
 *
 * Queued synths are appended after `events` so they're scanned first.
 * Without this, undo would target the last server-acked event and ignore
 * anything the user tapped while offline.
 *
 * Exported so the regression test can pin the behavior without mounting
 * React. Kept here (not in the engine) because it's a UI-layer concern.
 */
export function deriveLastUndoableEvent(
  events: GameEventRecord[],
  queued?: GameEventRecord[],
): GameEventRecord | null {
  const supersededIds = new Set<string>();
  for (const ev of events) {
    if (ev.event_type === "correction") {
      const p = ev.payload as CorrectionPayload;
      supersededIds.add(p.superseded_event_id);
    }
  }
  const ordered = queued && queued.length > 0 ? [...events, ...queued] : events;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const ev = ordered[i];
    if (ev.event_type === "correction") continue;
    if (supersededIds.has(ev.id)) continue;
    if (ev.event_type === "game_started") return null;
    return ev;
  }
  return null;
}
