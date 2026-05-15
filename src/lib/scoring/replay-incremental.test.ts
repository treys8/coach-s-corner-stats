// Phase 2 fast-path guard: confirms that for sequences without supersession,
// the canonical state from `replay(events)` equals the incremental fold
// `events.reduce(applyEvent, INITIAL_STATE)`.
//
// applyEvent (server.ts) uses this property to skip the second
// game_events fetch + full replay() on the hot tap path. If the engine
// ever grows a code path that depends on cross-event lookahead, sorting,
// or supersession filtering at fold time, this test fails and we either
// reflect that in canSkipReplay or fix the engine.

import { describe, expect, it } from "vitest";
import { applyEvent as foldEvent, replay } from "./replay";
import { INITIAL_STATE } from "./types";
import type {
  AtBatPayload,
  GameEventRecord,
  GameStartedPayload,
  InningEndPayload,
  PitchPayload,
  PitchingChangePayload,
  ReplayState,
  StolenBasePayload,
  SubstitutionPayload,
} from "./types";

let seq = 0;
function evt<P>(type: GameEventRecord["event_type"], payload: P): GameEventRecord {
  seq += 1;
  return {
    id: `e${seq}`,
    game_id: "g_incr",
    client_event_id: `c${seq}`,
    sequence_number: seq,
    event_type: type,
    payload: payload as unknown as GameEventRecord["payload"],
    supersedes_event_id: null,
    created_at: new Date(2026, 4, 13, 18, seq).toISOString(),
  };
}

const startGame = (): GameEventRecord =>
  evt<GameStartedPayload>("game_started", {
    we_are_home: false,
    use_dh: true,
    starting_lineup: Array.from({ length: 9 }, (_, i) => ({
      batting_order: i + 1,
      player_id: `p${i + 1}`,
      position: null,
    })),
    starting_pitcher_id: "pitcher_us",
    opponent_starting_pitcher_id: "opp_pitch_1",
  });

const atBat = (overrides: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "top",
  batter_id: null,
  pitcher_id: null,
  opponent_pitcher_id: "opp_pitch_1",
  batting_order: null,
  result: "K_swinging",
  rbi: 0,
  pitch_count: 0,
  balls: 0,
  strikes: 0,
  spray_x: null,
  spray_y: null,
  fielder_position: null,
  runner_advances: [],
  description: null,
  ...overrides,
});

// Build a representative sequence covering: game start, hits, an out,
// pitch-driven at-bat, a stolen base, an inning end, an opp half, a
// substitution, and a pitching change. No supersession.
function buildSequence(): GameEventRecord[] {
  seq = 0;
  return [
    startGame(),
    // Top 1 (we're visiting): three at-bats ending in an inning_end.
    evt<AtBatPayload>("at_bat", atBat({
      batting_order: 1,
      batter_id: "p1",
      result: "1B",
      runner_advances: [{ player_id: "p1", from: "batter", to: "first" }],
    })),
    evt<AtBatPayload>("at_bat", atBat({
      batting_order: 2,
      batter_id: "p2",
      result: "K_swinging",
    })),
    // Mid-PA SB while p3 is up.
    evt<StolenBasePayload>("stolen_base", {
      runner_id: "p1",
      from: "first",
      to: "second",
    }),
    evt<PitchPayload>("pitch", { pitch_type: "ball" }),
    evt<PitchPayload>("pitch", { pitch_type: "called_strike" }),
    evt<AtBatPayload>("at_bat", atBat({
      batting_order: 3,
      batter_id: "p3",
      result: "FO",
      balls: 1,
      strikes: 1,
      pitch_count: 2,
    })),
    evt<AtBatPayload>("at_bat", atBat({
      batting_order: 4,
      batter_id: "p4",
      result: "GO",
    })),
    evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
    // Bot 1: a single opposing PA + inning_end.
    evt<AtBatPayload>("at_bat", atBat({
      inning: 1,
      half: "bottom",
      opponent_batter_id: "opp1",
      batting_order: 1,
      pitcher_id: "pitcher_us",
      opponent_pitcher_id: null,
      result: "K_looking",
    })),
    evt<AtBatPayload>("at_bat", atBat({
      inning: 1,
      half: "bottom",
      opponent_batter_id: "opp2",
      batting_order: 2,
      pitcher_id: "pitcher_us",
      opponent_pitcher_id: null,
      result: "GO",
    })),
    evt<AtBatPayload>("at_bat", atBat({
      inning: 1,
      half: "bottom",
      opponent_batter_id: "opp3",
      batting_order: 3,
      pitcher_id: "pitcher_us",
      opponent_pitcher_id: null,
      result: "FO",
    })),
    evt<InningEndPayload>("inning_end", { inning: 1, half: "bottom" }),
    // Top 2: a sub + a pitching change between PAs.
    evt<SubstitutionPayload>("substitution", {
      batting_order: 5,
      out_player_id: "p5",
      in_player_id: "p10",
      position: null,
      sub_type: "regular",
    }),
    evt<AtBatPayload>("at_bat", atBat({
      inning: 2,
      half: "top",
      batting_order: 5,
      batter_id: "p10",
      result: "BB",
      runner_advances: [{ player_id: "p10", from: "batter", to: "first" }],
    })),
    evt<PitchingChangePayload>("pitching_change", {
      out_pitcher_id: null,
      in_pitcher_id: null,
    }),
    evt<AtBatPayload>("at_bat", atBat({
      inning: 2,
      half: "top",
      batting_order: 6,
      batter_id: "p6",
      opponent_pitcher_id: "opp_pitch_2",
      result: "K_swinging",
    })),
  ];
}

describe("replay() vs incremental fold (fast-path guard)", () => {
  it("end state matches across a representative sequence", () => {
    const events = buildSequence();
    const full = replay(events);
    const incr = events.reduce<ReplayState>(foldEvent, INITIAL_STATE);
    expect(incr).toEqual(full);
  });

  it("matches at every prefix", () => {
    const events = buildSequence();
    let incr: ReplayState = INITIAL_STATE;
    for (let i = 0; i < events.length; i++) {
      incr = foldEvent(incr, events[i]);
      const full = replay(events.slice(0, i + 1));
      expect(incr).toEqual(full);
    }
  });
});
