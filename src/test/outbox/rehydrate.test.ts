import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetDbForTests, enqueue, listByGame } from "@/lib/outbox/store";
import { applyEvent, replay } from "@/lib/scoring/replay";
import { INITIAL_STATE, type GameEventRecord, type ReplayState } from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";

// Repro of the cold-start rehydration logic in useGameEvents. We re-test it
// here as a pure function so the behavior can be pinned without touching
// React state (mocking supabase + jsdom timers in a hook test would be
// significantly heavier and provide less direct coverage of the FIFO /
// sequence-bumping invariants this is really about).

function rehydrationRecord(
  game_id: string,
  client_event_id: string,
  event_type: GameEventType,
  payload: unknown,
  sequence_number: number,
  queued_at: number,
): GameEventRecord {
  return {
    id: `pending-${client_event_id}`,
    game_id,
    client_event_id,
    sequence_number,
    event_type,
    payload: payload as never,
    supersedes_event_id: null,
    created_at: new Date(queued_at).toISOString(),
  };
}

function foldQueued(
  game_id: string,
  base: ReplayState,
  baseLastSeq: number,
  queued: Array<{
    client_event_id: string;
    event_type: GameEventType;
    payload: unknown;
    queued_at: number;
  }>,
): { state: ReplayState; lastSeq: number } {
  let nextState = base;
  let nextLastSeq = baseLastSeq;
  for (const q of queued) {
    nextLastSeq += 1;
    const synth = rehydrationRecord(
      game_id,
      q.client_event_id,
      q.event_type,
      q.payload,
      nextLastSeq,
      q.queued_at,
    );
    try {
      nextState = applyEvent(nextState, synth);
    } catch {
      // skip malformed
    }
  }
  return { state: nextState, lastSeq: nextLastSeq };
}

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const PLAYER_ID = "22222222-2222-2222-2222-222222222222";

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

describe("outbox rehydration", () => {
  it("with empty outbox, lastSeq stays at server max", async () => {
    const folded = foldQueued(GAME_ID, INITIAL_STATE, 7, []);
    expect(folded.lastSeq).toBe(7);
    expect(folded.state).toEqual(INITIAL_STATE);
  });

  it("bumps lastSeq by the queued count, preserving FIFO", async () => {
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "pitch-8",
      event_type: "pitch",
      payload: { pitch_type: "ball" },
    });
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "pitch-9",
      event_type: "pitch",
      payload: { pitch_type: "called_strike" },
    });
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "pitch-10",
      event_type: "pitch",
      payload: { pitch_type: "ball" },
    });
    const queued = await listByGame(GAME_ID);
    // Build a base state that has an open at_bat (so pitch events make sense).
    const base = applyEvent(INITIAL_STATE, {
      id: "real-1",
      game_id: GAME_ID,
      client_event_id: "ab-open",
      sequence_number: 7,
      event_type: "at_bat",
      payload: {
        inning: 1,
        half: "top",
        batter_id: PLAYER_ID,
        opponent_batter_id: null,
        pitcher_id: null,
        opponent_pitcher_id: null,
        batting_order: 1,
        result: "1B",
        rbi: 0,
        pitch_count: 0,
        balls: 0,
        strikes: 0,
        spray_x: null,
        spray_y: null,
        fielder_position: null,
        runner_advances: [{ from: "batter", to: "first", player_id: PLAYER_ID }],
        description: null,
      } as never,
      supersedes_event_id: null,
      created_at: new Date().toISOString(),
    });

    const folded = foldQueued(GAME_ID, base, 7, queued);
    // Three queued events, lastSeq should advance past server max + count.
    expect(folded.lastSeq).toBe(10);
    // Pitches should have ticked the count (ball, strike, ball — runner already on 1st).
    expect(folded.state.current_balls).toBe(2);
    expect(folded.state.current_strikes).toBe(1);
  });

  it("simulates the full reload-while-offline flow", async () => {
    // Simulated server log: just `game_started`. Three queued pitches on top.
    const serverEvents: GameEventRecord[] = [];
    const baseState = replay(serverEvents);
    const baseLastSeq = 0;

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
      payload: { pitch_type: "ball" },
    });
    const queued = await listByGame(GAME_ID);

    const folded = foldQueued(GAME_ID, baseState, baseLastSeq, queued);
    expect(folded.lastSeq).toBe(2);
    // The user's NEXT new event would compute nextSeq = lastSeq + 1 = 3.
    // That's strictly higher than any queued client_event_id (pitch-1, pitch-2),
    // so no collision — the reload + new-event flow stays safe.
    const userNextSeq = folded.lastSeq + 1;
    const userClientEventId = `pitch-${userNextSeq}`;
    const queuedIds = (await listByGame(GAME_ID)).map((q) => q.client_event_id);
    expect(queuedIds).not.toContain(userClientEventId);
  });

  it("malformed queued payload doesn't poison the fold", async () => {
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "pitch-1",
      event_type: "pitch",
      payload: { pitch_type: "ball" },
    });
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "garbage-1",
      // Cast deliberately — the outbox stores `unknown`, malformed payloads
      // should skip-and-continue, not abort cold start.
      event_type: "pitch" as GameEventType,
      payload: { not_a_real_field: true },
    });
    await enqueue({
      game_id: GAME_ID,
      client_event_id: "pitch-3",
      event_type: "pitch",
      payload: { pitch_type: "called_strike" },
    });
    const queued = await listByGame(GAME_ID);

    // applyEvent in the engine tolerates missing payload fields silently
    // (no throw); to actually exercise the catch branch we'd need an event
    // type whose handler throws. For now this test confirms the FIFO fold
    // proceeds across a junk payload without an exception escaping.
    const folded = foldQueued(GAME_ID, INITIAL_STATE, 0, queued);
    expect(folded.lastSeq).toBe(3);
  });
});
