import { describe, expect, it, vi } from "vitest";
import { writeDerivedWithRetry } from "../server";
import { INITIAL_STATE } from "../types";
import type { GameEventRecord, ReplayState } from "../types";

// Regression coverage for audit #4. Pre-fix, rederive() called
// write_derived_state without a concurrency check, so two devices scoring
// the same game in parallel could each compute their own derived state
// from a local replay and have the later writer silently clobber the
// earlier one — events were both persisted, but game_live_state / at_bats
// / games reflected only one coach's view.
//
// Post-fix, the RPC takes an `expected_last_seq` and raises 40001 when it
// disagrees with the actual current max(sequence_number). The TS helper
// catches the conflict, re-fetches events, replays, and retries with the
// fresh expected_seq. These tests pin that retry contract.

const GAME_ID = "11111111-1111-1111-1111-111111111111";

function makeEvent(id: string, seq: number, event_type = "pitch"): GameEventRecord {
  return {
    id,
    game_id: GAME_ID,
    client_event_id: `cei-${id}`,
    sequence_number: seq,
    event_type: event_type as never,
    payload: {} as never,
    supersedes_event_id: null,
    created_at: new Date().toISOString(),
  };
}

function makeAdminWithEvents(events: GameEventRecord[]) {
  const order = vi.fn().mockResolvedValue({ data: events, error: null });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from, _order: order };
}

const baseState: ReplayState = { ...INITIAL_STATE, status: "in_progress" };

describe("writeDerivedWithRetry", () => {
  it("succeeds on the first attempt and passes expected_last_seq", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const userClient = { rpc };
    const admin = makeAdminWithEvents([]);
    const events = [makeEvent("e1", 1), makeEvent("e2", 2)];

    const out = await writeDerivedWithRetry(userClient, admin, GAME_ID, baseState, events);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("write_derived_state");
    expect(args).toMatchObject({
      p_game_id: GAME_ID,
      p_expected_last_seq: 2,
    });
    expect(out.events).toBe(events);
    expect(admin.from).not.toHaveBeenCalled(); // no refetch on happy path
  });

  it("retries with fresh events when the RPC raises 40001 (concurrency_conflict)", async () => {
    const initialEvents = [makeEvent("e1", 1), makeEvent("e2", 2)];
    const freshEvents = [
      ...initialEvents,
      makeEvent("e3", 3), // peer coach's event interleaved
    ];
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        error: { code: "40001", message: "concurrency_conflict: expected=2 actual=3" },
      })
      .mockResolvedValueOnce({ error: null });
    const userClient = { rpc };
    const admin = makeAdminWithEvents(freshEvents);

    const out = await writeDerivedWithRetry(userClient, admin, GAME_ID, baseState, initialEvents);

    expect(rpc).toHaveBeenCalledTimes(2);
    // First attempt used the stale expected_seq.
    expect(rpc.mock.calls[0][1].p_expected_last_seq).toBe(2);
    // Second attempt used the refreshed max(seq).
    expect(rpc.mock.calls[1][1].p_expected_last_seq).toBe(3);
    // Events refetched from admin between attempts.
    expect(admin.from).toHaveBeenCalledWith("game_events");
    // Returned events reflect the post-refetch view.
    expect(out.events).toEqual(freshEvents);
  });

  it("throws after exhausting retries on persistent conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "40001", message: "concurrency_conflict: still racing" },
    });
    const userClient = { rpc };
    const admin = makeAdminWithEvents([makeEvent("e1", 1)]);

    await expect(
      writeDerivedWithRetry(userClient, admin, GAME_ID, baseState, [makeEvent("e1", 1)]),
    ).rejects.toThrow(/write_derived_state failed/);
    expect(rpc).toHaveBeenCalledTimes(3); // bounded retry
  });

  it("does not retry on forbidden / RLS errors", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "42501", message: "row-level security" },
    });
    const userClient = { rpc };
    const admin = makeAdminWithEvents([]);

    await expect(
      writeDerivedWithRetry(userClient, admin, GAME_ID, baseState, [makeEvent("e1", 1)]),
    ).rejects.toThrow(/forbidden/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("does not retry on generic RPC errors (only 40001 is retryable)", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "23505", message: "duplicate key value" },
    });
    const userClient = { rpc };
    const admin = makeAdminWithEvents([]);

    await expect(
      writeDerivedWithRetry(userClient, admin, GAME_ID, baseState, [makeEvent("e1", 1)]),
    ).rejects.toThrow(/write_derived_state failed/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("expected_last_seq is 0 when events array is empty", async () => {
    // game_started + nothing else; sentinel value 0 matches the RPC's
    // COALESCE(MAX(sequence_number), 0) check.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const userClient = { rpc };
    const admin = makeAdminWithEvents([]);

    await writeDerivedWithRetry(userClient, admin, GAME_ID, baseState, []);
    expect(rpc.mock.calls[0][1].p_expected_last_seq).toBe(0);
  });

  it("propagates refetch failure during retry", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      error: { code: "40001", message: "concurrency_conflict" },
    });
    const userClient = { rpc };
    const order = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "network down" },
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const admin = { from: vi.fn().mockReturnValue({ select }) };

    await expect(
      writeDerivedWithRetry(userClient, admin, GAME_ID, baseState, [makeEvent("e1", 1)]),
    ).rejects.toThrow(/game_events refetch on retry failed: network down/);
  });
});
