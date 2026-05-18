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
