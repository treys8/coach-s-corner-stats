// ============================================================================
// DEV DEMO ENGINE — safe to delete.
//
// Backs the no-login `/demo-scoring` route. Lets the real LiveScoring UI run
// against an in-memory event store instead of Supabase, so the live-scoring
// experience can be exercised without auth, a network, or any production
// writes. Activated purely by a `demo-` gameId sentinel — it is dead code for
// every real game id, in dev and prod alike.
//
// It reuses the genuine pure replay engine (`replay`/`applyEvent`) and mirrors
// the server's chain derivation (closing at_bat after a count-closing pitch,
// auto inning_end on the 3rd out) from src/lib/scoring/server.ts so pitch-rail
// taps behave exactly like the real tablet. The one server dependency we drop
// is the players-table name lookup in buildClosingAtBat — the demo supplies a
// names map at seed time instead.
// ============================================================================

import type { PostResult, PostBody } from "@/lib/scoring/events-client";
import { applyEvent as foldEvent, replay } from "./replay";
import { defaultAdvances } from "./advances";
import { autoRBI, describePlay, finalCount } from "./at-bat-helpers";
import type {
  AtBatPayload,
  AtBatResult,
  GameEventRecord,
  InningEndPayload,
  PitchPayload,
  PitchType,
  ReplayState,
} from "./types";
import type { GameEventType } from "@/integrations/supabase/types";

export const DEMO_PREFIX = "demo-";
export const isDemoGame = (gameId: string): boolean => gameId.startsWith(DEMO_PREFIX);

interface DemoGame {
  events: GameEventRecord[];
  /** playerId → display name, used only for closing-pitch at_bat descriptions. */
  names: Map<string, string>;
}

// Module-level store. Shared across every import of this module in the
// client bundle, so the demo route can seed it once at module load and the
// scoring hooks read the same instance.
const store = new Map<string, DemoGame>();

let evtCounter = 0;

function record(
  gameId: string,
  clientEventId: string,
  eventType: GameEventType,
  payload: unknown,
  seq: number,
): GameEventRecord {
  evtCounter += 1;
  return {
    id: `demo-evt-${seq}-${evtCounter}`,
    game_id: gameId,
    client_event_id: clientEventId,
    sequence_number: seq,
    event_type: eventType,
    payload: payload as GameEventRecord["payload"],
    supersedes_event_id: null,
    created_at: new Date().toISOString(),
  };
}

/** Seed a demo game's event log + name map. No-op if already seeded so a
 *  hot reload / re-mount doesn't wipe in-progress demo scoring. */
export function demoInitGame(
  gameId: string,
  buildEvents: (mk: typeof record) => GameEventRecord[],
  names: Map<string, string>,
): void {
  if (store.has(gameId)) return;
  const events = buildEvents((gid, cid, type, payload, seq) =>
    record(gid, cid, type, payload, seq),
  );
  store.set(gameId, { events, names });
}

/** Read path: what `useGameEvents` loads instead of querying Supabase. */
export function demoLoadEvents(gameId: string): GameEventRecord[] {
  return store.get(gameId)?.events ?? [];
}

// ---- Chain derivation (mirrors src/lib/scoring/server.ts) -------------------

function closingResultForPitch(
  pitchType: PitchType,
  prev: ReplayState,
): AtBatResult | null {
  if (pitchType === "ball" && prev.current_balls === 3) return "BB";
  if (pitchType === "pitchout" && prev.current_balls === 3) return "BB";
  if (pitchType === "intentional_ball" && prev.current_balls === 3) return "IBB";
  if (pitchType === "called_strike" && prev.current_strikes === 2) return "K_looking";
  if (pitchType === "swinging_strike" && prev.current_strikes === 2) return "K_swinging";
  if (pitchType === "foul_tip_caught" && prev.current_strikes === 2) return "K_swinging";
  if (pitchType === "hbp") return "HBP";
  return null;
}

const isOurHalfOf = (weAreHome: boolean, half: "top" | "bottom"): boolean =>
  weAreHome ? half === "bottom" : half === "top";

