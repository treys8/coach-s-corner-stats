import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetDbForTests,
  bumpAttempt,
  clearGame,
  countByGame,
  deleteById,
  enqueue,
  getPendingFast,
  listByGame,
  notePendingResolved,
  notePendingRetried,
} from "@/lib/outbox/store";

// Wipe the underlying IDB between tests by deleting the database. The
// fake-indexeddb implementation is in-memory, so this is fast.
async function resetDb(): Promise<void> {
  await _resetDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("statly-scoring");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  await resetDb();
});

const GAME_A = "game-aaaa";
const GAME_B = "game-bbbb";

describe("outbox store", () => {
  it("enqueue assigns auto-incrementing ids and FIFO listByGame", async () => {
    const a = await enqueue({
      game_id: GAME_A,
      client_event_id: "ab-1-top-1",
      event_type: "at_bat",
      payload: { result: "1B" },
    });
    const b = await enqueue({
      game_id: GAME_A,
      client_event_id: "ab-1-top-2",
      event_type: "at_bat",
      payload: { result: "K_swinging" },
    });
    expect(a.id).toBeGreaterThan(0);
    expect(b.id).toBeGreaterThan(a.id);

    const list = await listByGame(GAME_A);
    expect(list.map((r) => r.client_event_id)).toEqual([
      "ab-1-top-1",
      "ab-1-top-2",
    ]);
    expect(list[0].attempts).toBe(0);
    expect(list[0].failed).toBe(false);
    expect(list[0].last_error).toBeNull();
    expect(list[0].queued_at).toBeGreaterThan(0);
  });

  it("listByGame is per-game scoped", async () => {
    await enqueue({
      game_id: GAME_A,
      client_event_id: "a1",
      event_type: "pitch",
      payload: {},
    });
    await enqueue({
      game_id: GAME_B,
      client_event_id: "b1",
      event_type: "pitch",
      payload: {},
    });
    const a = await listByGame(GAME_A);
    const b = await listByGame(GAME_B);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].client_event_id).toBe("a1");
    expect(b[0].client_event_id).toBe("b1");
  });

  it("deleteById removes a single entry without touching the rest", async () => {
    const a = await enqueue({
      game_id: GAME_A,
      client_event_id: "a1",
      event_type: "pitch",
      payload: {},
    });
    await enqueue({
      game_id: GAME_A,
      client_event_id: "a2",
      event_type: "pitch",
      payload: {},
    });
    await deleteById(a.id);
    const list = await listByGame(GAME_A);
    expect(list.map((r) => r.client_event_id)).toEqual(["a2"]);
  });

  it("bumpAttempt increments and stamps last_error / failed", async () => {
    const r = await enqueue({
      game_id: GAME_A,
      client_event_id: "a1",
      event_type: "pitch",
      payload: {},
    });
    const after1 = await bumpAttempt(r.id, {
      last_error: "network",
      failed: false,
    });
    expect(after1?.attempts).toBe(1);
    expect(after1?.last_error).toBe("network");
    expect(after1?.failed).toBe(false);

    const after2 = await bumpAttempt(r.id, {
      last_error: "validation",
      failed: true,
    });
    expect(after2?.attempts).toBe(2);
    expect(after2?.failed).toBe(true);
  });

  it("bumpAttempt returns null for a missing id", async () => {
    const result = await bumpAttempt(999_999, { last_error: null, failed: false });
    expect(result).toBeNull();
  });

  it("clearGame removes only that game's rows and returns the count", async () => {
    await enqueue({
      game_id: GAME_A,
      client_event_id: "a1",
      event_type: "pitch",
      payload: {},
    });
    await enqueue({
      game_id: GAME_A,
      client_event_id: "a2",
      event_type: "pitch",
      payload: {},
    });
    await enqueue({
      game_id: GAME_B,
      client_event_id: "b1",
      event_type: "pitch",
      payload: {},
    });
    const removed = await clearGame(GAME_A);
    expect(removed).toBe(2);
    expect(await listByGame(GAME_A)).toHaveLength(0);
    expect(await listByGame(GAME_B)).toHaveLength(1);
  });

  it("countByGame returns pending vs failed split", async () => {
    const a = await enqueue({
      game_id: GAME_A,
      client_event_id: "a1",
      event_type: "pitch",
      payload: {},
    });
    await enqueue({
      game_id: GAME_A,
      client_event_id: "a2",
      event_type: "pitch",
      payload: {},
    });
    await bumpAttempt(a.id, { last_error: "boom", failed: true });
    const counts = await countByGame(GAME_A);
    expect(counts).toEqual({ pending: 1, failed: 1 });
  });
});

