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

  // Walks the event log backwards, skipping void/correction events and
  // events already superseded by a prior correction. `game_started` is
  // intentionally not undoable from the live screen (un-finalize lives on
  // the FinalStub).
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

  return {
    names,
    weAreBatting,
    currentSlot,
    currentOppSlot,
    currentOpponentBatterId,
    lastUndoableEvent,
  };
}
