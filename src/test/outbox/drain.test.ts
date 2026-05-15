import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTests, enqueue, listByGame } from "@/lib/outbox/store";
import { discardEntry, drainGame } from "@/lib/outbox/drain";
import { registerRefresher } from "@/lib/outbox/refresh-registry";

const GAME_ID = "game-drain";

async function resetDb(): Promise<void> {
  await _resetDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("statly-scoring");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
  // Force navigator.onLine = true for these tests; the offline guard would
  // otherwise short-circuit drainGame in jsdom (which defaults onLine=true,
  // but be explicit).
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

afterEach(async () => {
  await resetDb();
});

describe("drainGame", () => {
  it("commits all entries when the server returns 201 and clears the outbox", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { state: {}, events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });
    await enqueue({ game_id: GAME_ID, client_event_id: "p2", event_type: "pitch", payload: {} });

    const refresh = vi.fn().mockResolvedValue(undefined);
    const result = await drainGame(GAME_ID, refresh);

    expect(result).toEqual({ committed: 2, failed: 0, stopped: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await listByGame(GAME_ID)).toHaveLength(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("treats 200 (idempotent duplicate) the same as 201 and deletes the entry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { state: {}, events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });

    const result = await drainGame(GAME_ID);
    expect(result.committed).toBe(1);
    expect(await listByGame(GAME_ID)).toHaveLength(0);
  });

  it("stops on the first transient (network) failure to preserve FIFO", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(jsonResponse(201));
      if (calls === 2) return Promise.reject(new TypeError("Network error"));
      return Promise.resolve(jsonResponse(201));
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });
    await enqueue({ game_id: GAME_ID, client_event_id: "p2", event_type: "pitch", payload: {} });
    await enqueue({ game_id: GAME_ID, client_event_id: "p3", event_type: "pitch", payload: {} });

    const refresh = vi.fn();
    const result = await drainGame(GAME_ID, refresh);

    expect(result).toEqual({ committed: 1, failed: 0, stopped: true });
    // p1 deleted, p2 retained (now bumped attempts), p3 untouched.
    const remaining = await listByGame(GAME_ID);
    expect(remaining.map((r) => r.client_event_id)).toEqual(["p2", "p3"]);
    expect(remaining[0].attempts).toBe(1);
    expect(remaining[0].failed).toBe(false);
    expect(remaining[1].attempts).toBe(0);
    // refresh fires because at least one entry committed before the stop.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("marks 4xx entries as failed and continues past them", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(jsonResponse(400, { error: "invalid" }));
      return Promise.resolve(jsonResponse(201));
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });
    await enqueue({ game_id: GAME_ID, client_event_id: "p2", event_type: "pitch", payload: {} });

    const result = await drainGame(GAME_ID);
    expect(result).toEqual({ committed: 1, failed: 1, stopped: false });
    const remaining = await listByGame(GAME_ID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].client_event_id).toBe("p1");
    expect(remaining[0].failed).toBe(true);
  });

  it("skips already-failed entries on subsequent passes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201));
    vi.stubGlobal("fetch", fetchMock);
    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });
    // Mark p1 failed via a first failing pass.
    const failingFetch = vi.fn().mockResolvedValueOnce(jsonResponse(400, { error: "x" }));
    vi.stubGlobal("fetch", failingFetch);
    await drainGame(GAME_ID);
    expect((await listByGame(GAME_ID))[0].failed).toBe(true);

    // Now enqueue p2 and run drain — should skip p1, commit p2.
    await enqueue({ game_id: GAME_ID, client_event_id: "p2", event_type: "pitch", payload: {} });
    vi.stubGlobal("fetch", fetchMock);
    const result = await drainGame(GAME_ID);
    expect(result.committed).toBe(1);
    expect(result.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const remaining = await listByGame(GAME_ID);
    expect(remaining.map((r) => r.client_event_id)).toEqual(["p1"]);
  });

  it("returns immediately when offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });
    const result = await drainGame(GAME_ID);
    expect(result).toEqual({ committed: 0, failed: 0, stopped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mutex: a second concurrent drainGame call short-circuits", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal("fetch", fetchMock);
    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });

    const first = drainGame(GAME_ID);
    // Spin until fetch is invoked so the first drain has crossed the
    // mutex acquire AND reached postOne. Without this, the second call
    // could race ahead before the first has had a chance to claim the lock.
    while (fetchMock.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 1));
    }
    const second = await drainGame(GAME_ID);
    expect(second).toEqual({ committed: 0, failed: 0, stopped: true });

    resolveFetch(jsonResponse(201));
    await first;
  });

  it("does not call refresh when nothing committed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });
    const refresh = vi.fn();
    await drainGame(GAME_ID, refresh);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("re-drains entries that arrive while the mutex was held", async () => {
    // Simulates the "user submits a new event during drain" race: drain
    // takes a snapshot, second entry enqueues and bounces off the mutex,
    // but the post-drain re-check picks it up.
    let resolveFirst!: (r: Response) => void;
    const firstPromise = new Promise<Response>((res) => {
      resolveFirst = res;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValue(jsonResponse(201));
    vi.stubGlobal("fetch", fetchMock);

    await enqueue({ game_id: GAME_ID, client_event_id: "p1", event_type: "pitch", payload: {} });

    const first = drainGame(GAME_ID);
    // Wait for the first drain to enter postOne (mutex is now held).
    while (fetchMock.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 1));
    }
    // Sneak in a new entry while drain holds the mutex.
    await enqueue({ game_id: GAME_ID, client_event_id: "p2", event_type: "pitch", payload: {} });
    // Resolve the in-flight POST so the original drain finishes.
    resolveFirst(jsonResponse(201));
    await first;
    // The original drain returns committed: 1 (only p1 was in its snapshot).
    // Wait for the auto re-drain to flush p2.
    let attempts = 0;
    while ((await listByGame(GAME_ID)).length > 0 && attempts < 50) {
      await new Promise((r) => setTimeout(r, 5));
      attempts += 1;
    }
    expect(await listByGame(GAME_ID)).toHaveLength(0);
    // Two POSTs total: p1 from the first drain, p2 from the auto re-drain.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discardEntry triggers the registered refresher", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const unregister = registerRefresher(GAME_ID, refresh);
    const entry = await enqueue({
      game_id: GAME_ID,
      client_event_id: "p1",
      event_type: "pitch",
      payload: {},
    });
    await discardEntry(GAME_ID, entry.id);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await listByGame(GAME_ID)).toHaveLength(0);
    unregister();
  });
});
