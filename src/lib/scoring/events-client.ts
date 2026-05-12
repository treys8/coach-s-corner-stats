import { toast } from "sonner";

export interface PostBody {
  client_event_id: string;
  sequence_number: number;
  event_type: string;
  payload: unknown;
}

export async function postEvent(gameId: string, body: PostBody): Promise<boolean> {
  const res = await fetch(`/api/games/${gameId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    toast.error(`Couldn't save event: ${detail.error ?? res.statusText}`);
    return false;
  }
  return true;
}
