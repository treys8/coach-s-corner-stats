"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { timeSync, recordPerf } from "@/lib/perf/client";
import { applyEvent, replay } from "@/lib/scoring/replay";
import { INITIAL_STATE } from "@/lib/scoring/types";
import {
  registerDrainRefresher,
  type PostResult,
} from "@/lib/scoring/events-client";
import { drainGame } from "@/lib/outbox/drain";
import { listByGame } from "@/lib/outbox/store";
import type { GameEventPayload, GameEventRecord, ReplayState } from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";

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

/** Build a synthetic GameEventRecord from a queued outbox row. Used by cold-
 *  start rehydration / refresh so a reload-while-offline picks up the
 *  optimistic state the user was scoring against. Synthetic records are
 *  applied through the engine but never persisted to the local `events`
 *  array — keeps undo / edit-last-play keyed on real server ids. */
function rehydrationRecord(
  game_id: string,
  client_event_id: string,
  event_type: GameEventType,
  payload: unknown,
  sequence_number: number,
  queued_at: number,
): GameEventRecord {
  return {
    id: `pending-${client_event_id}`,
    game_id,
    client_event_id,
    sequence_number,
    event_type,
    payload: payload as GameEventPayload,
    supersedes_event_id: null,
    created_at: new Date(queued_at).toISOString(),
  };
}

/** Fold queued outbox entries into a base state so the local view reflects
 *  what the user has tapped but the server hasn't yet acked. Returns the
 *  folded state and the bumped lastSeq (so subsequent local nextSeq
 *  derivations don't collide with already-queued client_event_ids). */
function foldQueued(
  game_id: string,
  base: ReplayState,
  baseLastSeq: number,
  queued: Array<{
    client_event_id: string;
    event_type: GameEventType;
    payload: unknown;
    queued_at: number;
  }>,
): { state: ReplayState; lastSeq: number } {
  let nextState = base;
  let nextLastSeq = baseLastSeq;
  for (const q of queued) {
    nextLastSeq += 1;
    const synth = rehydrationRecord(
      game_id,
      q.client_event_id,
      q.event_type,
      q.payload,
      nextLastSeq,
      q.queued_at,
    );
    try {
      nextState = applyEvent(nextState, synth);
    } catch {
      // A malformed queued payload shouldn't crash cold start / refresh.
      // The entry stays in the outbox and surfaces via the failed sheet.
    }
  }
  return { state: nextState, lastSeq: nextLastSeq };
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
  // Pre-optimistic snapshot (state + lastSeq) kept in a ref so the rollback
  // path doesn't race with React render scheduling. Cleared on commit
  // (applyPostResult) or rollback. `submitting` blocks concurrent taps so
  // depth is always 0 or 1.
  const preOptimisticRef = useRef<{ state: ReplayState; lastSeq: number } | null>(null);

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
      const baseState = replay(loaded);
      const baseLastSeq = loaded.reduce((m, e) => Math.max(m, e.sequence_number), 0);

      // Phase 5: rehydrate any queued outbox entries on top of the server
      // state so a reload-while-offline picks up where the user left off.
      // We fold queued payloads into state and bump lastSeq, but DO NOT
      // add the synthetic records to the events array — undo / edit-last-
      // play key off real server event ids, and the fake `pending-…` id
      // would fail the server's UUID validation on superseded_event_id.
      let queued: Awaited<ReturnType<typeof listByGame>> = [];
      try {
        queued = await listByGame(gameId);
      } catch {
        queued = [];
      }
      const folded = foldQueued(gameId, baseState, baseLastSeq, queued);

      const replayMs = performance.now() - replayStart;
      if (!active) return;
      setState(folded.state);
      setEvents(loaded);
      setLastSeq(folded.lastSeq);
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

  // eventsRef tracks the latest events array so the offline-refresh fallback
  // can replay against it without taking `events` as a useCallback dep
  // (which would churn the registerRefresher useEffect on every change).
  const eventsRef = useRef<GameEventRecord[]>([]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("game_events")
      .select("*")
      .eq("game_id", gameId)
      .order("sequence_number", { ascending: true });
    // Offline / supabase failure: fall back to the cached events array so
    // a discard-while-offline still re-folds the (now smaller) queue and
    // drops the discarded entry's optimistic effect from local state.
    const refreshed = error
      ? eventsRef.current
      : (data ?? []) as unknown as GameEventRecord[];
    const baseState = replay(refreshed);
    const baseLastSeq = refreshed.reduce((m, e) => Math.max(m, e.sequence_number), 0);
    // After a partial drain some entries may still be in the outbox (failed
    // 4xx awaiting resolution, or transient err post-drain-stop). Re-fold
    // them so lastSeq stays ahead of the highest still-queued client id.
    const stillQueued = await listByGame(gameId).catch(() => []);
    const folded = foldQueued(gameId, baseState, baseLastSeq, stillQueued);
    setState(folded.state);
    if (!error) setEvents(refreshed);
    setLastSeq(folded.lastSeq);
    return { state: folded.state, events: refreshed };
  }, [gameId]);

  // Phase 5: register `refresh` as the drain post-success callback so a
  // successful drain pass pulls canonical state. Listen for connectivity /
  // visibility transitions to kick a drain. No interval polling.
  useEffect(() => {
    const unregister = registerDrainRefresher(gameId, refresh);
    const drain = () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      void drainGame(gameId, async () => { await refresh(); });
    };
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        drain();
      }
    };
    window.addEventListener("online", drain);
    document.addEventListener("visibilitychange", onVisibility);
    // Kick once on mount in case the cold-start rehydration found queued
    // entries and we're already online.
    drain();
    return () => {
      window.removeEventListener("online", drain);
      document.removeEventListener("visibilitychange", onVisibility);
      unregister();
    };
  }, [gameId, refresh]);

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
    // Snapshot state + lastSeq for rollback. Phase 5: also bump lastSeq so
    // consecutive offline submits get distinct nextSeq values even when no
    // server ack ever arrives. The eventual `applyPostResult` (online path)
    // overwrites lastSeq with the canonical max; the bump is only load-
    // bearing on the queued path.
    preOptimisticRef.current = { state, lastSeq };
    setState((prev) =>
      timeSync(
        "applyOptimistic",
        { event_type: synth.event_type, event_count: events.length },
        () => applyEvent(prev, synth),
      ),
    );
    setLastSeq((prev) => Math.max(prev, synth.sequence_number));
  };

  const rollbackOptimistic = () => {
    const snap = preOptimisticRef.current;
    if (!snap) return;
    preOptimisticRef.current = null;
    setState(snap.state);
    setLastSeq(snap.lastSeq);
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
