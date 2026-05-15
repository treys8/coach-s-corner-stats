// Drain loop: pulls entries from the per-game outbox in FIFO order and
// POSTs them to /api/games/{gameId}/events. Stops on the first network
// failure (preserves ordering) and marks 4xx entries as `failed` so the
// user can resolve them manually. After every drain pass, fires the
// registered refresher so the hook can pull canonical state.

import type { GameEventType } from "@/integrations/supabase/types";
import type { OutboxRecord } from "./types";
import { bumpAttempt, deleteById, listByGame } from "./store";
import { publish, setDraining } from "./status";
import { triggerRefresh } from "./refresh-registry";

const inFlight = new Set<string>();

/** One-shot, mutex per-game: drains all currently-queued entries in FIFO.
 *  Stops on transient failure; marks `failed` on permanent (4xx). The
 *  registered refresh fires after the pass when at least one entry committed.
 *  If new entries land while drain holds the mutex, a follow-up pass kicks
 *  automatically once the mutex releases — closes the "submit during drain"
 *  ordering hole. */
export async function drainGame(
  gameId: string,
  onDrained?: () => Promise<void> | void,
): Promise<{ committed: number; failed: number; stopped: boolean }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { committed: 0, failed: 0, stopped: true };
  }
  if (inFlight.has(gameId)) {
    return { committed: 0, failed: 0, stopped: true };
  }
  inFlight.add(gameId);
  setDraining(gameId, true);

  let committed = 0;
  let failed = 0;
  let stopped = false;

  try {
    const all = await listByGame(gameId);
    // Skip entries that previously hit a permanent error — they stay in
    // place until the user resolves them via the failed-events sheet.
    const queue = all.filter((r) => !r.failed);
    for (const entry of queue) {
      const outcome = await postOne(gameId, entry);
      if (outcome === "committed" || outcome === "duplicate") {
        await deleteById(entry.id);
        committed += 1;
        await publish(gameId);
        continue;
      }
      if (outcome === "permanent") {
        await bumpAttempt(entry.id, {
          last_error: entry.last_error ?? "rejected by server",
          failed: true,
        });
        failed += 1;
        await publish(gameId);
        continue;
      }
      // transient — bail, preserve ordering
      await bumpAttempt(entry.id, {
        last_error: "network",
        failed: false,
      });
      stopped = true;
      break;
    }
  } finally {
    inFlight.delete(gameId);
    setDraining(gameId, false);
    await publish(gameId);
  }

  if (committed > 0) {
    if (onDrained) {
      try {
        await onDrained();
      } catch {
        // refresh failure shouldn't surface here — UI catches on next render
      }
    } else {
      // Fall back to the registered refresher so callers who didn't pass
      // an explicit callback (e.g. the enqueueEvent kick) still get the
      // post-commit state sync.
      await triggerRefresh(gameId);
    }
  }

  // Closes the "new submit arrived during drain" race: anything queued
  // while the mutex was held got bounced. Re-check now that we've released.
  if (!stopped && typeof navigator !== "undefined" && navigator.onLine) {
    const remaining = await listByGame(gameId).catch(() => []);
    const pendingNow = remaining.filter((r) => !r.failed).length;
    if (pendingNow > 0) {
      void drainGame(gameId, onDrained);
    }
  }

  return { committed, failed, stopped };
}

type DrainOutcome = "committed" | "duplicate" | "permanent" | "transient";

async function postOne(gameId: string, entry: OutboxRecord): Promise<DrainOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/games/${gameId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_event_id: entry.client_event_id,
        event_type: entry.event_type,
        payload: entry.payload,
      }),
    });
  } catch {
    return "transient";
  }
  if (res.status === 200) return "duplicate";
  if (res.status === 201) return "committed";
  if (res.status >= 400 && res.status < 500) return "permanent";
  return "transient";
}

/** Discard a failed entry. Used by the failed-events sheet's "Discard"
 *  button. Triggers a refresh so the local state drops the discarded
 *  entry's optimistic effect (otherwise score / runners would lie). */
export async function discardEntry(gameId: string, id: number): Promise<void> {
  await deleteById(id);
  await publish(gameId);
  await triggerRefresh(gameId);
}

/** Move a failed entry back to retryable state and trigger a drain. Used by
 *  the failed-events sheet's "Retry" button. */
export async function retryEntry(
  gameId: string,
  id: number,
  onDrained?: () => Promise<void> | void,
): Promise<void> {
  await bumpAttempt(id, { last_error: null, failed: false });
  await publish(gameId);
  void drainGame(gameId, onDrained);
}

/** Re-export for callers that want the queued event_type union. */
export type { GameEventType };