describe("outbox pending counter (hot-path cache)", () => {
  it("enqueue bumps the counter; notePendingResolved drops it", async () => {
    expect(await getPendingFast(GAME_A)).toBe(0);
    await enqueue({ game_id: GAME_A, client_event_id: "a1", event_type: "pitch", payload: {} });
    expect(await getPendingFast(GAME_A)).toBe(1);
    await enqueue({ game_id: GAME_A, client_event_id: "a2", event_type: "pitch", payload: {} });
    expect(await getPendingFast(GAME_A)).toBe(2);
    notePendingResolved(GAME_A);
    expect(await getPendingFast(GAME_A)).toBe(1);
    notePendingResolved(GAME_A);
    expect(await getPendingFast(GAME_A)).toBe(0);
  });

  it("counter is clamped at zero on over-decrement", async () => {
    expect(await getPendingFast(GAME_A)).toBe(0);
    notePendingResolved(GAME_A);
    notePendingResolved(GAME_A);
    expect(await getPendingFast(GAME_A)).toBe(0);
  });

  it("notePendingRetried adds back to the counter (failed → pending)", async () => {
    notePendingRetried(GAME_A);
    notePendingRetried(GAME_A);
    expect(await getPendingFast(GAME_A)).toBe(2);
  });

  it("lazy init from IDB picks up non-failed entries from prior session", async () => {
    // Simulate a prior session that wrote two pending + one failed entry.
    await enqueue({ game_id: GAME_A, client_event_id: "a1", event_type: "pitch", payload: {} });
    await enqueue({ game_id: GAME_A, client_event_id: "a2", event_type: "pitch", payload: {} });
    const failed = await enqueue({
      game_id: GAME_A,
      client_event_id: "a3",
      event_type: "pitch",
      payload: {},
    });
    await bumpAttempt(failed.id, { last_error: "boom", failed: true });
    // Drop the in-memory counter only (keep IDB) to simulate a fresh page load.
    const { _resetPendingCacheForTests } = await import("@/lib/outbox/store");
    _resetPendingCacheForTests();
    // The first call must read IDB and recover the pending count (3 enqueues
    // - 1 failed = 2 pending). After this, subsequent calls are pure cache.
    expect(await getPendingFast(GAME_A)).toBe(2);
  });

  it("counter is per-game scoped", async () => {
    await enqueue({ game_id: GAME_A, client_event_id: "a1", event_type: "pitch", payload: {} });
    await enqueue({ game_id: GAME_B, client_event_id: "b1", event_type: "pitch", payload: {} });
    await enqueue({ game_id: GAME_B, client_event_id: "b2", event_type: "pitch", payload: {} });
    expect(await getPendingFast(GAME_A)).toBe(1);
    expect(await getPendingFast(GAME_B)).toBe(2);
  });

  it("clearGame zeroes that game's counter without touching others", async () => {
    await enqueue({ game_id: GAME_A, client_event_id: "a1", event_type: "pitch", payload: {} });
    await enqueue({ game_id: GAME_B, client_event_id: "b1", event_type: "pitch", payload: {} });
    await clearGame(GAME_A);
    expect(await getPendingFast(GAME_A)).toBe(0);
    expect(await getPendingFast(GAME_B)).toBe(1);
  });
});
