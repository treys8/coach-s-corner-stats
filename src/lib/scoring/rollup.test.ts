import { describe, expect, it } from "vitest";
import { computeWLS, rollupBatting, rollupFielding, rollupPitching, verifyBoxScore } from "./rollup";
import { replay } from "./replay";
import { EMPTY_BASES } from "./types";
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
} from "./types";

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

describe("rollupBatting", () => {
  it("classifies AB vs PA correctly across all relevant outcomes", () => {
    const atBats: DerivedAtBat[] = [
      ab({ batter_id: "p1", result: "1B" }),
      ab({ batter_id: "p1", result: "2B" }),
      ab({ batter_id: "p1", result: "3B" }),
      ab({ batter_id: "p1", result: "HR", rbi: 1 }),
      ab({ batter_id: "p1", result: "BB" }),
      ab({ batter_id: "p1", result: "HBP" }),
      ab({ batter_id: "p1", result: "K_swinging" }),
      ab({ batter_id: "p1", result: "K_looking" }),
      ab({ batter_id: "p1", result: "SAC" }),
      ab({ batter_id: "p1", result: "SF", rbi: 1 }),
      ab({ batter_id: "p1", result: "GO", outs_recorded: 1 }),
    ];
    const lines = rollupBatting(atBats);
    const line = lines.get("p1")!;
    expect(line.PA).toBe(11);
    // AB excludes BB, HBP, SAC, SF — 11 PA - 4 = 7
    expect(line.AB).toBe(7);
    expect(line.H).toBe(4);
    expect(line["1B"]).toBe(1);
    expect(line["2B"]).toBe(1);
    expect(line["3B"]).toBe(1);
    expect(line.HR).toBe(1);
    expect(line.BB).toBe(1);
    expect(line.SO).toBe(2);
    expect(line.HBP).toBe(1);
    expect(line.SF).toBe(1);
    expect(line.SH).toBe(1);
    expect(line.RBI).toBe(2);
  });

  it("counts CI as PA-not-AB and increments BattingLine.CI", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "CI" }),
      ab({ batter_id: "p1", result: "1B" }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.PA).toBe(2);
    expect(line.AB).toBe(1); // CI is non-AB
    expect(line.CI).toBe(1);
  });

  it("computes AVG/OBP/SLG/OPS from counts", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "1B" }),
      ab({ batter_id: "p1", result: "HR" }),
      ab({ batter_id: "p1", result: "BB" }),
      ab({ batter_id: "p1", result: "K_swinging" }),
      ab({ batter_id: "p1", result: "GO", outs_recorded: 1 }),
      ab({ batter_id: "p1", result: "SF", rbi: 1 }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.AB).toBe(4);
    expect(line.H).toBe(2);
    expect(line.AVG).toBeCloseTo(0.5, 3);
    expect(line.SLG).toBeCloseTo(1.25, 3);
    expect(line.OBP).toBeCloseTo(0.5, 3);
    expect(line.OPS).toBeCloseTo(1.75, 3);
  });

  it("returns 0 rates for a batter with zero AB (walks only)", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "BB" }),
      ab({ batter_id: "p1", result: "HBP" }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.AB).toBe(0);
    expect(line.AVG).toBe(0);
    expect(line.SLG).toBe(0);
    expect(line.OBP).toBeCloseTo(1.0, 3);
    expect(line.OPS).toBeCloseTo(1.0, 3);
  });

  it("excludes opponent PAs (batter_id null) from batting lines", () => {
    const atBats = [
      ab({ batter_id: null, result: "1B", pitcher_id: "ourPitcher" }),
      ab({ batter_id: "p1", result: "1B" }),
    ];
    const lines = rollupBatting(atBats);
    expect(lines.size).toBe(1);
    expect(lines.has("p1")).toBe(true);
  });

  it("credits R to runners who advance to home", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "BB" }),
      ab({
        batter_id: "p2",
        result: "2B",
        rbi: 1,
        runner_advances: [
          { from: "first", to: "home", player_id: "p1" },
          { from: "batter", to: "second", player_id: "p2" },
        ],
      }),
    ];
    const lines = rollupBatting(atBats);
    expect(lines.get("p1")!.R).toBe(1);
    expect(lines.get("p2")!.R).toBe(0);
    expect(lines.get("p2")!.RBI).toBe(1);
  });

  it("credits R to the batter on a solo HR", () => {
    const atBats = [
      ab({
        batter_id: "p1",
        result: "HR",
        rbi: 1,
        runner_advances: [{ from: "batter", to: "home", player_id: "p1" }],
      }),
    ];
    expect(rollupBatting(atBats).get("p1")!.R).toBe(1);
  });
});

