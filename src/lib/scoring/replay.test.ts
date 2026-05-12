import { beforeEach, describe, expect, it } from "vitest";
import { applyEvent, replay } from "./replay";
import { INITIAL_STATE } from "./types";
import type {
  CorrectionPayload,
  GameEventRecord,
  GameStartedPayload,
  AtBatPayload,
  InningEndPayload,
  OpposingLineupEditPayload,
  OpposingLineupSlot,
} from "./types";

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
  balls: 0,
  strikes: 0,
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

  it("continuous batting order: 10-slot lineup wraps from slot 10 back to 1", () => {
    const tenSlots = Array.from({ length: 10 }, (_, i) => ({
      batting_order: i + 1,
      player_id: `p${i + 1}`,
      position: null,
    }));
    const events: GameEventRecord[] = [
      startGame({ we_are_home: false, starting_lineup: tenSlots }),
    ];
    for (let i = 0; i < 10; i++) {
      events.push(evt("at_bat", atBat({ half: "top", result: "K_swinging" })));
    }
    const state = replay(events);
    expect(state.our_lineup).toHaveLength(10);
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
    expect(state.bases.first?.player_id).toBe("p3");
    expect(state.bases.second?.player_id).toBe("p2");
    expect(state.bases.third).toBeNull();
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

  it("non-DH pitching change to a bench player: substitution + pitching_change leaves new pitcher in slot and on mound", () => {
    // No DH; lineup slot 9 plays P (player p9). Bring in p99 from the bench.
    const lineup = Array.from({ length: 9 }, (_, i) => ({
      batting_order: i + 1,
      player_id: `p${i + 1}`,
      position: i === 8 ? "P" : null,
    }));
    const state = replay([
      startGame({ use_dh: false, starting_lineup: lineup, starting_pitcher_id: "p9" }),
      evt("substitution", {
        out_player_id: "p9",
        in_player_id: "p99",
        batting_order: 9,
        position: "P",
        sub_type: "regular",
      }),
      evt("pitching_change", { out_pitcher_id: "p9", in_pitcher_id: "p99" }),
    ]);
    const slot9 = state.our_lineup.find((s) => s.batting_order === 9);
    expect(slot9?.player_id).toBe("p99");
    expect(slot9?.position).toBe("P");
    expect(state.current_pitcher_id).toBe("p99");
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

  it("stolen_base from second moves runner to third", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("stolen_base", { runner_id: "p1", from: "first", to: "second" }),
    ]);
    expect(state.bases.first).toBeNull();
    expect(state.bases.second?.player_id).toBe("p1");
    expect(state.bases.third).toBeNull();
    expect(state.outs).toBe(0);
  });

  it("stolen_base of home credits the batting team's run", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("at_bat", atBat({
        half: "top", result: "3B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "third", player_id: "p1" }],
      })),
      evt("stolen_base", { runner_id: "p1", from: "third", to: "home" }),
    ]);
    expect(state.team_score).toBe(1);
    expect(state.bases.first).toBeNull();
    expect(state.bases.second).toBeNull();
    expect(state.bases.third).toBeNull();
  });

  it("caught_stealing increments outs and clears the base", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("caught_stealing", { runner_id: "p1", from: "first" }),
    ]);
    expect(state.outs).toBe(1);
    expect(state.bases.first).toBeNull();
  });

  it("wild_pitch with multiple runners advances per the payload", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p2",
        runner_advances: [
          { from: "first", to: "second", player_id: "p1" },
          { from: "batter", to: "first", player_id: "p2" },
        ],
      })),
      evt("wild_pitch", { advances: [
        { from: "second", to: "third", player_id: "p1" },
        { from: "first", to: "second", player_id: "p2" },
      ]}),
    ]);
    expect(state.bases.first).toBeNull();
    expect(state.bases.second?.player_id).toBe("p2");
    expect(state.bases.third?.player_id).toBe("p1");
  });

  it("balk with bases loaded scores the runner from third", () => {
    // Walk three runners on, then balk.
    const state = replay([
      startGame({ we_are_home: false }),
      evt("at_bat", atBat({ half: "top", result: "BB", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }] })),
      evt("at_bat", atBat({ half: "top", result: "BB", batter_id: "p2",
        runner_advances: [
          { from: "first", to: "second", player_id: "p1" },
          { from: "batter", to: "first", player_id: "p2" },
        ] })),
      evt("at_bat", atBat({ half: "top", result: "BB", batter_id: "p3",
        runner_advances: [
          { from: "second", to: "third", player_id: "p1" },
          { from: "first", to: "second", player_id: "p2" },
          { from: "batter", to: "first", player_id: "p3" },
        ] })),
      evt("balk", { advances: [
        { from: "third", to: "home", player_id: "p1" },
        { from: "second", to: "third", player_id: "p2" },
        { from: "first", to: "second", player_id: "p3" },
      ]}),
    ]);
    expect(state.team_score).toBe(1);
    expect(state.bases.first).toBeNull();
    expect(state.bases.second?.player_id).toBe("p3");
    expect(state.bases.third?.player_id).toBe("p2");
  });

  it("pickoff in our half-inning credits an opponent out (we're fielding)", () => {
    // We are home → top half = opponent batting → opponent runner picked off.
    const state = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "top", result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: null }],
      })),
      evt("pickoff", { runner_id: null, from: "first" }),
    ]);
    expect(state.outs).toBe(1);
    expect(state.bases.first).toBeNull();
  });

  it("correction with custom runner_advances overrides the seeded defaults", () => {
    // Original 1B with R2 conservatively held at third; correction overrides
    // the play so R2 scores instead.
    const start = startGame({ we_are_home: false });
    const setup = evt("at_bat", atBat({
      half: "top", result: "2B", batter_id: "p1",
      runner_advances: [{ from: "batter", to: "second", player_id: "p1" }],
    }));
    const original = evt("at_bat", atBat({
      half: "top", result: "1B", batter_id: "p2",
      runner_advances: [
        { from: "second", to: "third", player_id: "p1" },  // conservative default
        { from: "batter", to: "first", player_id: "p2" },
      ],
    }), "evt-orig");
    const correction = evt("correction", {
      superseded_event_id: "evt-orig",
      corrected_event_type: "at_bat",
      corrected_payload: atBat({
        half: "top", result: "1B", batter_id: "p2",
        rbi: 1,
        runner_advances: [
          { from: "second", to: "home", player_id: "p1" },  // overridden: scores
          { from: "batter", to: "first", player_id: "p2" },
        ],
      }),
    });
    const state = replay([start, setup, original, correction]);
    expect(state.team_score).toBe(1);
    expect(state.bases.first?.player_id).toBe("p2");
    expect(state.bases.third).toBeNull();
  });

  it("pitch events accumulate balls/strikes; at_bat resets and derives count from trail", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("pitch", { pitch_type: "ball" }),
      evt("pitch", { pitch_type: "called_strike" }),
      evt("pitch", { pitch_type: "foul" }),
      evt("pitch", { pitch_type: "swinging_strike" }),
    ]);
    expect(state.current_balls).toBe(1);
    expect(state.current_strikes).toBe(3);
    expect(state.current_pa_pitches).toHaveLength(4);

    const after = replay([
      startGame({ we_are_home: false }),
      evt("pitch", { pitch_type: "ball" }),
      evt("pitch", { pitch_type: "called_strike" }),
      evt("pitch", { pitch_type: "foul" }),
      evt("pitch", { pitch_type: "swinging_strike" }),
      evt("at_bat", atBat({
        half: "top", result: "K_swinging", batter_id: "p1",
        // payload count would say 0/0 — trail overrides.
        balls: 0, strikes: 0, pitch_count: 0,
      })),
    ]);
    const last = after.at_bats[after.at_bats.length - 1];
    expect(last.balls).toBe(1);
    expect(last.strikes).toBe(3);
    expect(last.pitch_count).toBe(4);
    expect(last.pitches).toHaveLength(4);
    expect(after.current_balls).toBe(0);
    expect(after.current_strikes).toBe(0);
    expect(after.current_pa_pitches).toHaveLength(0);
  });

  it("foul caps strikes at 2 (no third strike from a foul)", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("pitch", { pitch_type: "called_strike" }),
      evt("pitch", { pitch_type: "foul" }),
      evt("pitch", { pitch_type: "foul" }),
      evt("pitch", { pitch_type: "foul" }),
    ]);
    expect(state.current_strikes).toBe(2);
  });

  it("inning_end resets the pitch trail and live count", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("pitch", { pitch_type: "ball" }),
      evt("pitch", { pitch_type: "ball" }),
      evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
    ]);
    expect(state.current_balls).toBe(0);
    expect(state.current_strikes).toBe(0);
    expect(state.current_pa_pitches).toHaveLength(0);
  });

  it("at_bat with no preceding pitches falls back to payload counts", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("at_bat", atBat({
        half: "top", result: "K_looking", batter_id: "p1",
        balls: 2, strikes: 3, pitch_count: 5,
      })),
    ]);
    const last = state.at_bats[0];
    expect(last.balls).toBe(2);
    expect(last.strikes).toBe(3);
    expect(last.pitch_count).toBe(5);
    expect(last.pitches).toHaveLength(0);
  });

  it("non_pa_runs captures opponent runs charged against our pitcher", () => {
    // We are home → top half = opponent batting; our pitcher = pitcher_us.
    // Walk batter to first, then opp steals second, then opp WP scores R3.
    const state = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "top", result: "3B",
        runner_advances: [{ from: "batter", to: "third", player_id: null }],
      })),
      evt("wild_pitch", { advances: [
        { from: "third", to: "home", player_id: null },
      ]}),
    ]);
    expect(state.opponent_score).toBe(1);
    expect(state.non_pa_runs).toHaveLength(1);
    expect(state.non_pa_runs[0]).toMatchObject({
      pitcher_id: "pitcher_us",
      runs: 1,
    });
  });

  it("chained corrections: correction-of-correction supersedes the prior correction", () => {
    const start = startGame({ we_are_home: false });
    const original = evt("at_bat", atBat({ half: "top", result: "1B", batter_id: "p1",
      runner_advances: [{ from: "batter", to: "first", player_id: "p1" }] }), "evt-orig");
    const c1 = evt("correction", {
      superseded_event_id: "evt-orig",
      corrected_event_type: "at_bat",
      corrected_payload: atBat({ half: "top", result: "2B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "second", player_id: "p1" }] }),
    }, "evt-c1");
    const c2 = evt("correction", {
      superseded_event_id: "evt-c1",
      corrected_event_type: "at_bat",
      corrected_payload: atBat({ half: "top", result: "HR", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "home", player_id: "p1" }] }),
    });
    const state = replay([start, original, c1, c2]);
    // Final result should be HR (not 1B or 2B). Bases empty, batter scored.
    expect(state.team_score).toBe(1);
    expect(state.bases.first).toBeNull();
    expect(state.bases.second).toBeNull();
    expect(state.bases.third).toBeNull();
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

  // ---- Phase 1 contract: per-base pitcher attribution -----------------------

  it("a hit stamps pitcher_of_record on the new BaseRunner", () => {
    // We are visitors → top half = us batting → opp pitcher of record.
    const state = replay([
      startGame({ we_are_home: false, opponent_starting_pitcher_id: "opp_starter" }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
    ]);
    expect(state.bases.first?.player_id).toBe("p1");
    expect(state.bases.first?.pitcher_of_record_id).toBe("opp_starter");
    expect(state.bases.first?.reached_on_error).toBe(false);
  });

  it("inherited runner: pitching_change does NOT change pitcher_of_record on existing baserunner", () => {
    // We are home → top half = opponent batting → our pitcher of record.
    const state = replay([
      startGame({ we_are_home: true, starting_pitcher_id: "starter" }),
      evt("at_bat", atBat({
        half: "top", result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp1" }],
      })),
      evt("pitching_change", { out_pitcher_id: "starter", in_pitcher_id: "reliever" }),
    ]);
    expect(state.current_pitcher_id).toBe("reliever");
    // The runner is still on first; pitcher_of_record stays "starter".
    expect(state.bases.first?.player_id).toBe("opp1");
    expect(state.bases.first?.pitcher_of_record_id).toBe("starter");
  });

  it("runner advancing on a single preserves their pitcher_of_record across the move", () => {
    // We are home → top half = opponent batting → our pitcher.
    const state = replay([
      startGame({ we_are_home: true, starting_pitcher_id: "starter" }),
      evt("at_bat", atBat({
        half: "top", result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp1" }],
      })),
      evt("pitching_change", { out_pitcher_id: "starter", in_pitcher_id: "reliever" }),
      evt("at_bat", atBat({
        half: "top", result: "1B",
        runner_advances: [
          { from: "first", to: "second", player_id: "opp1" },
          { from: "batter", to: "first", player_id: "opp2" },
        ],
      })),
    ]);
    // opp1 (originally put on by starter) is now on second; pitcher_of_record
    // is still "starter", not "reliever".
    expect(state.bases.second?.player_id).toBe("opp1");
    expect(state.bases.second?.pitcher_of_record_id).toBe("starter");
    // opp2 reached against the reliever.
    expect(state.bases.first?.player_id).toBe("opp2");
    expect(state.bases.first?.pitcher_of_record_id).toBe("reliever");
  });

  it("non_pa_runs entries are tagged with their event source", () => {
    // We are home → top = opp batting. Triple, then WP, PB, balk in sequence.
    const state = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "top", result: "3B",
        runner_advances: [{ from: "batter", to: "third", player_id: "opp1" }],
      })),
      evt("wild_pitch", { advances: [{ from: "third", to: "home", player_id: "opp1" }] }),
      evt("at_bat", atBat({
        half: "top", result: "3B",
        runner_advances: [{ from: "batter", to: "third", player_id: "opp2" }],
      })),
      evt("passed_ball", { advances: [{ from: "third", to: "home", player_id: "opp2" }] }),
      evt("at_bat", atBat({
        half: "top", result: "3B",
        runner_advances: [{ from: "batter", to: "third", player_id: "opp3" }],
      })),
      evt("balk", { advances: [{ from: "third", to: "home", player_id: "opp3" }] }),
    ]);
    expect(state.non_pa_runs).toHaveLength(3);
    expect(state.non_pa_runs[0].source).toBe("wild_pitch");
    expect(state.non_pa_runs[1].source).toBe("passed_ball");
    expect(state.non_pa_runs[2].source).toBe("balk");
  });

  it("error_advance taints the destination runner with reached_on_error=true", () => {
    // We are home → top = opp batting. 1B, then error_advance moves R1 to 2B.
    const state = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "top", result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp1" }],
      })),
      evt("error_advance", { advances: [{ from: "first", to: "second", player_id: "opp1" }] }),
    ]);
    expect(state.bases.second?.player_id).toBe("opp1");
    expect(state.bases.second?.reached_on_error).toBe(true);
  });

  it("passed_ball advancement also taints the runner (PDF §17 unearned criteria #2)", () => {
    const state = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "top", result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp1" }],
      })),
      evt("passed_ball", { advances: [{ from: "first", to: "second", player_id: "opp1" }] }),
    ]);
    expect(state.bases.second?.reached_on_error).toBe(true);
  });

  it("foul_tip_caught at 2-2 advances strike count to 3 (records K)", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("pitch", { pitch_type: "called_strike" }),
      evt("pitch", { pitch_type: "called_strike" }),
      evt("pitch", { pitch_type: "foul_tip_caught" }),
    ]);
    expect(state.current_strikes).toBe(3);
    expect(state.current_pa_pitches).toHaveLength(3);
  });

  it("pitchout and intentional_ball both increment ball count", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("pitch", { pitch_type: "pitchout" }),
      evt("pitch", { pitch_type: "intentional_ball" }),
      evt("pitch", { pitch_type: "intentional_ball" }),
    ]);
    expect(state.current_balls).toBe(3);
  });

  it("game_started stamps is_starter and original_player_id on every slot", () => {
    const state = replay([startGame()]);
    for (const s of state.our_lineup) {
      expect(s.is_starter).toBe(true);
      expect(s.re_entered).toBe(false);
      expect(s.original_player_id).toBe(s.player_id);
    }
  });

  it("pinch_run replaces baserunner.player_id, preserves pitcher_of_record_id and lineup slot", () => {
    // We are home → top half = opp batting → our pitcher. Triple to get
    // opponent on third with pitcher_of_record. (We can't pinch_run for
    // an opp runner; so let's run the scenario with us batting in bottom.)
    const state = replay([
      startGame({ we_are_home: false, opponent_starting_pitcher_id: "opp_starter" }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("substitution", {
        out_player_id: "p1",
        in_player_id: "p99",
        batting_order: 1,
        position: null,
        sub_type: "pinch_run",
        original_base: "first",
      }),
    ]);
    // BaseRunner.player_id swapped, pitcher_of_record retained.
    expect(state.bases.first?.player_id).toBe("p99");
    expect(state.bases.first?.pitcher_of_record_id).toBe("opp_starter");
    // Lineup slot 1 swapped; pinch-runner is not a starter.
    const slot1 = state.our_lineup.find((s) => s.batting_order === 1);
    expect(slot1?.player_id).toBe("p99");
    expect(slot1?.is_starter).toBe(false);
  });

  it("courtesy_run (NFHS) mutates bases without changing the lineup; logs usage", () => {
    // Set up: starter pitcher p1 reaches first; courtesy runner p99 comes in.
    const state = replay([
      startGame({ we_are_home: false, starting_pitcher_id: "p1", league_type: "nfhs" }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("substitution", {
        out_player_id: "p1",
        in_player_id: "p99",
        batting_order: 0,
        position: null,
        sub_type: "courtesy_run",
        original_base: "first",
      }),
    ]);
    expect(state.bases.first?.player_id).toBe("p99");
    // Lineup unchanged — p1 is still in the lineup at slot 1.
    expect(state.our_lineup.find((s) => s.batting_order === 1)?.player_id).toBe("p1");
    // Usage logged.
    expect(state.courtesy_runners_used).toHaveLength(1);
    expect(state.courtesy_runners_used[0].role).toBe("pitcher");
    expect(state.courtesy_runners_used[0].runner_player_id).toBe("p99");
  });

  it("courtesy_run is rejected when league_type is 'mlb' (default)", () => {
    const state = replay([
      startGame({ we_are_home: false, starting_pitcher_id: "p1" }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("substitution", {
        out_player_id: "p1",
        in_player_id: "p99",
        batting_order: 0,
        position: null,
        sub_type: "courtesy_run",
        original_base: "first",
      }),
    ]);
    // CR rejected → original runner still on first; no usage logged.
    expect(state.bases.first?.player_id).toBe("p1");
    expect(state.courtesy_runners_used).toHaveLength(0);
  });

  it("re_entry: starter A subbed out and back in at original slot, sets re_entered=true", () => {
    const state = replay([
      startGame(),
      // Starter p4 subbed out (regular)
      evt("substitution", {
        out_player_id: "p4", in_player_id: "p99",
        batting_order: 4, position: "LF", sub_type: "regular",
      }),
      // Starter p4 re-enters
      evt("substitution", {
        out_player_id: "p99", in_player_id: "p4",
        batting_order: 4, position: "LF", sub_type: "re_entry",
      }),
    ]);
    const slot4 = state.our_lineup.find((s) => s.batting_order === 4);
    expect(slot4?.player_id).toBe("p4");
    expect(slot4?.re_entered).toBe(true);
    expect(slot4?.is_starter).toBe(true); // starters retain is_starter through re-entry
    expect(slot4?.original_player_id).toBe("p4");
  });

  it("defensive_conference appends to the log; counts per pitcher", () => {
    const state = replay([
      startGame({ we_are_home: true, starting_pitcher_id: "p1" }),
      evt("defensive_conference", { pitcher_id: "p1", inning: 1 }),
      evt("defensive_conference", { pitcher_id: "p1", inning: 2 }),
      evt("pitching_change", { out_pitcher_id: "p1", in_pitcher_id: "p2" }),
      evt("defensive_conference", { pitcher_id: "p2", inning: 3 }),
    ]);
    expect(state.defensive_conferences).toHaveLength(3);
    expect(
      state.defensive_conferences.filter((c) => c.pitcher_id === "p1").length,
    ).toBe(2);
    expect(
      state.defensive_conferences.filter((c) => c.pitcher_id === "p2").length,
    ).toBe(1);
  });

  it("wild_pitch and balk do NOT taint the runner (those runs are earned)", () => {
    const wpState = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "top", result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp1" }],
      })),
      evt("wild_pitch", { advances: [{ from: "first", to: "second", player_id: "opp1" }] }),
    ]);
    expect(wpState.bases.second?.reached_on_error).toBe(false);

    const balkState = replay([
      startGame({ we_are_home: true }),
      evt("at_bat", atBat({
        half: "top", result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp1" }],
      })),
      evt("balk", { advances: [{ from: "first", to: "second", player_id: "opp1" }] }),
    ]);
    expect(balkState.bases.second?.reached_on_error).toBe(false);
  });

  // ---- Opposing-lineup tracking ------------------------------------------

  const oppLineup = (): OpposingLineupSlot[] =>
    Array.from({ length: 9 }, (_, i) => ({
      batting_order: i + 1,
      opponent_player_id: `opp${i + 1}`,
      jersey_number: String(i + 1),
      last_name: `Opp${i + 1}`,
      position: null,
      is_dh: false,
    }));

  it("opposing batter slot advances when we field, wraps 9→1", () => {
    // We are home → opponents bat in top. Slot pointer must walk 1→2…→9→1.
    const events: GameEventRecord[] = [
      startGame({ we_are_home: true, opposing_lineup: oppLineup() }),
    ];
    for (let i = 0; i < 9; i++) {
      events.push(evt("at_bat", atBat({ half: "top", result: "K_swinging" })));
    }
    let state = replay(events);
    expect(state.current_opp_batter_slot).toBe(1);
    // One more PA pushes 1→2.
    state = replay([...events, evt("at_bat", atBat({ half: "top", result: "K_swinging" }))]);
    expect(state.current_opp_batter_slot).toBe(2);
  });

  it("opposing batter slot does NOT advance when we are batting", () => {
    // We are visitors → we bat in top, opponents field. Slot pointer stays at 1.
    const state = replay([
      startGame({ we_are_home: false, opposing_lineup: oppLineup() }),
      evt("at_bat", atBat({ half: "top", result: "K_swinging", batter_id: "p1" })),
      evt("at_bat", atBat({ half: "top", result: "K_swinging", batter_id: "p2" })),
    ]);
    expect(state.current_opp_batter_slot).toBe(1);
  });

  it("opposing batter slot survives inning_end", () => {
    // We are home → opponents bat top. Two opp PAs (slot 1→2→3), then end half.
    const state = replay([
      startGame({ we_are_home: true, opposing_lineup: oppLineup() }),
      evt("at_bat", atBat({ half: "top", result: "K_swinging" })),
      evt("at_bat", atBat({ half: "top", result: "K_swinging" })),
      evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
    ]);
    expect(state.current_opp_batter_slot).toBe(3);
  });

  it("opposing_lineup_edit replaces lineup wholesale", () => {
    const replaced: OpposingLineupSlot[] = oppLineup().map((s) => ({
      ...s,
      last_name: `New${s.batting_order}`,
      jersey_number: `${50 + s.batting_order}`,
    }));
    const state = replay([
      startGame({ we_are_home: true, opposing_lineup: oppLineup() }),
      evt<OpposingLineupEditPayload>("opposing_lineup_edit", {
        opposing_lineup: replaced,
      }),
    ]);
    expect(state.opposing_lineup).toEqual(replaced);
    expect(state.opposing_lineup[0].last_name).toBe("New1");
    expect(state.opposing_lineup[0].jersey_number).toBe("51");
  });

  it("opposing_lineup_edit resets slot pointer to 1 only when the prior lineup was empty", () => {
    // Case A: prior lineup was empty → pointer should jump to 1.
    const stateA = replay([
      startGame({ we_are_home: true, opposing_lineup: [] }),
      evt<OpposingLineupEditPayload>("opposing_lineup_edit", {
        opposing_lineup: oppLineup(),
      }),
    ]);
    expect(stateA.current_opp_batter_slot).toBe(1);

    // Case B: prior lineup non-empty and pointer is at 5 → must stay at 5
    // through the edit (mid-PA typo fixes don't reset who's batting).
    const events: GameEventRecord[] = [
      startGame({ we_are_home: true, opposing_lineup: oppLineup() }),
    ];
    for (let i = 0; i < 4; i++) {
      events.push(evt("at_bat", atBat({ half: "top", result: "K_swinging" })));
    }
    // After 4 PAs slot is 5.
    const stateBeforeEdit = replay(events);
    expect(stateBeforeEdit.current_opp_batter_slot).toBe(5);
    const replaced: OpposingLineupSlot[] = oppLineup().map((s) =>
      s.batting_order === 3 ? { ...s, last_name: "Fixed3" } : s,
    );
    const stateB = replay([
      ...events,
      evt<OpposingLineupEditPayload>("opposing_lineup_edit", {
        opposing_lineup: replaced,
      }),
    ]);
    expect(stateB.current_opp_batter_slot).toBe(5);
    expect(stateB.opposing_lineup[2].last_name).toBe("Fixed3");
  });

  it("opposing_lineup_edit can update opponent_use_dh", () => {
    const state = replay([
      startGame({ we_are_home: true, opposing_lineup: oppLineup(), opponent_use_dh: false }),
      evt<OpposingLineupEditPayload>("opposing_lineup_edit", {
        opposing_lineup: oppLineup(),
        opponent_use_dh: true,
      }),
    ]);
    expect(state.opponent_use_dh).toBe(true);
  });

  it("logs SB / CS / PIK events on ReplayState with runner_id and event_id", () => {
    const state = replay([
      startGame({ we_are_home: false }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("stolen_base", { runner_id: "p1", from: "first", to: "second" }, "sb-1"),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p2",
        runner_advances: [
          { from: "second", to: "third", player_id: "p1" },
          { from: "batter", to: "first", player_id: "p2" },
        ],
      })),
      evt("caught_stealing", { runner_id: "p2", from: "first" }, "cs-1"),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p3",
        runner_advances: [{ from: "batter", to: "first", player_id: "p3" }],
      })),
      evt("pickoff", { runner_id: "p3", from: "first" }, "pk-1"),
    ]);
    // catcher_id is null because we_are_home=false + half='top' means our
    // team was at-bat — the catcher on the field is the opponent's.
    expect(state.stolen_bases).toEqual([{ runner_id: "p1", event_id: "sb-1", catcher_id: null }]);
    expect(state.caught_stealing).toEqual([{ runner_id: "p2", event_id: "cs-1", catcher_id: null }]);
    expect(state.pickoffs).toEqual([{ runner_id: "p3", event_id: "pk-1", catcher_id: null }]);
  });
});

