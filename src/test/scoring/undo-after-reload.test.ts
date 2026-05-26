import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetDbForTests, enqueue, listByGame } from "@/lib/outbox/store";
import { discardEntry } from "@/lib/outbox/drain";
import { deriveLastUndoableEvent } from "@/hooks/scoring/useReplayState";
import type { GameEventRecord } from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";

// Regression coverage for the audit #5 fix: undo after a reload-with-queued-
// events used to target the most recent SERVER-acked event, walking past
// everything the user actually tapped while offline. The fix surfaces
// queued outbox entries as synthetic records and walks them newest-first.
// These tests pin the derivation contract; the discard-from-outbox half is
// exercised against the real outbox store at the bottom of the file.

const GAME_ID = "11111111-1111-1111-1111-111111111111";

function serverEvent(
  partial: Pick<GameEventRecord, "id" | "event_type" | "sequence_number"> &
    Partial<GameEventRecord>,
): GameEventRecord {
  return {
    game_id: GAME_ID,
    client_event_id: `cei-${partial.id}`,
    payload: {} as never,
    supersedes_event_id: null,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

function pendingEvent(
  clientEventId: string,
  event_type: GameEventType,
  sequence_number: number,
): GameEventRecord {
  return {
    id: `pending-${clientEventId}`,
    game_id: GAME_ID,
    client_event_id: clientEventId,
    payload: {} as never,
    supersedes_event_id: null,
    created_at: new Date().toISOString(),
    event_type,
    sequence_number,
  };
}

describe("deriveLastUndoableEvent", () => {
  it("returns null when both events and queued are empty", () => {
    expect(deriveLastUndoableEvent([], [])).toBeNull();
    expect(deriveLastUndoableEvent([])).toBeNull();
  });

  it("returns the latest server event when there are no queued synths", () => {
    const events: GameEventRecord[] = [
      serverEvent({ id: "evt-1", event_type: "game_started", sequence_number: 1 }),
      serverEvent({ id: "evt-2", event_type: "at_bat", sequence_number: 2 }),
      serverEvent({ id: "evt-3", event_type: "pitch", sequence_number: 3 }),
    ];
    expect(deriveLastUndoableEvent(events)?.id).toBe("evt-3");
  });

  it("returns null when the only event is game_started", () => {
    const events: GameEventRecord[] = [
      serverEvent({ id: "evt-1", event_type: "game_started", sequence_number: 1 }),
    ];
    expect(deriveLastUndoableEvent(events)).toBeNull();
  });

  it("skips corrections and the events they superseded", () => {
    const events: GameEventRecord[] = [
      serverEvent({ id: "evt-1", event_type: "game_started", sequence_number: 1 }),
      serverEvent({ id: "evt-2", event_type: "at_bat", sequence_number: 2 }),
      serverEvent({ id: "evt-3", event_type: "at_bat", sequence_number: 3 }),
      serverEvent({
        id: "evt-4",
        event_type: "correction",
        sequence_number: 4,
        payload: {
          superseded_event_id: "evt-3",
          corrected_event_type: null,
          corrected_payload: null,
        } as never,
      }),
    ];
    expect(deriveLastUndoableEvent(events)?.id).toBe("evt-2");
  });

  // The bug: pre-fix this would return "evt-2", undoing an at-bat that's two
  // pitches behind the user's most recent tap. Post-fix it returns the
  // newest pending synth.
  it("returns the newest queued synth when both events and queued are present", () => {
    const events: GameEventRecord[] = [
      serverEvent({ id: "evt-1", event_type: "game_started", sequence_number: 1 }),
      serverEvent({ id: "evt-2", event_type: "at_bat", sequence_number: 2 }),
    ];
    const queued: GameEventRecord[] = [
      pendingEvent("pitch-3", "pitch", 3),
      pendingEvent("pitch-4", "pitch", 4),
    ];
    const target = deriveLastUndoableEvent(events, queued);
    expect(target?.id).toBe("pending-pitch-4");
    expect(target?.client_event_id).toBe("pitch-4");
  });

  it("returns the only queued synth when there are no server events", () => {
    const queued: GameEventRecord[] = [pendingEvent("pitch-1", "pitch", 1)];
    expect(deriveLastUndoableEvent([], queued)?.id).toBe("pending-pitch-1");
  });

  it("falls back to the latest server event after the queued synth drains", () => {
    // Simulates: user tapped a pitch (queued), drain succeeded, queue is
    // empty again. Undo should now supersede the (now-acked) server event.
    const events: GameEventRecord[] = [
      serverEvent({ id: "evt-1", event_type: "game_started", sequence_number: 1 }),
      serverEvent({ id: "evt-2", event_type: "at_bat", sequence_number: 2 }),
      serverEvent({ id: "evt-3", event_type: "pitch", sequence_number: 3 }),
    ];
    expect(deriveLastUndoableEvent(events, [])?.id).toBe("evt-3");
  });

  it("never collapses a queued game_started (no-op safety check)", () => {
    // game_started shouldn't ever appear in queued in practice (it's posted
    // once at game create), but make sure the early-return still applies.
    const queued: GameEventRecord[] = [
      pendingEvent("gs-1", "game_started", 1),
    ];
    expect(deriveLastUndoableEvent([], queued)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration half: confirms the outbox-level discard the undo handler runs
// when the target is pending. Mirrors what `discardQueued` does in
// useGameEvents (find row by client_event_id → discardEntry → refresh).
// ---------------------------------------------------------------------------

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

describe("undo discards the queued entry by client_event_id", () => {
  it("removes the matching outbox row and leaves prior entries intact", async () => {
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "pitch-1",
      event_type: "pitch",
      payload: { pitch_type: "ball" },
    });
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "pitch-2",
      event_type: "pitch",
      payload: { pitch_type: "called_strike" },
    });

    const rows = await listByGame(GAME_ID);
    expect(rows.map((r) => r.client_event_id)).toEqual(["pitch-1", "pitch-2"]);

    // discardQueued resolves the row by client_event_id then defers to
    // discardEntry. Simulate that lookup here.
    const target = rows.find((r) => r.client_event_id === "pitch-2");
    expect(target).toBeDefined();
    await discardEntry(GAME_ID, target!.id);

    const remaining = await listByGame(GAME_ID);
    expect(remaining.map((r) => r.client_event_id)).toEqual(["pitch-1"]);
  });

  it("noop-safe when the row is already gone (raced with drain)", async () => {
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "pitch-1",
      event_type: "pitch",
      payload: { pitch_type: "ball" },
    });
    const rows = await listByGame(GAME_ID);
    const id = rows[0].id;

    await discardEntry(GAME_ID, id);
    expect(await listByGame(GAME_ID)).toHaveLength(0);

    // Second discard attempt with the same id is benign (idb delete is
    // idempotent). useGameEvents' discardQueued falls back to refresh() in
    // this branch — the assertion here is just that no exception escapes.
    await expect(discardEntry(GAME_ID, id)).resolves.toBeUndefined();
  });
});
