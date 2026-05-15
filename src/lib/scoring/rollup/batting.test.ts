import { describe, expect, it } from "vitest";
import { rollupBatting } from "./batting";
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
