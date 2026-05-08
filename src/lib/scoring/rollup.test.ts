import { describe, expect, it } from "vitest";
import { rollupBatting, rollupPitching } from "./rollup";
import type { AtBatResult, DerivedAtBat } from "./types";

let nextId = 0;
function ab(overrides: Partial<DerivedAtBat>): DerivedAtBat {
  nextId += 1;
  return {
    event_id: `e${nextId}`,
    inning: 1,
    half: "top",
    batting_order: 1,
    batter_id: null,
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
    description: null,
    ...overrides,
  };
}

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
    expect(line.RBI).toBe(2);
  });

  it("computes AVG/OBP/SLG/OPS from counts", () => {
    // 1 single, 1 HR, 1 BB, 1 K, 1 GO out, 1 SF (RBI=1)
    // AB = 3 (1B, HR, K, GO=4 ... wait)
    // PA = 6. NON_AB = {BB, SF}. AB = 4. H = 2.
    // AVG = 2/4 = .500
    // TB = 1 + 4 = 5. SLG = 5/4 = 1.250
    // OBP den = AB + BB + HBP + SF = 4 + 1 + 0 + 1 = 6. num = H + BB + HBP = 2+1+0 = 3. OBP = 0.500
    // OPS = 1.750
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
    // OBP den = 0 + 1 + 1 + 0 = 2; num = 0+1+1 = 2 => OBP = 1.000
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
    // p1 walks, p2 doubles them home. p2 RBI = 1, p1 R = 1.
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

  it("accumulates across multiple PAs for the same batter", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "1B" }),
      ab({ batter_id: "p1", result: "1B" }),
      ab({ batter_id: "p1", result: "GO", outs_recorded: 1 }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.PA).toBe(3);
    expect(line.AB).toBe(3);
    expect(line.H).toBe(2);
    expect(line["1B"]).toBe(2);
  });
});

describe("rollupPitching", () => {
  it("includes only at-bats with a pitcher_id (our pitcher facing opponents)", () => {
    const atBats = [
      ab({ batter_id: null, pitcher_id: "ours", result: "K_swinging", outs_recorded: 1 }),
      ab({ batter_id: null, pitcher_id: "ours", result: "BB" }),
      ab({ batter_id: null, pitcher_id: "ours", result: "1B" }),
      ab({ batter_id: null, pitcher_id: "ours", result: "HR" }),
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
  });

  it("formats IP using baseball thirds (7 outs = 2.1, 9 outs = 3.0)", () => {
    const sevenOuts: DerivedAtBat[] = [
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
    ];
    expect(rollupPitching(sevenOuts).get("ours")!.IP).toBeCloseTo(2.1, 6);

    const nineOuts = sevenOuts.concat([
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "ours", result: "GO", outs_recorded: 1 }),
    ]);
    expect(rollupPitching(nineOuts).get("ours")!.IP).toBeCloseTo(3.0, 6);
  });

  it("charges runs to the pitcher on the mound for the scoring PA", () => {
    // p1 pitches a 2B that drives in two runners; charged 2 R/2 ER. p2
    // (relief) gets a clean inning out, no runs. ERA computed per 9 IP.
    const atBats = [
      ab({
        pitcher_id: "p1",
        result: "2B",
        runner_advances: [
          { from: "second", to: "home", player_id: "opp1" },
          { from: "first", to: "home", player_id: "opp2" },
          { from: "batter", to: "second", player_id: null },
        ],
      }),
      ab({
        pitcher_id: "p1",
        result: "GO",
        outs_recorded: 1,
        runner_advances: [],
      }),
      ab({
        pitcher_id: "p2",
        result: "GO",
        outs_recorded: 1,
        runner_advances: [],
      }),
    ];
    const lines = rollupPitching(atBats);
    const p1 = lines.get("p1")!;
    expect(p1.R).toBe(2);
    expect(p1.ER).toBe(2);
    expect(p1.outs).toBe(1);
    // 2 ER over 1/3 inning => ERA = 2 * 9 / (1/3) = 54
    expect(p1.ERA).toBeCloseTo(54, 6);
    // (BB=0 + H=1) / (1/3 IP) = 3
    expect(p1.WHIP).toBeCloseTo(3, 6);

    const p2 = lines.get("p2")!;
    expect(p2.R).toBe(0);
    expect(p2.ER).toBe(0);
    expect(p2.ERA).toBe(0);
  });

  it("attributes outs across multiple our-pitchers when there's a pitching change", () => {
    const atBats = [
      ab({ pitcher_id: "p1", result: "GO", outs_recorded: 1 }),
      ab({ pitcher_id: "p1", result: "K_swinging", outs_recorded: 1 }),
      ab({ pitcher_id: "p2", result: "GO", outs_recorded: 1 }),
    ];
    const lines = rollupPitching(atBats);
    expect(lines.get("p1")!.outs).toBe(2);
    expect(lines.get("p2")!.outs).toBe(1);
    expect(lines.get("p1")!.SO).toBe(1);
  });
});
