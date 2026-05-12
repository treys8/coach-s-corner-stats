import { toast } from "sonner";
import type { GameEventRecord, ReplayState } from "@/lib/scoring/types";

// The server trigger assigns sequence_number — clients don't send it.
// client_event_id is the idempotency key; uniqueness per game is required.
export interface PostBody {
  client_event_id: string;
  event_type: string;
  payload: unknown;
}

export interface PostResult {
  ok: boolean;
  /** Canonical state after the event was applied (null on failure). */
  state: ReplayState | null;
  /** The persisted event(s). Phase 1 always returns one; Phase 2's
   *  server-side chained derivation may return multiple in one POST. */
  events: GameEventRecord[];
}

export async function postEvent(gameId: string, body: PostBody): Promise<PostResult> {
  const res = await fetch(`/api/games/${gameId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    toast.error(`Couldn't save event: ${detail.error ?? res.statusText}`);
    return { ok: false, state: null, events: [] };
  }
  const data = (await res.json().catch(() => ({}))) as {
    event?: GameEventRecord;
    live_state?: ReplayState;
  };
  return {
    ok: true,
    state: data.live_state ?? null,
    events: data.event ? [data.event] : [],
  };
}
