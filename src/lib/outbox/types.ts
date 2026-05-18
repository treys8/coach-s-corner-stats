// Phase 5 offline outbox: durable client-side queue for live-scoring events
// that couldn't reach the server (offline, network blip). Persisted to
// IndexedDB so the queue survives reload + iPad reboot. Keyed per game.
//
// The server's apply_game_events RPC is idempotent on
// (game_id, client_event_id), so replaying an entry that the server already
// accepted (lost ack) is safe — it returns 200 + duplicate:true and we just
// drop the entry.

import type { GameEventType } from "@/integrations/supabase/types";

export interface OutboxRecord {
  /** Auto-incrementing primary key, assigned by IDB on insert. */
  id: number;
  game_id: string;
  client_event_id: string;
  event_type: GameEventType;
  /** The POST body payload. Stored as `unknown` because the route does its
   *  own zod validation; the outbox doesn't introspect it. */
  payload: unknown;
  queued_at: number;
  attempts: number;
  /** Last server / network error message. Surfaced in the failed-events
   *  sheet so the user can decide retry vs discard. Null while the entry
   *  is happily waiting (offline) or has never been attempted. */
  last_error: string | null;
  /** Set true once an attempt returned a 4xx (non-network) error. The drain
   *  loop skips these on subsequent passes — they need user attention. */
  failed: boolean;
}

/** Shape persisted as a record-without-id before insert. */
export type OutboxInsert = Omit<OutboxRecord, "id">;

/** Aggregated counters for the UI pill / hook. */
export interface OutboxStatus {
  game_id: string;
  pending: number;
  failed: number;
  draining: boolean;
  online: boolean;
}
