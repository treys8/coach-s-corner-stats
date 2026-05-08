import { beforeEach, describe, expect, it } from "vitest";
import { replay } from "./replay";
import type { GameEventRecord, GameStartedPayload, AtBatPayload, InningEndPayload } from "./types";

let seq = 0;
function evt<P>(type: GameEventRecord["event_type"], payload: P, id?: string): GameEventRecord {
  seq += 1;
  return {
    id: id ?? `e${seq}`,
    game_id: "g1",
    client_event_id: `c${seq}`,
    sequence_number: seq,
    event_type: type,
    payload: payload as unknown as GameEventRecord["payload"],
    supersedes_event_id: null,
    created_at: new Date(2026, 4, 8, 18, seq).toISOString(),
  };
}

const startGame = (overrides: Partial<GameStartedPayload> = {}) =>
  evt<GameStartedPayload>("game_started", {
    we_are_home: true,
    use_dh: true,
    starting_lineup: Array.from({ length: 9 }, (_, i) => ({
      batting_order: i + 1,
      player_id: `p${i + 1}`,
      position: null,
    })),
    starting_pitcher_id: "pitcher_us",
    opponent_starting_pitcher_id: "opp_pitch_1",
    ...overrides,
  });

const atBat = (p: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "top",
  batter_id: null,
  pitcher_id: null,
  opponent_pitcher_id: null,
  batting_order: null,
  result: "K_swinging",
  rbi: 0,
  pitch_count: 0,
  spray_x: null,
  spray_y: null,
  fielder_position: null,
  runner_advances: [],
  description: null,
  ...p,
});