function buildClosingAtBat(
  gameId: string,
  prev: ReplayState,
  closing: AtBatResult,
  newSeq: number,
  names: Map<string, string>,
): GameEventRecord {
  const weAreBatting = isOurHalfOf(prev.we_are_home, prev.half);
  const currentSlot =
    prev.our_lineup.find((s) => s.batting_order === prev.current_batter_slot) ?? null;
  const currentOppSlot =
    prev.opposing_lineup.find((s) => s.batting_order === prev.current_opp_batter_slot) ?? null;
  const ourBatterId = weAreBatting ? currentSlot?.player_id ?? null : null;
  const oppBatterId = !weAreBatting ? currentOppSlot?.opponent_player_id ?? null : null;

  const reachId = weAreBatting
    ? ourBatterId
    : oppBatterId ?? `opp-pa-${prev.inning}-${prev.half}-${newSeq}`;

  const advances = defaultAdvances(prev.bases, reachId, closing);
  const runs = advances.filter((a) => a.to === "home").length;
  const rbi = autoRBI(advances, closing, prev.bases);
  const fallback = finalCount(closing, prev.current_balls, prev.current_strikes);

  const payload: AtBatPayload = {
    inning: prev.inning,
    half: prev.half,
    batter_id: ourBatterId,
    opponent_batter_id: oppBatterId,
    pitcher_id: weAreBatting ? null : prev.current_pitcher_id,
    opponent_pitcher_id: weAreBatting ? prev.current_opponent_pitcher_id : null,
    batting_order: weAreBatting ? prev.current_batter_slot : prev.current_opp_batter_slot,
    result: closing,
    rbi,
    pitch_count: fallback.balls + fallback.strikes,
    balls: fallback.balls,
    strikes: fallback.strikes,
    spray_x: null,
    spray_y: null,
    fielder_position: null,
    runner_advances: advances,
    description: describePlay(closing, runs, ourBatterId, names),
  };

  return record(
    gameId,
    `ab-auto-${prev.inning}-${prev.half}-${newSeq}`,
    "at_bat",
    payload,
    newSeq,
  );
}

function buildInningEnd(gameId: string, prev: ReplayState, newSeq: number): GameEventRecord {
  const payload: InningEndPayload = { inning: prev.inning, half: prev.half };
  return record(gameId, `ie-auto-${prev.inning}-${prev.half}-${newSeq}`, "inning_end", payload, newSeq);
}

/** Write path: what `postEvent` runs instead of POSTing to the API route.
 *  Appends the primary event plus any server-derived chain (closing at_bat,
 *  auto inning_end), re-replays, and returns the canonical state + the
 *  records that were actually persisted — the same contract the real route
 *  returns so the UI folds them identically. */
export function demoPostEvent(gameId: string, body: PostBody): PostResult {
  const game = store.get(gameId);
  if (!game) {
    return { kind: "error", ok: false, state: null, events: [] };
  }

  // Idempotency: a retried client_event_id returns the existing state.
  if (game.events.some((e) => e.client_event_id === body.client_event_id)) {
    return { kind: "ok", ok: true, state: replay(game.events), events: [] };
  }

  const stateBefore = replay(game.events);
  const baseSeq = game.events.reduce((m, e) => Math.max(m, e.sequence_number), 0);

  let projectedSeq = baseSeq + 1;
  const primary = record(
    gameId,
    body.client_event_id,
    body.event_type as GameEventType,
    body.payload,
    projectedSeq,
  );
  const chain: GameEventRecord[] = [primary];
  let projected = foldEvent(stateBefore, primary);

  if (body.event_type === "pitch") {
    const pitchPayload = body.payload as PitchPayload;
    const closing = closingResultForPitch(pitchPayload.pitch_type, stateBefore);
    if (closing) {
      projectedSeq += 1;
      const abEvent = buildClosingAtBat(gameId, stateBefore, closing, projectedSeq, game.names);
      chain.push(abEvent);
      projected = foldEvent(projected, abEvent);
    }
  }

  const lastInChain = chain[chain.length - 1];
  if (
    body.event_type !== "correction" &&
    stateBefore.outs < 3 &&
    projected.outs >= 3 &&
    projected.status === "in_progress" &&
    lastInChain.event_type !== "inning_end"
  ) {
    projectedSeq += 1;
    chain.push(buildInningEnd(gameId, projected, projectedSeq));
  }

  game.events.push(...chain);
  return { kind: "ok", ok: true, state: replay(game.events), events: chain };
}
