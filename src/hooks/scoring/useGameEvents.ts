"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { timeSync, recordPerf } from "@/lib/perf/client";
import { applyEvent, replay } from "@/lib/scoring/replay";
import { INITIAL_STATE } from "@/lib/scoring/types";
import type { PostResult } from "@/lib/scoring/events-client";
import type { GameEventRecord, ReplayState } from "@/lib/scoring/types";

const supabase = createClient();

// Snapshot returned by applyPostResult so handlers that chain multiple
// applies in the same tick (e.g. submitPitchingChange threading a leading
// substitution into the pitching_change apply) can pass forward an
// authoritative view instead of relying on closure-stale React state.
export interface ApplyPostSnapshot {
  state: ReplayState;
  events: GameEventRecord[];
  lastSeq: number;
}

export interface UseGameEventsResult {
  state: ReplayState;
  events: GameEventRecord[];
  lastSeq: number;
  loading: boolean;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  refresh: () => Promise<{ state: ReplayState; events: GameEventRecord[] } | null>;
  applyPostResult: (
    result: PostResult,
    from?: { events: GameEventRecord[]; lastSeq: number },
  ) => ApplyPostSnapshot | null;
  /** Fold a synthetic event into local state before the POST returns, so
   *  the count / runners / score tick instantly on tap. The pre-apply state
   *  is stashed so `rollbackOptimistic` can revert on POST failure. */
  applyOptimistic: (synth: GameEventRecord) => void;
  /** Restore the snapshot captured by the most recent `applyOptimistic`. */
  rollbackOptimistic: () => void;
}

/**
 * Owns the event log + replay state for a game. Action hooks call
 * `applyPostResult` after a successful POST to fold server-derived events
 * into local state without a refetch; `refresh` is a fallback for cold start
 * and for callers that mutate outside the events API.
 */
export function useGameEvents(gameId: string): UseGameEventsResult {
  const [state, setState] = useState<ReplayState>(INITIAL_STATE);
  const [events, setEvents] = useState<GameEventRecord[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Pre-optimistic snapshot kept in a ref so the rollback path doesn't race
  // with React render scheduling. Cleared on commit (applyPostResult) or
  // rollback. `submitting` blocks concurrent taps so depth is always 0 or 1.
  const preOptimisticRef = useRef<ReplayState | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const fetchStart = performance.now();
      const { data, error } = await supabase
        .from("game_events")
        .select("*")
        .eq("game_id", gameId)
        .order("sequence_number", { ascending: true });
      const fetchMs = performance.now() - fetchStart;
      if (!active) return;
      if (error) {
        toast.error(`Couldn't load events: ${error.message}`);
        setLoading(false);
        return;
      }
      const loaded = (data ?? []) as unknown as GameEventRecord[];
      const replayStart = performance.now();
      const initial = replay(loaded);
      const replayMs = performance.now() - replayStart;
      setState(initial);
      setEvents(loaded);
      setLastSeq(loaded.reduce((m, e) => Math.max(m, e.sequence_number), 0));
      setLoading(false);
      recordPerf({
        label: "coldStart",
        fetch_ms: Math.round(fetchMs * 100) / 100,
        replay_ms: Math.round(replayMs * 100) / 100,
        event_count: loaded.length,
        game_id: gameId,
      });
    })();
    return () => { active = false; };
  }, [gameId]);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("game_events")
      .select("*")
      .eq("game_id", gameId)
      .order("sequence_number", { ascending: true });
    if (error) return null;
    const refreshed = (data ?? []) as unknown as GameEventRecord[];
    const newState = replay(refreshed);
    setState(newState);
    setEvents(refreshed);
    setLastSeq(refreshed.reduce((m, e) => Math.max(m, e.sequence_number), 0));
    return { state: newState, events: refreshed };
  }, [gameId]);

  // `from` overrides the closure-captured events/lastSeq so chained applies
  // in the same handler don't clobber each other (submitPitchingChange).
  const applyPostResult = (
    result: PostResult,
    from?: { events: GameEventRecord[]; lastSeq: number },
  ): ApplyPostSnapshot | null => {
    if (!result.state) return null;
    const baseEvents = from?.events ?? events;
    const baseLastSeq = from?.lastSeq ?? lastSeq;
    const newEvents = result.events.length > 0
      ? [...baseEvents, ...result.events]
      : baseEvents;
    const newLastSeq = result.events.reduce(
      (m, e) => Math.max(m, e.sequence_number),
      baseLastSeq,
    );
    setState(result.state);
    setEvents(newEvents);
    setLastSeq(newLastSeq);
    // Commit: server state is authoritative, optimistic snapshot is no
    // longer needed.
    preOptimisticRef.current = null;
    return { state: result.state, events: newEvents, lastSeq: newLastSeq };
  };

  const applyOptimistic = (synth: GameEventRecord) => {
    setState((prev) => {
      preOptimisticRef.current = prev;
      return timeSync(
        "applyOptimistic",
        { event_type: synth.event_type, event_count: events.length },
        () => applyEvent(prev, synth),
      );
    });
  };

  const rollbackOptimistic = () => {
    const snap = preOptimisticRef.current;
    if (!snap) return;
    preOptimisticRef.current = null;
    setState(snap);
  };

  return {
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
  };
}

// Server-derived auto-end-half: when a tap brings outs to 3, the server
// emits an inning_end inside the same POST chain. Toast iff one fired.
export function announceAutoEndHalf(result: PostResult): void {
  const ie = result.events.find((e) => e.event_type === "inning_end");
  if (!ie || !result.state) return;
  const payload = ie.payload as { inning?: number; half?: "top" | "bottom" };
  const inning = payload.inning ?? result.state.inning;
  const half = payload.half ?? result.state.half;
  const halfLabel = half === "top" ? "Top" : "Bot";
  toast.success(`End ${halfLabel} ${inning}. Tap Undo to revert.`);
}
