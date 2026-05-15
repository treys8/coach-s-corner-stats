import { describe, expect, it } from "vitest";
import { rollupPitching } from "./pitching";
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
describe("rollupPitching", () => {
  it("includes only at-bats with a pitcher_id", () => {
    const atBats = [
      ab({ batter_id: null, pitcher_id: "ours", pitcher_of_record_id: "ours", result: "K_swinging", outs_recorded: 1 }),
      ab({ batter_id: null, pitcher_id: "ours", pitcher_of_record_id: "ours", result: "BB" }),
      ab({ batter_id: null, pitcher_id: "ours", pitcher_of_record_id: "ours", result: "1B" }),
      ab({ batter_id: null, pitcher_id: "ours", pitcher_of_record_id: "ours", result: "HR",
           runner_advances: [{ from: "batter", to: "home", player_id: null }] }),
      // our offense — should NOT appear in pitching
      ab({ batter_id: "p1", pitcher_id: null, result: "1B" }),
    ];
    const lines = rollupPitching(atBats);
    expect(lines.size).toBe(1);
    const line = lines.get("ours")!;
    expect(line.BF).toBe(4);
    expect(line.SO).toBe(1);
    expect(line.BB).toBe(1);
    expect(line.H).toBe(2);
    expect(line.HR).toBe(1);
    // HR R/ER credits ours (the pitcher who allowed the batter to reach).
    expect(line.R).toBe(1);
    expect(line.ER).toBe(1);
  });

  it("formats IP using baseball thirds (7 outs = 2.1, 9 outs = 3.0)", () => {
    const sevenOuts: DerivedAtBat[] = Array.from({ length: 7 }, () =>
      ab({ pitcher_id: "ours", pitcher_of_record_id: "ours", result: "GO", outs_recorded: 1 }));
    expect(rollupPitching(sevenOuts).get("ours")!.IP).toBeCloseTo(2.1, 6);

    const nineOuts = sevenOuts.concat(
      Array.from({ length: 2 }, () =>
        ab({ pitcher_id: "ours", pitcher_of_record_id: "ours", result: "GO", outs_recorded: 1 })),
    );
    expect(rollupPitching(nineOuts).get("ours")!.IP).toBeCloseTo(3.0, 6);
  });

  it("inherited runner: R/ER goes to the pitcher who put the runner on, not the current pitcher", () => {
    // pitcher A allowed two runners. pitcher B comes in, gives up a 2B that
    // scores both inherited runners. Both R go to A (ER too, since neither
    // runner reached on error).
    const basesAtScoringPA: Bases = {
      first: r("opp2", "A"),
      second: r("opp1", "A"),
      third: null,
    };
    const atBats = [
      ab({
        pitcher_id: "B",
        pitcher_of_record_id: "B",
        result: "2B",
        bases_before: basesAtScoringPA,
        runner_advances: [
          { from: "second", to: "home", player_id: "opp1" },
          { from: "first", to: "home", player_id: "opp2" },
          { from: "batter", to: "second", player_id: null },
        ],
      }),
    ];
    const lines = rollupPitching(atBats);
    const a = lines.get("A")!;
    const b = lines.get("B")!;
    expect(a.R).toBe(2);
    expect(a.ER).toBe(2);
    expect(b.R).toBe(0);
    expect(b.ER).toBe(0);
    // BF still goes to B (the pitcher facing this batter).
    expect(b.BF).toBe(1);
    expect(b.H).toBe(1);
  });

  it("ER excludes a run from a runner who reached on error", () => {
    const basesAtScoringPA: Bases = {
      first: r("opp1", "A", true), // reached on error
      second: null,
      third: null,
    };
    const atBats = [
      ab({
        pitcher_id: "A",
        pitcher_of_record_id: "A",
        result: "HR",
        bases_before: basesAtScoringPA,
        runner_advances: [
          { from: "first", to: "home", player_id: "opp1" },
          { from: "batter", to: "home", player_id: null },
        ],
      }),
    ];
    const a = rollupPitching(atBats).get("A")!;
    expect(a.R).toBe(2); // both runs charged
    expect(a.ER).toBe(1); // only the batter's run is earned (opp1 was tainted)
  });

  it("ER excludes a passed-ball non-PA run; includes a wild-pitch run", () => {
    const atBats: DerivedAtBat[] = [
      ab({ pitcher_id: "A", pitcher_of_record_id: "A", result: "GO", outs_recorded: 1 }),
    ];
    const nonPa = [
      { event_id: "e1", pitcher_id: "A", runs: 1, source: "passed_ball" as const },
      { event_id: "e2", pitcher_id: "A", runs: 1, source: "wild_pitch" as const },
      { event_id: "e3", pitcher_id: "A", runs: 1, source: "balk" as const },
      { event_id: "e4", pitcher_id: "A", runs: 1, source: "error_advance" as const },
      { event_id: "e5", pitcher_id: "A", runs: 1, source: "stolen_base" as const },
      { event_id: "e6", pitcher_id: "A", runs: 1, source: "advance_on_throw" as const },
    ];
    const a = rollupPitching(atBats, nonPa).get("A")!;
    expect(a.R).toBe(6);
    // Earned: WP + balk + SB-home + advance_on_throw = 4.
    // Unearned: PB + error_advance.
    expect(a.ER).toBe(4);
  });

  it("K3-PB with bases loaded: forced runner from third scores unearned", () => {
    // Bases loaded, batter strikes out swinging but the catcher misses
    // the third strike (passed ball). Batter forces to first, runner
    // from third forced home. The run is unearned (PDF §17 #2 — advanced
    // on a passed ball; without the PB, the K would have been the out).
    const atBats = [
      ab({
        batter_id: "p1",
        pitcher_id: "A",
        pitcher_of_record_id: "A",
        result: "K_swinging",
        batter_reached_on_k3: "PB",
        bases_before: {
          first: r("p2", "A"),
          second: r("p3", "A"),
          third: r("p4", "A"),
        },
        runner_advances: [
          { from: "third", to: "home", player_id: "p4" },
          { from: "second", to: "third", player_id: "p3" },
          { from: "first", to: "second", player_id: "p2" },
          { from: "batter", to: "first", player_id: "p1" },
        ],
      }),
    ];
    const a = rollupPitching(atBats).get("A")!;
    expect(a.SO).toBe(1);
    expect(a.R).toBe(1);
    expect(a.ER).toBe(0); // K3-PB taints all advances on the play
  });

  it("K3 batter who reached on E: pitcher SO++, batter at AB, batter unearned if scores", () => {
    // Batter K_swinging but reached on E. Pitcher gets the K. If batter
    // later scores, that run is unearned.
    const atBats = [
      ab({
        batter_id: "p1",
        pitcher_id: "A",
        pitcher_of_record_id: "A",
        result: "K_swinging",
        batter_reached_on_k3: "E",
        runner_advances: [{ from: "batter", to: "first", player_id: "p1" }],
      }),
      ab({
        pitcher_id: "A",
        pitcher_of_record_id: "A",
        result: "HR",
        bases_before: { first: r("p1", "A", true), second: null, third: null },
        runner_advances: [
          { from: "first", to: "home", player_id: "p1" },
          { from: "batter", to: "home", player_id: null },
        ],
      }),
    ];
    const a = rollupPitching(atBats).get("A")!;
    expect(a.SO).toBe(1);
    expect(a.R).toBe(2);
    expect(a.ER).toBe(1); // only the batter's run is earned
  });

  it("rolls up pitch counts and strike percentage from the pitch trail", () => {
    const atBats = [
      ab({
        pitcher_id: "p1",
        pitcher_of_record_id: "p1",
        result: "K_looking",
        outs_recorded: 1,
        pitches: [
          { pitch_type: "ball" },
          { pitch_type: "called_strike" },
          { pitch_type: "foul" },
          { pitch_type: "called_strike" },
        ],
      }),
      ab({
        pitcher_id: "p1",
        pitcher_of_record_id: "p1",
        result: "1B",
        runner_advances: [{ from: "batter", to: "first", player_id: null }],
        pitches: [
          { pitch_type: "ball" },
          { pitch_type: "in_play" },
        ],
      }),
    ];
    const line = rollupPitching(atBats).get("p1")!;
    expect(line.pitches).toBe(6);
    expect(line.strikes_thrown).toBe(4);
    expect(line.balls_thrown).toBe(2);
    expect(line.strike_pct).toBeCloseTo(4 / 6, 6);
  });

  // ---- Stage 6b — OSR 9.16 ER reconstruction --------------------------------

  it("OSR 9.16 canonical: HR after phantom 3rd out — both runs unearned", () => {
    // 2 outs, error lets batter reach (would have been 3rd out), HR scores 2.
    // Without reconstruction, the runner reached on error → unearned, but
    // the HR batter reached cleanly → earned (existing taint model gives 1 ER).
    // With reconstruction: the inning would have ended on the error play, so
    // BOTH runs are unearned (0 ER).
    const tainted = r("opp1", "A", true); // batter who reached on E
    const atBats: DerivedAtBat[] = [
      ab({ pitcher_id: "A", pitcher_of_record_id: "A", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "A", pitcher_of_record_id: "A", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "A", pitcher_of_record_id: "A", result: "E", outs_recorded: 0 }),
      ab({
        pitcher_id: "A",
        pitcher_of_record_id: "A",
        result: "HR",
        bases_before: { first: tainted, second: null, third: null },
        runner_advances: [
          { from: "first", to: "home", player_id: "opp1" },
          { from: "batter", to: "home", player_id: null },
        ],
        // Stage 6b: applyInningEnd would set this. Set directly for unit test.
        after_phantom_third_out: true,
      }),
      ab({ pitcher_id: "A", pitcher_of_record_id: "A", result: "K_swinging", outs_recorded: 1 }),
    ];
    const a = rollupPitching(atBats).get("A")!;
    expect(a.R).toBe(2);
    expect(a.ER).toBe(0);
  });

  it("ER reconstruction flag is set by replay() at inning_end", () => {
    // End-to-end: drive events through replay() and confirm that
    // applyInningEnd retroactively flags the HR as after_phantom_third_out.
    // Half-inning: GO, GO, E (batter reaches), HR (2 runs), K (3rd actual out),
    // then inning_end.
    const ourLineup: LineupSlot[] = Array.from({ length: 9 }, (_, i) => ({
      batting_order: i + 1,
      player_id: `p${i + 1}`,
      position: null,
    }));
    const events: GameEventRecord[] = [];
    let seq = 0;
    const evt = (
      type: GameEventRecord["event_type"],
      payload: object,
    ): GameEventRecord => {
      seq += 1;
      return {
        id: `e${seq}`,
        game_id: "g1",
        client_event_id: `c${seq}`,
        sequence_number: seq,
        event_type: type,
        payload: payload as GameEventRecord["payload"],
        supersedes_event_id: null,
        created_at: new Date(2026, 4, 15, 18, seq).toISOString(),
      };
    };

    events.push(
      evt("game_started", {
        we_are_home: true, // we're home → opp bats top of 1
        use_dh: false,
        starting_lineup: ourLineup,
        starting_pitcher_id: "A",
        opponent_starting_pitcher_id: "OP",
      } satisfies GameStartedPayload),
    );
    const opAB = (overrides: Partial<AtBatPayload> = {}): AtBatPayload => ({
      inning: 1,
      half: "top",
      batter_id: null,
      opponent_batter_id: "ob1",
      pitcher_id: "A",
      opponent_pitcher_id: null,
      batting_order: null,
      result: "GO",
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

    events.push(evt("at_bat", opAB({ result: "GO" })));
    events.push(evt("at_bat", opAB({ result: "GO" })));
    // E: batter reaches on error — replay tracks reached_on_error=true on
    // the new BaseRunner via applyAdvances' E branch. result="E" with
    // runner_advances batter→first.
    events.push(
      evt("at_bat", opAB({
        result: "E",
        runner_advances: [{ from: "batter", to: "first", player_id: "ob_err" }],
      })),
    );
    // HR — clean batter + tainted runner from 1st both score.
    events.push(
      evt("at_bat", opAB({
        result: "HR",
        rbi: 2,
        runner_advances: [
          { from: "first", to: "home", player_id: "ob_err" },
          { from: "batter", to: "home", player_id: null },
        ],
      })),
    );
    events.push(evt("at_bat", opAB({ result: "K_swinging" })));
    events.push(evt("inning_end", { inning: 1, half: "top" } satisfies InningEndPayload));

    const state = replay(events);
    // HR at_bat should have been flagged by inning_end.
    const hr = state.at_bats.find((a) => a.result === "HR")!;
    expect(hr.after_phantom_third_out).toBe(true);

    // Now the rollup: 0 ER, 2 R.
    const a = rollupPitching(state.at_bats, state.non_pa_runs).get("A")!;
    expect(a.R).toBe(2);
    expect(a.ER).toBe(0);
  });

  it("game_finalized runs reconstruction on the in-progress half (walk-off / mercy)", () => {
    // Phantom 3rd out from an E in the top half, then a HR that scored,
    // then finalize WITHOUT an inning_end. The HR should still be flagged.
    const ourLineup: LineupSlot[] = Array.from({ length: 9 }, (_, i) => ({
      batting_order: i + 1,
      player_id: `p${i + 1}`,
      position: null,
    }));
    let seq = 0;
    const evt = (
      type: GameEventRecord["event_type"],
      payload: object,
    ): GameEventRecord => {
      seq += 1;
      return {
        id: `e${seq}`,
        game_id: "g1",
        client_event_id: `c${seq}`,
        sequence_number: seq,
        event_type: type,
        payload: payload as GameEventRecord["payload"],
        supersedes_event_id: null,
        created_at: new Date(2026, 4, 15, 18, seq).toISOString(),
      };
    };
    const opAB = (overrides: Partial<AtBatPayload> = {}): AtBatPayload => ({
      inning: 1,
      half: "top",
      batter_id: null,
      opponent_batter_id: "ob1",
      pitcher_id: "A",
      opponent_pitcher_id: null,
      batting_order: null,
      result: "GO",
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

    const events: GameEventRecord[] = [
      evt("game_started", {
        we_are_home: true,
        use_dh: false,
        starting_lineup: ourLineup,
        starting_pitcher_id: "A",
        opponent_starting_pitcher_id: "OP",
      } satisfies GameStartedPayload),
      evt("at_bat", opAB({ result: "GO" })),
      evt("at_bat", opAB({ result: "GO" })),
      evt("at_bat", opAB({
        result: "E",
        runner_advances: [{ from: "batter", to: "first", player_id: "ob_err" }],
      })),
      evt("at_bat", opAB({
        result: "HR",
        rbi: 2,
        runner_advances: [
          { from: "first", to: "home", player_id: "ob_err" },
          { from: "batter", to: "home", player_id: null },
        ],
      })),
      evt("game_finalized", {}),
    ];

    const state = replay(events);
    const hr = state.at_bats.find((a) => a.result === "HR")!;
    expect(hr.after_phantom_third_out).toBe(true);
    expect(rollupPitching(state.at_bats, state.non_pa_runs).get("A")!.ER).toBe(0);
  });

  it("non-PA wild-pitch run after phantom 3rd out is unearned", () => {
    // Half-inning with an early error, then 2 GOs (closing the reconstructed
    // half), then a wild pitch scores a run. WP is normally earned, but
    // after phantom 3rd out it becomes unearned.
    const atBats: DerivedAtBat[] = [
      ab({ pitcher_id: "A", pitcher_of_record_id: "A", result: "E", outs_recorded: 0 }),
      ab({ pitcher_id: "A", pitcher_of_record_id: "A", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "A", pitcher_of_record_id: "A", result: "GO", outs_recorded: 1 }),
    ];
    const nonPaRuns = [
      {
        event_id: "npr-1",
        pitcher_id: "A",
        runs: 1,
        source: "wild_pitch" as const,
        after_phantom_third_out: true,
      },
    ];
    const a = rollupPitching(atBats, nonPaRuns).get("A")!;
    expect(a.R).toBe(1);
    expect(a.ER).toBe(0);
  });
});