describe("rollupBatting — GameChanger-parity stats", () => {
  it("splits K-L from total SO", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "K_swinging" }),
      ab({ batter_id: "p1", result: "K_looking" }),
      ab({ batter_id: "p1", result: "K_looking" }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.SO).toBe(3);
    expect(line["K-L"]).toBe(2);
  });

  it("counts ROE, FC, GIDP, GITP from at-bat results", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "E" }),
      ab({ batter_id: "p1", result: "FC", outs_recorded: 1 }),
      ab({ batter_id: "p1", result: "DP", outs_recorded: 2 }),
      ab({ batter_id: "p1", result: "TP", outs_recorded: 3 }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.ROE).toBe(1);
    expect(line.FC).toBe(1);
    expect(line.GIDP).toBe(1);
    expect(line.GITP).toBe(1);
    // DP / TP still count as AB (PG-style); only the official PA-not-AB results don't.
    expect(line.AB).toBe(4);
  });

  it("computes TB and XBH from hit breakdown", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "1B" }),
      ab({ batter_id: "p1", result: "2B" }),
      ab({ batter_id: "p1", result: "3B" }),
      ab({ batter_id: "p1", result: "HR" }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.TB).toBe(1 + 2 + 3 + 4);
    expect(line.XBH).toBe(3);
  });

  it("counts PS, 6+, and 2S+3 from the pitch trail", () => {
    const atBats = [
      // 7-pitch PA, reaches 2 strikes on pitch 2, then 5 more pitches (all
      // after 2 strikes). Should flag both 6+ and 2S+3.
      ab({
        batter_id: "p1",
        result: "K_looking",
        pitches: [
          { pitch_type: "called_strike" },
          { pitch_type: "called_strike" },
          { pitch_type: "foul" },
          { pitch_type: "foul" },
          { pitch_type: "ball" },
          { pitch_type: "foul" },
          { pitch_type: "called_strike" },
        ],
      }),
      // 4-pitch PA with no 2S+3 flag (PA ends as count first hits 2 strikes).
      ab({
        batter_id: "p1",
        result: "1B",
        pitches: [
          { pitch_type: "ball" },
          { pitch_type: "called_strike" },
          { pitch_type: "ball" },
          { pitch_type: "in_play" },
        ],
      }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.PS).toBe(11);
    expect(line["6+"]).toBe(1);
    expect(line["2S+3"]).toBe(1);
    expect(line["PS/PA"]).toBeCloseTo(11 / 2, 6);
    expect(line["6+%"]).toBeCloseTo(0.5, 6);
    expect(line["2S+3%"]).toBeCloseTo(0.5, 6);
  });

  it("credits 2OUTRBI only for RBI on PAs that began with 2 outs", () => {
    // First two PAs each record one out (no RBI). Third PA starts with 2
    // outs and drives in a run.
    const atBats = [
      ab({ batter_id: "p1", result: "GO", outs_recorded: 1 }),
      ab({ batter_id: "p2", result: "GO", outs_recorded: 1 }),
      ab({
        batter_id: "p3",
        result: "1B",
        rbi: 2,
        runner_advances: [
          { from: "third", to: "home", player_id: "rA" },
          { from: "second", to: "home", player_id: "rB" },
          { from: "batter", to: "first", player_id: "p3" },
        ],
      }),
    ];
    const lines = rollupBatting(atBats);
    expect(lines.get("p3")!["2OUTRBI"]).toBe(2);
    expect(lines.get("p1")!["2OUTRBI"]).toBe(0);
  });

  it("credits LOB to the batter who made the half-ending out with runners on", () => {
    // Batter 1 walks. Batter 2 walks. Batter 3 strikes out for the 1st out.
    // Batter 4 grounds into a double play with runners on first and second
    // (cleared via the advances). Then batter 5 flies out to end the half
    // with one runner still on second.
    const atBats = [
      // PA1: walk, batter to first.
      ab({
        inning: 1, half: "top",
        batter_id: "b1", result: "BB",
        runner_advances: [{ from: "batter", to: "first", player_id: "b1" }],
      }),
      // PA2: walk; runner from first to second; batter to first.
      ab({
        inning: 1, half: "top",
        batter_id: "b2", result: "BB",
        bases_before: { first: r("b1"), second: null, third: null },
        runner_advances: [
          { from: "first", to: "second", player_id: "b1" },
          { from: "batter", to: "first", player_id: "b2" },
        ],
      }),
      // PA3: strikeout for 1 out, no advances.
      ab({
        inning: 1, half: "top",
        batter_id: "b3", result: "K_swinging", outs_recorded: 1,
        bases_before: { first: r("b2"), second: r("b1"), third: null },
      }),
      // PA4: 1B; runner from second scores, runner from first to second,
      // batter to first. Outs unchanged.
      ab({
        inning: 1, half: "top",
        batter_id: "b4", result: "1B",
        bases_before: { first: r("b2"), second: r("b1"), third: null },
        rbi: 1,
        runner_advances: [
          { from: "second", to: "home", player_id: "b1" },
          { from: "first", to: "second", player_id: "b2" },
          { from: "batter", to: "first", player_id: "b4" },
        ],
      }),
      // PA5: GO ends the half with runners on first and second still on.
      // outs reach 3 → LOB credited to b5.
      ab({
        inning: 1, half: "top",
        batter_id: "b5", result: "GO", outs_recorded: 2,
        bases_before: { first: r("b4"), second: r("b2"), third: null },
      }),
    ];
    const lines = rollupBatting(atBats);
    expect(lines.get("b5")!.LOB).toBe(2);
    expect(lines.get("b3")!.LOB).toBe(0);
    expect(lines.get("b4")!.LOB).toBe(0);
  });

  it("flushes LOB on a walk-off (half ends without 3 outs)", () => {
    // Bottom of the 9th, tied 0-0, runner on second. Batter singles,
    // runner scores, game ends. Half closes without the 3rd out — LOB
    // should credit the walk-off batter for the runner who stayed on first.
    const atBats = [
      ab({
        inning: 9, half: "bottom",
        batter_id: "hero", result: "1B",
        bases_before: { first: null, second: r("teammate"), third: null },
        rbi: 1,
        runner_advances: [
          { from: "second", to: "home", player_id: "teammate" },
          { from: "batter", to: "first", player_id: "hero" },
        ],
      }),
    ];
    const line = rollupBatting(atBats).get("hero")!;
    expect(line.LOB).toBe(1);
  });

  it("computes BABIP, BA/RISP, BB/K, C%, AB/HR from counts", () => {
    const atBats = [
      // RISP hit: runner on second when batter singles.
      ab({
        batter_id: "p1", result: "1B",
        bases_before: { first: null, second: r("r1"), third: null },
        runner_advances: [
          { from: "second", to: "home", player_id: "r1" },
          { from: "batter", to: "first", player_id: "p1" },
        ],
        rbi: 1,
      }),
      // RISP AB out: runner on third when batter grounds out.
      ab({
        batter_id: "p1", result: "GO", outs_recorded: 1,
        bases_before: { first: null, second: null, third: r("r2") },
      }),
      // Non-RISP HR: bases empty.
      ab({ batter_id: "p1", result: "HR" }),
      // Two strikeouts and a walk for BB/K and C% denominators.
      ab({ batter_id: "p1", result: "K_swinging" }),
      ab({ batter_id: "p1", result: "K_swinging" }),
      ab({ batter_id: "p1", result: "BB" }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    // 2 hits / 5 AB
    expect(line.AVG).toBeCloseTo(2 / 5, 6);
    // BABIP = (H - HR) / (AB - SO - HR + SF) = (2-1)/(5-2-1+0) = 1/2
    expect(line.BABIP).toBeCloseTo(0.5, 6);
    // BA/RISP = 1 hit / 2 RISP AB
    expect(line["BA/RISP"]).toBeCloseTo(0.5, 6);
    // BB/K = 1 / 2
    expect(line["BB/K"]).toBeCloseTo(0.5, 6);
    // C% = (AB-SO)/AB = (5-2)/5 = 0.6
    expect(line["C%"]).toBeCloseTo(0.6, 6);
    // AB/HR = 5/1
    expect(line["AB/HR"]).toBe(5);
  });

  it("returns 0 for rates with empty denominators (BABIP, BB/K, AB/HR)", () => {
    // Walks-and-Ks only batter: AB=0, BABIP/AB-HR undefined; SO>0 but BB=0,
    // so BB/K = 0.
    const atBats = [
      ab({ batter_id: "p1", result: "K_swinging" }),
      ab({ batter_id: "p1", result: "K_swinging" }),
      ab({ batter_id: "p1", result: "BB" }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.AB).toBe(2);
    expect(line.BABIP).toBe(0); // (0-0)/(2-2-0+0) → safeDiv 0/0
    expect(line["AB/HR"]).toBe(0); // HR=0 → safeDiv
    expect(line["BB/K"]).toBeCloseTo(0.5, 6);
  });

  it("credits SB / CS / PIK from the runner-event log", () => {
    const atBats: DerivedAtBat[] = [];
    const runnerEvents = {
      stolen_bases: [{ runner_id: "p1" }, { runner_id: "p1" }, { runner_id: "p2" }],
      caught_stealing: [{ runner_id: "p1" }],
      pickoffs: [{ runner_id: "p2" }],
    };
    const lines = rollupBatting(atBats, runnerEvents);
    expect(lines.get("p1")!.SB).toBe(2);
    expect(lines.get("p1")!.CS).toBe(1);
    expect(lines.get("p1")!["SB%"]).toBeCloseTo(2 / 3, 6);
    expect(lines.get("p2")!.SB).toBe(1);
    expect(lines.get("p2")!.PIK).toBe(1);
    // Null runner_ids are ignored.
    const ignored = rollupBatting([], {
      stolen_bases: [{ runner_id: null }],
      caught_stealing: [],
      pickoffs: [],
    });
    expect(ignored.size).toBe(0);
  });
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

describe("computeWLS", () => {
  it("returns no W/L/SV for a tie game", () => {
    const result = computeWLS([], [], true, 3, 3);
    expect(result).toEqual({ W: null, L: null, SV: null });
  });

  it("credits W to the eligible starter when team leads from start", () => {
    // We're home (bottom = us batting). Starter "ace" pitches 5 full innings
    // (15 outs). We score 4 in bottom 1; opp never scores.
    const atBats: DerivedAtBat[] = [];
    // Top 1: opp 3 outs against ace. ace is our pitcher.
    for (let i = 0; i < 3; i++) {
      atBats.push(ab({
        pitcher_id: "ace", pitcher_of_record_id: "ace",
        half: "top", inning: 1, result: "GO", outs_recorded: 1,
      }));
    }
    // Bottom 1: we score 4.
    atBats.push(ab({
      batter_id: "b1", half: "bottom", inning: 1, result: "HR",
      runs_scored_on_play: 4,
      runner_advances: [
        { from: "third", to: "home", player_id: "b3" },
        { from: "second", to: "home", player_id: "b4" },
        { from: "first", to: "home", player_id: "b5" },
        { from: "batter", to: "home", player_id: "b1" },
      ],
    }));
    // Top 2..5: ace records 12 more outs. Total starter outs = 15.
    for (let i = 2; i <= 5; i++) {
      for (let o = 0; o < 3; o++) {
        atBats.push(ab({
          pitcher_id: "ace", pitcher_of_record_id: "ace",
          half: "top", inning: i, result: "GO", outs_recorded: 1,
        }));
      }
    }
    const wls = computeWLS(atBats, [], true, 4, 0);
    expect(wls.W).toBe("ace");
    expect(wls.L).toBeNull();
  });

  it("credits L to our pitcher when opp takes the lead for good", () => {
    const atBats: DerivedAtBat[] = [
      // Top 1: opp scores 1 against starter.
      ab({
        pitcher_id: "starter", pitcher_of_record_id: "starter",
        half: "top", inning: 1, result: "HR", runs_scored_on_play: 1,
        runner_advances: [{ from: "batter", to: "home", player_id: null }],
      }),
    ];
    // We are home, never score. We lose 0-1.
    const wls = computeWLS(atBats, [], true, 0, 1);
    expect(wls.L).toBe("starter");
    expect(wls.W).toBeNull();
  });

  it("save: closer with ≥1 IP and lead ≤3", () => {
    const atBats: DerivedAtBat[] = [];
    // Starter pitches 5+ innings, we lead 2-1 the whole way.
    for (let i = 0; i < 15; i++) {
      atBats.push(ab({ pitcher_id: "starter", pitcher_of_record_id: "starter",
        half: "top", inning: 1 + Math.floor(i / 3), result: "GO", outs_recorded: 1 }));
    }
    // Our offense scores 2.
    atBats.push(ab({
      batter_id: "x", half: "bottom", inning: 1, result: "HR",
      runs_scored_on_play: 2,
      runner_advances: [
        { from: "first", to: "home", player_id: "y" },
        { from: "batter", to: "home", player_id: "x" },
      ],
    }));
    // Opp scores 1 against starter (already counted above? No — let's add).
    atBats.push(ab({
      pitcher_id: "starter", pitcher_of_record_id: "starter",
      half: "top", inning: 6, result: "HR", runs_scored_on_play: 1,
      runner_advances: [{ from: "batter", to: "home", player_id: null }],
    }));
    // Closer pitches the 7th — 3 outs, no runs.
    for (let o = 0; o < 3; o++) {
      atBats.push(ab({
        pitcher_id: "closer", pitcher_of_record_id: "closer",
        half: "top", inning: 7, result: "GO", outs_recorded: 1,
      }));
    }
    const wls = computeWLS(atBats, [], true, 2, 1);
    expect(wls.W).toBe("starter");
    expect(wls.SV).toBe("closer");
  });
});

describe("verifyBoxScore", () => {
  it("passes a balanced box score (PDF §21 invariant)", () => {
    // Synthetic team line: 30 AB + 4 BB + 1 HBP + 1 SH + 0 SF + 0 CI = 36
    // 5 R + 8 LOB + 23 OppPO = 36
    const result = verifyBoxScore({
      AB: 30, BB: 4, HBP: 1, SH: 1, SF: 0, CI: 0,
      R: 5, LOB: 8, OppPO: 23,
    });
    expect(result.ok).toBe(true);
    expect(result.lhs).toBe(36);
    expect(result.rhs).toBe(36);
    expect(result.mismatch).toBe(0);
  });

  it("flags an unbalanced box score with the mismatch delta", () => {
    const result = verifyBoxScore({
      AB: 30, BB: 4, HBP: 0, SH: 0, SF: 0, CI: 0,
      R: 5, LOB: 8, OppPO: 20, // 34 vs 33
    });
    expect(result.ok).toBe(false);
    expect(result.mismatch).toBe(1);
  });
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