describe("replay()", () => {
  beforeEach(() => { seq = 0; });

  it("game_started initializes lineup, pitchers, and flips status to in_progress", () => {
    const state = replay([startGame()]);
    expect(state.our_lineup).toHaveLength(9);
    expect(state.current_pitcher_id).toBe("pitcher_us");
    expect(state.current_opponent_pitcher_id).toBe("opp_pitch_1");
    expect(state.current_batter_slot).toBe(1);
    expect(state.we_are_home).toBe(true);
    expect(state.inning).toBe(1);
    expect(state.half).toBe("top");
    expect(state.outs).toBe(0);
    expect(state.bases).toEqual({ first: null, second: null, third: null });
    expect(state.status).toBe("in_progress");
  });

  it("our at-bats advance current_batter_slot; opponent at-bats don't", () => {
    // We are visitors → we bat in the top.
    const state = replay([
      startGame({ we_are_home: false }),
      evt("at_bat", atBat({ half: "top", result: "K_swinging" })),  // our slot 1 → 2
      evt("at_bat", atBat({ half: "top", result: "K_swinging" })),  // our slot 2 → 3
      evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
      evt("at_bat", atBat({ half: "bottom", result: "K_swinging" })), // opponent batting; slot stays at 3
    ]);
    expect(state.current_batter_slot).toBe(3);
  });

  it("current_batter_slot wraps from 9 back to 1", () => {
    const events = [startGame({ we_are_home: false })];
    for (let i = 0; i < 9; i++) {
      events.push(evt("at_bat", atBat({ half: "top", result: "K_swinging" })));
    }
    const state = replay(events);
    expect(state.current_batter_slot).toBe(1);
  });

  it("first at_bat flips status draft → in_progress", () => {
    const state = replay([startGame(), evt("at_bat", atBat({ half: "top", result: "K_swinging" }))]);
    expect(state.status).toBe("in_progress");
  });

  it("strikeout adds 1 out without runner_advances", () => {
    const state = replay([startGame(), evt("at_bat", atBat({ half: "top", result: "K_looking" }))]);
    expect(state.outs).toBe(1);
    expect(state.bases).toEqual({ first: null, second: null, third: null });
  });

  it("solo HR with explicit batter→home advance scores 1 for batting team", () => {
    // We are home; opponent batting in top of 1st means runs go to opponent_score.
    // To verify our scoring, run a bottom-of-1 at_bat with us batting.
    const state = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "bottom",
        result: "HR",
        batter_id: "p1",
        rbi: 1,
        runner_advances: [{ from: "batter", to: "home", player_id: "p1" }],
      })),
    ]);
    expect(state.team_score).toBe(1);
    expect(state.opponent_score).toBe(0);
    expect(state.bases).toEqual({ first: null, second: null, third: null });
    expect(state.at_bats[0].runs_scored_on_play).toBe(1);
  });

  it("opponent HR in top of 1st scores opponent, not us", () => {
    const state = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "top",
        result: "HR",
        batter_id: null,
        runner_advances: [{ from: "batter", to: "home", player_id: null }],
      })),
    ]);
    expect(state.team_score).toBe(0);
    expect(state.opponent_score).toBe(1);
  });

  it("single with man on second scores the runner and puts batter on first", () => {
    const state = replay([
      startGame({ we_are_home: false }),  // we bat top
      evt("at_bat", atBat({
        half: "top",
        result: "1B",
        batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("at_bat", atBat({
        half: "top",
        result: "1B",
        batter_id: "p2",
        rbi: 0,
        runner_advances: [
          { from: "first",  to: "second", player_id: "p1" },
          { from: "batter", to: "first",  player_id: "p2" },
        ],
      })),
      evt("at_bat", atBat({
        half: "top",
        result: "1B",
        batter_id: "p3",
        rbi: 1,
        runner_advances: [
          { from: "second", to: "home",   player_id: "p1" },
          { from: "first",  to: "second", player_id: "p2" },
          { from: "batter", to: "first",  player_id: "p3" },
        ],
      })),
    ]);
    expect(state.team_score).toBe(1);
    expect(state.bases).toEqual({ first: "p3", second: "p2", third: null });
    expect(state.outs).toBe(0);
  });

  it("inning_end flips half, clears bases and outs, advances inning only after bottom", () => {
    const state1 = replay([
      startGame(),
      evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
    ]);
    expect(state1.inning).toBe(1);
    expect(state1.half).toBe("bottom");
    expect(state1.outs).toBe(0);

    const state2 = replay([
      startGame(),
      evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
      evt<InningEndPayload>("inning_end", { inning: 1, half: "bottom" }),
    ]);
    expect(state2.inning).toBe(2);
    expect(state2.half).toBe("top");
  });

  it("substitution swaps the lineup slot for the in-player", () => {
    const state = replay([
      startGame(),
      evt("substitution", {
        out_player_id: "p4", in_player_id: "p99",
        batting_order: 4, position: "LF", sub_type: "regular",
      }),
    ]);
    expect(state.our_lineup.find((s) => s.batting_order === 4)?.player_id).toBe("p99");
    expect(state.our_lineup.find((s) => s.batting_order === 4)?.position).toBe("LF");
  });

  it("game_finalized sets status to final", () => {
    const state = replay([
      startGame(),
      evt("at_bat", atBat({ result: "K_swinging" })),
      evt("game_finalized", {}),
    ]);
    expect(state.status).toBe("final");
  });

  it("correction skips the superseded at_bat and applies the corrected one", () => {
    // Build events in chronological order so sequence_numbers reflect intent.
    const start = startGame();
    const original = evt("at_bat", atBat({
      half: "top",
      result: "HR",
      batter_id: null,
      runner_advances: [{ from: "batter", to: "home", player_id: null }],
    }), "evt-original");
    const correction = evt("correction", {
      superseded_event_id: "evt-original",
      corrected_event_type: "at_bat",
      corrected_payload: atBat({ half: "top", result: "FO" }),
    });

    const state = replay([start, original, correction]);
    expect(state.opponent_score).toBe(0);
    expect(state.outs).toBe(1);
  });

  it("void correction (null event_type/payload) un-finalizes the game", () => {
    const start = startGame();
    const ab = evt("at_bat", atBat({ half: "top", result: "K_swinging" }));
    const finalized = evt("game_finalized", {}, "evt-final");
    const finalState = replay([start, ab, finalized]);
    expect(finalState.status).toBe("final");

    const voidCorrection = evt("correction", {
      superseded_event_id: "evt-final",
      corrected_event_type: null,
      corrected_payload: null,
    });
    const restored = replay([start, ab, finalized, voidCorrection]);
    expect(restored.status).toBe("in_progress");
  });
});
