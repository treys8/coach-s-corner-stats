"use client";

import { useEffect, useState } from "react";
import { subscribe } from "@/lib/outbox/status";
import type { OutboxStatus } from "@/lib/outbox/types";

const initialStatus = (game_id: string): OutboxStatus => ({
  game_id,
  pending: 0,
  failed: 0,
  draining: false,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
});

/** Subscribe to per-game outbox status. Re-renders on enqueue / drain
 *  state transitions and on online/offline. */
export function useOutboxStatus(gameId: string | undefined): OutboxStatus | null {
  const [status, setStatus] = useState<OutboxStatus | null>(
    gameId ? initialStatus(gameId) : null,
  );
  useEffect(() => {
    if (!gameId) {
      setStatus(null);
      return;
    }
    return subscribe(gameId, setStatus);
  }, [gameId]);
  return status;
}
