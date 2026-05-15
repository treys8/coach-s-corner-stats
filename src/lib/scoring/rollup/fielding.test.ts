import { describe, expect, it } from "vitest";
import { rollupFielding } from "./fielding";
import { replay } from "../replay";
import { EMPTY_BASES } from "../types";
import type {
  AtBatPayload,
  BaseRunner,
  Bases,
  DerivedAtBat,
  GameEventRecord,
  GameStartedPayload,
  InningEndPayload,
  LineupSlot,
  RunnerMovePayload,
  StolenBasePayload,
  SubstitutionPayload,
} from "../types";

let nextId = 0;
function ab(overrides: Partial<DerivedAtBat>): DerivedAtBat {
  nextId += 1;
  return {
    event_id: `e${nextId}`,
    inning: 1,
    half: "top",
    batting_order: 1,
    batter_id: null,
    opponent_batter_id: null,
    pitcher_id: null,
    opponent_pitcher_id: null,
    result: "GO",
    rbi: 0,
    pitch_count: 0,
    balls: 0,
    strikes: 0,
    spray_x: null,
    spray_y: null,
    fielder_position: null,
    runs_scored_on_play: 0,
    outs_recorded: 0,
    runner_advances: [],
    pitcher_of_record_id: null,
    bases_before: { ...EMPTY_BASES },
    description: null,
    pitches: [],
    ...overrides,
  };
}

const r = (playerId: string, pitcherId: string | null = null, reachedOnError = false): BaseRunner => ({
  player_id: playerId,
  pitcher_of_record_id: pitcherId,
  reached_on_error: reachedOnError,
});
// ---- rollupFielding tests --------------------------------------------------
//
// These exercise the full replay pipeline (events → ReplayState →
// rollupFielding) so the per-event snapshot capture in applyAtBat /
// catcher-event handlers is verified end-to-end.

