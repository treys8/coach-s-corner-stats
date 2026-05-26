// IndexedDB-backed outbox store. Pure CRUD; no React, no fetch, no UI.
// Drain logic and UI live in their own modules.

import { openDB, type IDBPDatabase, type DBSchema } from "idb";
import type { GameEventType } from "@/integrations/supabase/types";
import type { OutboxRecord } from "./types";

const DB_NAME = "statly-scoring";
const DB_VERSION = 1;
const STORE = "outbox";

interface OutboxSchema extends DBSchema {
  outbox: {
    key: number;
    value: OutboxRecord;
    indexes: { by_game: string };
  };
}

let dbPromise: Promise<IDBPDatabase<OutboxSchema>> | null = null;

// Per-game pending counter mirrored in memory. The hot tap path needs to
// know "is anything queued ahead of me?" to preserve FIFO; before this
// cache it cost a full IDB read per tap. Now: one IDB read per gameId per
// session (the init), and every subsequent check is a Map lookup.
//
// Invariant: this counter is a *ceiling* on the true pending count. Callers
// must increment it before persisting a pending entry and decrement after
// removing or failing one. A false positive (cache > truth) just routes the
// next tap through the durable queue, which still succeeds; a false negative
// would reorder events around in-flight work, so we never under-count.
const pendingCache = new Map<string, number>();
const pendingInit = new Map<string, Promise<void>>();

function ensurePendingInitialized(gameId: string): Promise<void> {
  if (pendingCache.has(gameId)) return Promise.resolve();
  let p = pendingInit.get(gameId);
  if (!p) {
    p = (async () => {
      let fromDb = 0;
      try {
        const all = await listByGame(gameId);
        for (const r of all) if (!r.failed) fromDb += 1;
      } catch {
        // IDB unavailable — treat as empty; enqueue will still bump on first use.
      }
      // Merge with any increments that happened while init was in flight.
      const existing = pendingCache.get(gameId) ?? 0;
      pendingCache.set(gameId, Math.max(existing, fromDb));
    })();
    pendingInit.set(gameId, p);
  }
  return p;
}

function bumpPending(gameId: string, delta: number): void {
  const next = (pendingCache.get(gameId) ?? 0) + delta;
  pendingCache.set(gameId, next < 0 ? 0 : next);
}

/** Fast pending check used by the event POST hot path. After the first
 *  call per gameId (which lazy-inits from IDB), subsequent calls resolve
 *  synchronously from the in-memory map — no IDB round-trip per tap. */
export async function getPendingFast(gameId: string): Promise<number> {
  await ensurePendingInitialized(gameId);
  return pendingCache.get(gameId) ?? 0;
}

/** Called by drain when a queued entry commits (or is a server-side
 *  duplicate) or hits a permanent 4xx. Both transitions remove the entry
 *  from the pending pool. */
export function notePendingResolved(gameId: string): void {
  bumpPending(gameId, -1);
}

/** Called by retryEntry when a failed entry is flipped back to pending. */
export function notePendingRetried(gameId: string): void {
  bumpPending(gameId, +1);
}

/** Test-only: wipe the in-memory pending cache so tests can isolate. */
export function _resetPendingCacheForTests(): void {
  pendingCache.clear();
  pendingInit.clear();
}

function getDB(): Promise<IDBPDatabase<OutboxSchema>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = openDB<OutboxSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("by_game", "game_id", { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

/** Test-only: close + drop the cached DB connection so tests can isolate state. */
export async function _resetDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore — failing to close is fine for the test path
    }
  }
  dbPromise = null;
  _resetPendingCacheForTests();
}

export async function enqueue(input: {
  game_id: string;
  client_event_id: string;
  event_type: GameEventType;
  payload: unknown;
}): Promise<OutboxRecord> {
  const db = await getDB();
  const record = {
    game_id: input.game_id,
    client_event_id: input.client_event_id,
    event_type: input.event_type,
    payload: input.payload,
    queued_at: Date.now(),
    attempts: 0,
    last_error: null,
    failed: false,
  };
  const id = await db.add(STORE, record as OutboxRecord);
  bumpPending(input.game_id, +1);
  return { ...record, id: id as number };
}

export async function listByGame(game_id: string): Promise<OutboxRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, "by_game", game_id);
  // Insertion order is roughly id-sorted, but be explicit so the drain loop
  // can rely on FIFO.
  return all.sort((a, b) => a.id - b.id);
}

export async function deleteById(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function bumpAttempt(
  id: number,
  patch: { last_error: string | null; failed: boolean },
): Promise<OutboxRecord | null> {
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  const record = await tx.store.get(id);
  if (!record) {
    await tx.done;
    return null;
  }
  const updated: OutboxRecord = {
    ...record,
    attempts: record.attempts + 1,
    last_error: patch.last_error,
    failed: patch.failed,
  };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

export async function clearGame(game_id: string): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  const index = tx.store.index("by_game");
  let cursor = await index.openCursor(IDBKeyRange.only(game_id));
  let count = 0;
  while (cursor) {
    await cursor.delete();
    count += 1;
    cursor = await cursor.continue();
  }
  await tx.done;
  pendingCache.set(game_id, 0);
  return count;
}

export async function countByGame(game_id: string): Promise<{
  pending: number;
  failed: number;
}> {
  const records = await listByGame(game_id);
  let pending = 0;
  let failed = 0;
  for (const r of records) {
    if (r.failed) failed += 1;
    else pending += 1;
  }
  return { pending, failed };
}
