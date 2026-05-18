// Tiny per-game pub-sub for outbox status. The store + drain loop publish
// here; the UI pill subscribes via useOutboxStatus(gameId).
//
// We don't use React context because the publishers (enqueue / drain) are
// not React-aware. A module-scoped EventTarget keeps subscribers simple.

import { countByGame } from "./store";
import type { OutboxStatus } from "./types";

type Listener = (status: OutboxStatus) => void;

const listeners = new Map<string, Set<Listener>>();
const draining = new Set<string>();

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

async function compute(game_id: string): Promise<OutboxStatus> {
  const { pending, failed } = await countByGame(game_id).catch(() => ({
    pending: 0,
    failed: 0,
  }));
  return {
    game_id,
    pending,
    failed,
    draining: draining.has(game_id),
    online: readOnline(),
  };
}

export function subscribe(game_id: string, listener: Listener): () => void {
  let set = listeners.get(game_id);
  if (!set) {
    set = new Set();
    listeners.set(game_id, set);
  }
  set.add(listener);
  void compute(game_id).then(listener);
  return () => {
    const s = listeners.get(game_id);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) listeners.delete(game_id);
  };
}

export async function publish(game_id: string): Promise<void> {
  const set = listeners.get(game_id);
  if (!set || set.size === 0) return;
  const status = await compute(game_id);
  for (const l of set) l(status);
}

export function setDraining(game_id: string, value: boolean): void {
  if (value) draining.add(game_id);
  else draining.delete(game_id);
  void publish(game_id);
}

export function notifyOnlineChange(): void {
  // Fan out to every game we have subscribers for.
  for (const game_id of listeners.keys()) {
    void publish(game_id);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", notifyOnlineChange);
  window.addEventListener("offline", notifyOnlineChange);
}
