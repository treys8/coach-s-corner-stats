import { toast } from "sonner";
import { timeAsync } from "@/lib/perf/client";
import { enqueue, countByGame } from "@/lib/outbox/store";
import { drainGame } from "@/lib/outbox/drain";
import { publish } from "@/lib/outbox/status";
import { registerRefresher } from "@/lib/outbox/refresh-registry";
import type { GameEventRecord, ReplayState } from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";

// Re-exported so existing imports keep their import path; the registry
// itself lives in outbox/refresh-registry to avoid a circular import with
// drain.ts.
export { registerRefresher as registerDrainRefresher };

// The server trigger assigns sequence_number — clients don't send it.
// client_event_id is the idempotency key; uniqueness per game is required.
export interface PostBody {
  client_event_id: string;
  event_type: string;
  payload: unknown;
}

export type PostResultKind =
  // Server accepted + state returned. Caller folds via applyPostResult.
  | "ok"
  // Couldn't reach the server (offline / network err) OR there were already
  // queued entries ahead of this one. Event is durable in the outbox; the
  // optimistic state should remain applied. Drain will replay it FIFO when
  // connectivity returns.
  | "queued"
  // Server reachable but rejected (4xx/5xx). Caller should rollback.
  | "error";

export interface PostResult {
  kind: PostResultKind;
  /** True for both "ok" and "queued" — meaning the optimistic state should
   *  remain applied. False only for "error", so existing call sites of the
   *  shape `if (!result.ok) rollback()` keep working unchanged. */
  ok: boolean;
  /** Canonical state after all events in the chain were applied. Null when
   *  queued (no server response yet) or error. */
  state: ReplayState | null;
  /** The persisted event(s). One tap may return 1–3: the primary event,
   *  plus a server-derived closing at_bat (count-closing pitch), plus a
   *  server-derived inning_end (outs hit 3 on the closing PA). Empty when
   *  queued or error. */
  events: GameEventRecord[];
}

async function enqueueEvent(gameId: string, body: PostBody): Promise<PostResult> {
  await enqueue({
    game_id: gameId,
    client_event_id: body.client_event_id,
    event_type: body.event_type as GameEventType,
    payload: body.payload,
  });
  void publish(gameId);
  // Kick off a drain attempt without awaiting — if we're online with
  // capacity, this will start emptying the queue immediately. If offline,
  // drainGame returns instantly and the `online` listener will retry later.
  void drainGame(gameId);
  return { kind: "queued", ok: true, state: null, events: [] };
}

export async function postEvent(gameId: string, body: PostBody): Promise<PostResult> {
  return timeAsync(
    "postEvent",
    { game_id: gameId, event_type: body.event_type, client_event_id: body.client_event_id },
    async () => {
      // Force-queue when offline OR when there are non-failed entries
      // already waiting. The pending check preserves FIFO so a brief
      // online window doesn't reorder events around the in-flight queue.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return enqueueEvent(gameId, body);
      }
      const counts = await countByGame(gameId).catch(() => ({ pending: 0, failed: 0 }));
      if (counts.pending > 0) {
        return enqueueEvent(gameId, body);
      }

      let res: Response;
      try {
        res = await fetch(`/api/games/${gameId}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // Network failure — durable enqueue + retry on reconnect.
        return enqueueEvent(gameId, body);
      }

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const reason = detail.detail ?? detail.error ?? res.statusText;
        toast.error(`Couldn't save event: ${reason}`);
        return { kind: "error", ok: false, state: null, events: [] };
      }
      const data = (await res.json().catch(() => ({}))) as {
        events?: GameEventRecord[];
        state?: ReplayState;
      };
      return {
        kind: "ok",
        ok: true,
        state: data.state ?? null,
        events: data.events ?? [],
      };
    },
  );
}