describe("rollupFielding", () => {
  const DEFAULT_LINEUP: LineupSlot[] = [
    { batting_order: 1, player_id: "p-c",  position: "C" },
    { batting_order: 2, player_id: "p-1b", position: "1B" },
    { batting_order: 3, player_id: "p-2b", position: "2B" },
    { batting_order: 4, player_id: "p-3b", position: "3B" },
    { batting_order: 5, player_id: "p-ss", position: "SS" },
    { batting_order: 6, player_id: "p-lf", position: "LF" },
    { batting_order: 7, player_id: "p-cf", position: "CF" },
    { batting_order: 8, player_id: "p-rf", position: "RF" },
    { batting_order: 9, player_id: "p-dh", position: null }, // DH
  ];

  let evSeq = 0;
  function ev<T>(event_type: GameEventRecord["event_type"], payload: T): GameEventRecord {
    evSeq += 1;
    return {
      id: `ev-${evSeq}`,
      game_id: "g1",
      client_event_id: `c-${evSeq}`,
      sequence_number: evSeq,
      event_type,
      payload: payload as never,
      supersedes_event_id: null,
      created_at: new Date(2026, 0, 1, 0, 0, evSeq).toISOString(),
    };
  }

  function startGame(lineup: LineupSlot[] = DEFAULT_LINEUP): GameEventRecord {
    evSeq = 0;
    return ev<GameStartedPayload>("game_started", {
      we_are_home: true, // top = opponent bats → we field
      use_dh: true,
      starting_lineup: lineup,
      starting_pitcher_id: "p-pitcher",
      opponent_starting_pitcher_id: "opp-pitcher",
    });
  }

  function fieldingPA(overrides: Partial<AtBatPayload> & { result: AtBatPayload["result"] }): GameEventRecord {
    return ev<AtBatPayload>("at_bat", {
      inning: 1,
      half: "top",
      batter_id: null,
      pitcher_id: "p-pitcher",
      opponent_pitcher_id: "opp-pitcher",
      batting_order: null,
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
  }

  it("credits the catcher PO on a strikeout", () => {
    const events = [
      startGame(),
      fieldingPA({ result: "K_swinging" }),
      fieldingPA({ result: "K_looking" }),
      fieldingPA({ result: "K_swinging" }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    const catcher = fielding.get("p-c")!;
    expect(catcher.PO).toBe(3);
    expect(catcher.E).toBe(0);
    expect(catcher.A).toBe(0); // Phase A: A always 0
    expect(catcher.TC).toBe(3);
    expect(catcher.FPCT).toBeCloseTo(1.0, 6);
    // Other defenders get 0 PO but full defensive innings.
    expect(fielding.get("p-ss")!.PO).toBe(0);
  });

  it("credits the primary fielder PO on a groundout to SS", () => {
    const events = [
      startGame(),
      fieldingPA({ result: "GO", fielder_position: "SS" }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    expect(fielding.get("p-ss")!.PO).toBe(1);
    expect(fielding.get("p-c")!.PO).toBe(0);
  });

  it("credits the primary fielder E on result === E", () => {
    const events = [
      startGame(),
      fieldingPA({
        result: "E",
        fielder_position: "3B",
        runner_advances: [{ from: "batter", to: "first", player_id: null }],
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    const thirdBase = fielding.get("p-3b")!;
    expect(thirdBase.E).toBe(1);
    expect(thirdBase.PO).toBe(0);
    expect(thirdBase.TC).toBe(1);
    expect(thirdBase.FPCT).toBe(0); // (PO+A)/TC = 0/1
  });

  it("counts DP / TP on the primary fielder", () => {
    const events = [
      startGame(),
      fieldingPA({
        result: "DP",
        fielder_position: "SS",
        runner_advances: [
          { from: "batter", to: "out", player_id: null },
          { from: "first", to: "out", player_id: null },
        ],
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    expect(fielding.get("p-ss")!.DP).toBe(1);
    expect(fielding.get("p-ss")!.TP).toBe(0);
    // Phase A: no PO credit for DP plays (no chain capture yet).
    expect(fielding.get("p-ss")!.PO).toBe(0);
  });

  // ---- Stage 3 fielder_chain attribution ------------------------------------

  it("Stage 3: credits A on each non-terminal chain step and PO on the terminal step", () => {
    const events = [
      startGame(),
      fieldingPA({
        result: "GO",
        fielder_chain: [
          { position: "SS", action: "fielded" },
          { position: "1B", action: "received", target: "first" },
        ],
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    const ss = fielding.get("p-ss")!;
    const first = fielding.get("p-1b")!;
    expect(ss.A).toBe(1);
    expect(ss.PO).toBe(0);
    expect(first.PO).toBe(1);
    expect(first.A).toBe(0);
    // TC should now include the assist on top of PO.
    expect(ss.TC).toBe(1);
    expect(first.TC).toBe(1);
  });

  it("Stage 3: caught fly to CF credits only the outfielder PO", () => {
    const events = [
      startGame(),
      fieldingPA({
        result: "FO",
        fielder_chain: [{ position: "CF", action: "caught" }],
        batted_ball_type: "fly",
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    expect(fielding.get("p-cf")!.PO).toBe(1);
    expect(fielding.get("p-cf")!.A).toBe(0);
    // No other fielder gets PO from this play.
    expect(fielding.get("p-ss")?.PO ?? 0).toBe(0);
  });

  it("Stage 3: error_step_index swaps PO/A for E on that step", () => {
    // 6-3 grounder where the SS makes a bad throw: result still "1B"
    // because batter is safe, but SS gets E and 1B gets... nothing in this
    // version (chain ends with no out, so terminal collapses to A).
    const events = [
      startGame(),
      fieldingPA({
        result: "1B",
        fielder_chain: [
          { position: "SS", action: "fielded" },
          { position: "1B", action: "received", target: "first" },
        ],
        error_step_index: 0,
        runner_advances: [{ from: "batter", to: "first", player_id: null }],
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    const ss = fielding.get("p-ss")!;
    const first = fielding.get("p-1b")!;
    expect(ss.E).toBe(1);
    expect(ss.A).toBe(0);
    expect(first.A).toBe(1); // terminal step collapsed to A (no out)
    expect(first.PO).toBe(0);
  });

  it("Stage 3: legacy events without fielder_chain still use fielder_position", () => {
    const events = [
      startGame(),
      fieldingPA({ result: "GO", fielder_position: "SS" }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    // Legacy path: PO on the primary fielder, A stays at 0.
    expect(fielding.get("p-ss")!.PO).toBe(1);
    expect(fielding.get("p-ss")!.A).toBe(0);
  });

  it("credits PB to the catcher in play at the moment", () => {
    const events = [
      startGame(),
      ev<RunnerMovePayload>("passed_ball", { advances: [] }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    expect(fielding.get("p-c")!.PB).toBe(1);
  });

  it("credits SB / CS / SBATT / CS% to the catcher", () => {
    const events = [
      startGame(),
      // Opp batter walks (so we have a runner on first).
      fieldingPA({
        result: "BB",
        runner_advances: [{ from: "batter", to: "first", player_id: null }],
      }),
      // Runner steals second.
      ev<StolenBasePayload>("stolen_base", { runner_id: null, from: "first", to: "second" }),
      // Another opp PA, walks again to put a runner on first.
      fieldingPA({
        result: "BB",
        runner_advances: [
          { from: "second", to: "second", player_id: null }, // no movement
          { from: "batter", to: "first", player_id: null },
        ],
      }),
      // Caught stealing.
      ev("caught_stealing", { runner_id: null, from: "first" }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    const catcher = fielding.get("p-c")!;
    expect(catcher.SB).toBe(1);
    expect(catcher.CS).toBe(1);
    expect(catcher.SBATT).toBe(2);
    expect(catcher["CS%"]).toBeCloseTo(0.5, 6);
  });

  it("accumulates per-position innings across a mid-game catcher sub", () => {
    const events = [
      startGame(),
      // Top 1: 3 strikeouts.
      fieldingPA({ result: "K_swinging" }),
      fieldingPA({ result: "K_swinging" }),
      fieldingPA({ result: "K_swinging" }),
      ev<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
      // Bottom 1: we bat (skip details — just end it).
      ev<InningEndPayload>("inning_end", { inning: 1, half: "bottom" }),
      // Sub in a new catcher at slot 1.
      ev<SubstitutionPayload>("substitution", {
        out_player_id: "p-c",
        in_player_id: "p-c2",
        batting_order: 1,
        position: "C",
        sub_type: "regular",
      }),
      // Top 2: 3 more strikeouts with new catcher.
      fieldingPA({ inning: 2, half: "top", result: "K_swinging" }),
      fieldingPA({ inning: 2, half: "top", result: "K_swinging" }),
      fieldingPA({ inning: 2, half: "top", result: "K_swinging" }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    const c1 = fielding.get("p-c")!;
    const c2 = fielding.get("p-c2")!;
    // Each catcher fielded 3 outs at C = 1.0 inning at C.
    expect(c1.C).toBeCloseTo(1.0, 6);
    expect(c2.C).toBeCloseTo(1.0, 6);
    expect(c1.Total).toBeCloseTo(1.0, 6);
    expect(c2.Total).toBeCloseTo(1.0, 6);
    // PO credit follows the catcher of record at the moment of each K.
    expect(c1.PO).toBe(3);
    expect(c2.PO).toBe(3);
  });

  it("does not credit catcher PO on an uncaught third strike", () => {
    // Pitcher gets the K but the batter reached on a dropped K3 (PB/E/WP).
    // Catcher should NOT accrue a PO because they did not catch the third
    // strike. Verifies the batter_reached_on_k3 guard in rollupFielding.
    const events = [
      startGame(),
      fieldingPA({
        result: "K_swinging",
        batter_reached_on_k3: "PB",
        runner_advances: [{ from: "batter", to: "first", player_id: null }],
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    // Catcher accrued defensive innings (no out_recorded since batter
    // reached) but no PO. With outs=0, FPCT denominator is 0.
    const catcher = fielding.get("p-c");
    expect(catcher?.PO ?? 0).toBe(0);
  });

  it("uses current_pitcher_id for 'P', not a stale lineup slot", () => {
    // Build a non-DH game where slot 9 starts as p-pitcher at position 'P'.
    // After a pitching_change to a reliever, current_pitcher_id flips but
    // the lineup slot at 'P' isn't touched until a later substitution.
    // Defensive innings must credit the reliever (not the starter) for
    // outs recorded after the change.
    const noDhLineup: LineupSlot[] = [
      ...DEFAULT_LINEUP.slice(0, 8),
      { batting_order: 9, player_id: "p-pitcher", position: "P" },
    ];
    evSeq = 0;
    const events: GameEventRecord[] = [
      ev<GameStartedPayload>("game_started", {
        we_are_home: true,
        use_dh: false,
        starting_lineup: noDhLineup,
        starting_pitcher_id: "p-pitcher",
        opponent_starting_pitcher_id: "opp-pitcher",
      }),
      // 1 out by starter.
      fieldingPA({ result: "K_swinging" }),
      // Pitching change — starter out, reliever in. Lineup slot at 'P'
      // intentionally not updated to exercise the staleness guard.
      ev("pitching_change", { out_pitcher_id: "p-pitcher", in_pitcher_id: "p-reliever" }),
      // 1 out by reliever.
      fieldingPA({ result: "K_swinging", pitcher_id: "p-reliever" }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    // Each pitcher should have exactly 1 out at P = 1/3 inning.
    expect(fielding.get("p-pitcher")!.P).toBeCloseTo(1 / 3, 6);
    expect(fielding.get("p-reliever")!.P).toBeCloseTo(1 / 3, 6);
    // No double-count: total innings each = 1/3, not 2/3.
    expect(fielding.get("p-pitcher")!.Total).toBeCloseTo(1 / 3, 6);
    expect(fielding.get("p-reliever")!.Total).toBeCloseTo(1 / 3, 6);
  });

  it("does not credit our catcher when we are batting", () => {
    // Symmetric to the catcher-event test, but the event fires during our
    // half (bottom 1). The PB / SB belong to the opposing catcher, who we
    // do not track — our 'p-c' must NOT accrue PB or SB.
    const events = [
      startGame(),
      // End top half so we move into bottom (we bat).
      ev<InningEndPayload>("inning_end", { inning: 1, half: "top" }),
      // We're batting now — a runner gets on for us.
      ev<AtBatPayload>("at_bat", {
        inning: 1,
        half: "bottom",
        batter_id: "p-2b",
        pitcher_id: null,
        opponent_pitcher_id: "opp-pitcher",
        batting_order: 3,
        result: "1B",
        rbi: 0, pitch_count: 0, balls: 0, strikes: 0,
        spray_x: null, spray_y: null, fielder_position: null,
        runner_advances: [{ from: "batter", to: "first", player_id: "p-2b" }],
        description: null,
      }),
      // Our runner steals second — opponent catcher should be credited
      // SB-allowed, not ours.
      ev<StolenBasePayload>("stolen_base", { runner_id: "p-2b", from: "first", to: "second" }),
      // PB lets him to third — opponent catcher's PB, not ours.
      ev<RunnerMovePayload>("passed_ball", {
        advances: [{ from: "second", to: "third", player_id: "p-2b" }],
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
    });
    const catcher = fielding.get("p-c");
    // Our catcher accrued no SB / PB and shouldn't be in the map at all
    // (no defensive innings either, since the half was us batting).
    expect(catcher).toBeUndefined();
  });

  it("credits A/PO from a caught_stealing fielder_chain (2-6 throw to SS)", () => {
    // Classic CS at 2nd: catcher fields the steal attempt, throws to SS
    // who tags the runner. Catcher: CS (catcher stat) + A (chain non-
    // terminal). SS: PO (chain terminal).
    const events = [
      startGame(),
      // Put an opp runner on first via a single.
      fieldingPA({
        result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp-r1" }],
      }),
      ev("caught_stealing", {
        runner_id: "opp-r1",
        from: "first",
        fielder_chain: [
          { position: "C",  action: "fielded", target: "second" },
          { position: "SS", action: "tagged" },
        ],
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
      error_advance_fielders: state.error_advance_fielders,
    });
    expect(fielding.get("p-c")!.CS).toBe(1);
    expect(fielding.get("p-c")!.A).toBe(1);
    expect(fielding.get("p-ss")!.PO).toBe(1);
  });

  it("credits A/PO from a pickoff fielder_chain (3-6 back-pick)", () => {
    // Pickoff with 1B catching the throw, then throwing to SS at 2nd.
    const events = [
      startGame(),
      fieldingPA({
        result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp-r2" }],
      }),
      ev("pickoff", {
        runner_id: "opp-r2",
        from: "first",
        fielder_chain: [
          { position: "1B", action: "fielded", target: "second" },
          { position: "SS", action: "tagged" },
        ],
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
      error_advance_fielders: state.error_advance_fielders,
    });
    expect(fielding.get("p-1b")!.A).toBe(1);
    expect(fielding.get("p-ss")!.PO).toBe(1);
    // Catcher gets PIK credit (catcher stat) even though the chain didn't
    // include them — that's pre-existing engine behavior.
    expect(fielding.get("p-c")!.PIK).toBe(1);
  });

  it("credits +1 E from error_advance with error_fielder_position", () => {
    const events = [
      startGame(),
      fieldingPA({
        result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp-r3" }],
      }),
      // Between-PA error: runner advances 1→3 on a wild throw by SS.
      ev<RunnerMovePayload>("error_advance", {
        advances: [{ from: "first", to: "third", player_id: "opp-r3" }],
        error_fielder_position: "SS",
        error_type: "throwing",
      }),
    ];
    const state = replay(events);
    const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
      stolen_bases: state.stolen_bases,
      caught_stealing: state.caught_stealing,
      pickoffs: state.pickoffs,
      passed_balls: state.passed_balls,
      error_advance_fielders: state.error_advance_fielders,
    });
    expect(fielding.get("p-ss")!.E).toBe(1);
  });

  it("state.caught_stealing entries echo `from`", () => {
    const events = [
      startGame(),
      fieldingPA({
        result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: "opp-r4" }],
      }),
      ev("caught_stealing", { runner_id: "opp-r4", from: "first" }),
    ];
    const state = replay(events);
    expect(state.caught_stealing).toHaveLength(1);
    expect(state.caught_stealing[0].from).toBe("first");
  });
});
