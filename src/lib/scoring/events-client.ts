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
  /** Canonical state after all events in the chain were applied (null on failure). */
  state: ReplayState | null;
  /** The persisted event(s). One tap may return 1–3: the primary event,
   *  plus a server-derived closing at_bat (count-closing pitch), plus a
   *  server-derived inning_end (outs hit 3 on the closing PA). */
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
    events?: GameEventRecord[];
    state?: ReplayState;
  };
  return {
    ok: true,
    state: data.state ?? null,
    events: data.events ?? [],
  };
}
