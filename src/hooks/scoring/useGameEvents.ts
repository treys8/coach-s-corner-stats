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
import { discardEntry, drainGame } from "@/lib/outbox/drain";
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
  /** Synthetic records for outbox entries the server hasn't acked. Mirrors
   *  what's currently folded into `state` from the queue, so undo can target
   *  the genuinely-most-recent action even when it hasn't synced yet. Each
   *  record carries the `pending-<client_event_id>` id used by the synth
   *  builder. */
  queued: GameEventRecord[];
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
  /** Remove a still-queued outbox entry by its client_event_id and refresh
   *  derived state. Used by undo when the most recent action hasn't been
   *  acked by the server yet — discarding the queue entry is the correct
   *  semantic since there's nothing to supersede. */
  discardQueued: (clientEventId: string) => Promise<void>;
  /** Advance lastSeq to at least `seq` (monotonic via Math.max). Used by the
   *  non-optimistic emitters (runner / flow / timing / closing-pitch events)
   *  on the QUEUED offline path, where `applyPostResult` can't bump because it
   *  has no server state to fold. Without it, two consecutive offline actions
   *  of the same type reuse the same `lastSeq + 1` → identical client_event_id
   *  → the second is silently dropped as a duplicate by the outbox/server.
   *  A no-op once the server fold (or an optimistic apply) lands. */
  bumpLastSeq: (seq: number) => void;
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
 *  folded state, the bumped lastSeq (so subsequent local nextSeq derivations
 *  don't collide with already-queued client_event_ids), and the synthetic
 *  records that were folded — undo uses the synth list to discover the
 *  most-recent queued action even when `events` is older. */
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
): { state: ReplayState; lastSeq: number; synths: GameEventRecord[] } {
  let nextState = base;
  let nextLastSeq = baseLastSeq;
  const synths: GameEventRecord[] = [];
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
      synths.push(synth);
    } catch {
      // A malformed queued payload shouldn't crash cold start / refresh.
      // The entry stays in the outbox and surfaces via the failed sheet.
      // It's also not added to synths — undo shouldn't surface it.
    }
  }
  return { state: nextState, lastSeq: nextLastSeq, synths };
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
  const [queued, setQueued] = useState<GameEventRecord[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Pre-optimistic snapshot (state + lastSeq + queued) kept in a ref so the
  // rollback path doesn't race with React render scheduling. Cleared on
  // commit (applyPostResult) or rollback. `submitting` blocks concurrent
  // taps so depth is always 0 or 1.
  const preOptimisticRef = useRef<{
    state: ReplayState;
    lastSeq: number;
    queued: GameEventRecord[];
  } | null>(null);

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
      setQueued(folded.synths);
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
    setQueued(folded.synths);
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
    // Any synth waiting on this submission's client_event_id has been
    // promoted to a real server event — drop it from queued so undo / UI
    // dedupes against the canonical record.
    if (result.events.length > 0) {
      const acked = new Set(result.events.map((e) => e.client_event_id));
      setQueued((prev) => prev.filter((s) => !acked.has(s.client_event_id)));
    }
    // Commit: server state is authoritative, optimistic snapshot is no
    // longer needed.
    preOptimisticRef.current = null;
    return { state: result.state, events: newEvents, lastSeq: newLastSeq };
  };

  const applyOptimistic = (synth: GameEventRecord) => {
    // Snapshot state + lastSeq + queued for rollback. Phase 5: also bump
    // lastSeq so consecutive offline submits get distinct nextSeq values
    // even when no server ack ever arrives. The eventual `applyPostResult`
    // (online path) overwrites lastSeq with the canonical max; the bump is
    // only load-bearing on the queued path.
    preOptimisticRef.current = { state, lastSeq, queued };
    setState((prev) =>
      timeSync(
        "applyOptimistic",
        { event_type: synth.event_type, event_count: events.length },
        () => applyEvent(prev, synth),
      ),
    );
    setLastSeq((prev) => Math.max(prev, synth.sequence_number));
    setQueued((prev) => [...prev, synth]);
  };

  const rollbackOptimistic = () => {
    const snap = preOptimisticRef.current;
    if (!snap) return;
    preOptimisticRef.current = null;
    setState(snap.state);
    setLastSeq(snap.lastSeq);
    setQueued(snap.queued);
  };

  // Mirror applyOptimistic's lastSeq bump for emitters that DON'T apply an
  // optimistic synth (runner/flow/timing/closing-pitch). Math.max keeps it
  // monotonic, so calling it on the queued path then later folding the server
  // response is always safe. See bumpLastSeq doc on UseGameEventsResult.
  const bumpLastSeq = (seq: number) => setLastSeq((prev) => Math.max(prev, seq));

  const discardQueued = useCallback(
    async (clientEventId: string) => {
      const all = await listByGame(gameId).catch(() => []);
      const row = all.find((r) => r.client_event_id === clientEventId);
      if (row) {
        // discardEntry deletes the outbox row, publishes status, and
        // triggers the registered refresher — refresh() below re-folds the
        // (now smaller) queue and replaces queued/state.
        await discardEntry(gameId, row.id);
      } else {
        // Outbox row already drained (raced with the network coming back);
        // re-fold so the synth drops out of state and queued.
        await refresh();
      }
    },
    [gameId, refresh],
  );

  return {
    state,
    events,
    queued,
    lastSeq,
    loading,
    submitting,
    setSubmitting,
    refresh,
    applyPostResult,
    applyOptimistic,
    rollbackOptimistic,
    discardQueued,
    bumpLastSeq,
  };
}

// Guard + lock around an async action: if a submission is already in-flight,
// returns `whenBusy` without running `fn`. Otherwise flips the submitting
// flag, runs the body, and clears the flag in a finally block so a throw
// from `postEvent` (or anything else) doesn't strand the UI in the
// disabled state. Pre-flight checks that should NOT take the lock can run
// before the caller hands off to this helper.
export function makeWithSubmitting(
  submitting: boolean,
  setSubmitting: (v: boolean) => void,
) {
  return async <T>(whenBusy: T, fn: () => Promise<T>): Promise<T> => {
    if (submitting) return whenBusy;
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      setSubmitting(false);
    }
  };
}