// Folding an authoritative event onto an existing state must match running
// `replay()` from scratch. Callers that consume the server's returned
// live_state + new event rely on this — if it ever drifts, optimistic UI and
// the Phase 1 round-trip elimination silently diverge from the server.
describe("applyEvent fold-equivalence with replay()", () => {
  beforeEach(() => { seq = 0; });

  it("reduce(applyEvent, INITIAL_STATE) === replay(events) for a representative game", () => {
    const events: GameEventRecord[] = [
      startGame({ we_are_home: false }),
      evt("pitch", { pitch_type: "ball" }),
      evt("pitch", { pitch_type: "called_strike" }),
      evt("at_bat", atBat({
        half: "top", result: "1B", batter_id: "p1",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      })),
      evt("stolen_base", { runner_id: "p1", from: "first", to: "second" }, "sb-fold"),
      evt("at_bat", atBat({
        half: "top", result: "K_swinging", batter_id: "p2",
      })),
      evt("at_bat", atBat({
        half: "top", result: "GO", batter_id: "p3",
      })),
      evt("at_bat", atBat({
        half: "top", result: "FO", batter_id: "p4",
      })),
      evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
    ];
    const fromReplay = replay(events);
    const fromFold = events.reduce(applyEvent, INITIAL_STATE);
    expect(fromFold).toEqual(fromReplay);
  });

  it("supersession filter is replay()'s responsibility, not applyEvent's", () => {
    // With corrections, replay() filters superseded events before folding.
    // applyEvent itself doesn't know about supersession — so a raw fold over
    // the unfiltered list will diverge. This test pins that contract so
    // callers that fold incrementally know they must apply only the
    // non-superseded tail (the server-returned events list already is).
    const startEvent = startGame({ we_are_home: false });
    const targetAB = evt("at_bat", atBat({
      half: "top", result: "1B", batter_id: "p1",
      runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
    }));
    const voidCorrection = evt<CorrectionPayload>("correction", {
      superseded_event_id: targetAB.id,
      corrected_event_type: null,
      corrected_payload: null,
    });
    const events: GameEventRecord[] = [startEvent, targetAB, voidCorrection];

    const fromReplay = replay(events);
    // replay() should have skipped the superseded at_bat — slot stays at 1.
    expect(fromReplay.current_batter_slot).toBe(1);
    expect(fromReplay.bases.first).toBeNull();

    // Raw unfiltered fold sees the at_bat AND the void correction; the
    // void correction is a no-op handler, so the at_bat's effect lingers.
    const naiveFold = events.reduce(applyEvent, INITIAL_STATE);
    expect(naiveFold.current_batter_slot).toBe(2);

    // The correct incremental pattern: drop the superseded events first.
    const supersededIds = new Set<string>();
    for (const e of events) {
      if (e.event_type === "correction") {
        supersededIds.add((e.payload as CorrectionPayload).superseded_event_id);
      }
    }
    const filteredFold = events
      .filter((e) => !supersededIds.has(e.id))
      .reduce(applyEvent, INITIAL_STATE);
    expect(filteredFold).toEqual(fromReplay);
  });
});
