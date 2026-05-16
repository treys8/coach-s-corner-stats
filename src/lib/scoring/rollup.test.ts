import { describe, expect, it } from "vitest";
import { computeWLS, rollupBatting, rollupFielding, rollupPitching, verifyBoxScore } from "./rollup";
import { EMPTY_BASES } from "./types";
import type { BaseRunner, Bases, DefensivePosition, DefensiveSlot, DerivedAtBat } from "./types";

const ALL_POSITIONS: DefensivePosition[] = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

// Build a defensive-lineup snapshot from a sparse map. Positions not in
// the map default to player_id: null.
function defense(map: Partial<Record<DefensivePosition, string>>): DefensiveSlot[] {
  return ALL_POSITIONS.map((position) => ({
    position,
    player_id: map[position] ?? null,
  }));
}

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
    pitcher_of_record_id: null,
    bases_before: { ...EMPTY_BASES },
    description: null,
    pitches: [],
    defensive_lineup_snapshot: [],
    lob_on_play: 0,
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
    ];
    const a = rollupPitching(atBats, nonPa).get("A")!;
    expect(a.R).toBe(5);
    // Earned: WP + balk + SB-home = 3. Unearned: PB + error_advance.
    expect(a.ER).toBe(3);
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

describe("rollupFielding", () => {
  // Standard defense for the half-innings we're fielding.
  const ours = defense({
    P: "pitcher1",
    C: "catcher1",
    "1B": "first1",
    "2B": "second1",
    "3B": "third1",
    SS: "ss1",
    LF: "lf1",
    CF: "cf1",
    RF: "rf1",
  });

  it("credits a routine 6-3 ground out as A→SS, PO→1B", () => {
    const atBats = [
      ab({
        batter_id: null,
        pitcher_id: "pitcher1",
        result: "GO",
        outs_recorded: 1,
        fielder_position: "SS",
        defensive_lineup_snapshot: ours,
      }),
    ];
    const lines = rollupFielding(atBats);
    expect(lines.get("ss1")!.A).toBe(1);
    expect(lines.get("ss1")!.PO).toBe(0);
    expect(lines.get("first1")!.PO).toBe(1);
    expect(lines.get("first1")!.A).toBe(0);
  });

  it("credits a fly out to the listed outfielder only", () => {
    const atBats = [
      ab({
        batter_id: null,
        pitcher_id: "pitcher1",
        result: "FO",
        outs_recorded: 1,
        fielder_position: "CF",
        defensive_lineup_snapshot: ours,
      }),
    ];
    const lines = rollupFielding(atBats);
    expect(lines.get("cf1")!.PO).toBe(1);
    expect(lines.has("first1")).toBe(false);
  });

  it("credits a strikeout as a putout to the catcher", () => {
    const atBats = [
      ab({
        batter_id: null,
        pitcher_id: "pitcher1",
        result: "K_swinging",
        outs_recorded: 1,
        defensive_lineup_snapshot: ours,
      }),
    ];
    const lines = rollupFielding(atBats);
    expect(lines.get("catcher1")!.PO).toBe(1);
  });

  it("does not credit a catcher PO when the batter reached on dropped K3", () => {
    const atBats = [
      ab({
        batter_id: null,
        pitcher_id: "pitcher1",
        result: "K_swinging",
        batter_reached_on_k3: "PB",
        outs_recorded: 0,
        defensive_lineup_snapshot: ours,
      }),
    ];
    const lines = rollupFielding(atBats);
    expect(lines.size).toBe(0);
  });

  it("credits an error to the listed fielder", () => {
    const atBats = [
      ab({
        batter_id: null,
        pitcher_id: "pitcher1",
        result: "E",
        outs_recorded: 0,
        fielder_position: "3B",
        defensive_lineup_snapshot: ours,
      }),
    ];
    const lines = rollupFielding(atBats);
    expect(lines.get("third1")!.E).toBe(1);
    expect(lines.get("third1")!.PO).toBe(0);
    expect(lines.get("third1")!.A).toBe(0);
  });

  it("computes FLD% from total chances", () => {
    const atBats = [
      // SS makes 3 assists on grounders, then commits 1 error.
      ab({ batter_id: null, result: "GO", outs_recorded: 1, fielder_position: "SS", defensive_lineup_snapshot: ours }),
      ab({ batter_id: null, result: "GO", outs_recorded: 1, fielder_position: "SS", defensive_lineup_snapshot: ours }),
      ab({ batter_id: null, result: "GO", outs_recorded: 1, fielder_position: "SS", defensive_lineup_snapshot: ours }),
      ab({ batter_id: null, result: "E", fielder_position: "SS", defensive_lineup_snapshot: ours }),
    ];
    const ss = rollupFielding(atBats).get("ss1")!;
    expect(ss.A).toBe(3);
    expect(ss.E).toBe(1);
    expect(ss.TC).toBe(4);
    expect(ss.FLD).toBeCloseTo(0.75, 3);
  });

  it("shifts attribution to the new SS after a defensive substitution", () => {
    // First grounder fielded by ss1; mid-game sub puts ss2 at shortstop;
    // second grounder must credit ss2, not ss1.
    const before = defense({ "1B": "first1", SS: "ss1" });
    const after = defense({ "1B": "first1", SS: "ss2" });
    const atBats = [
      ab({ batter_id: null, result: "GO", outs_recorded: 1, fielder_position: "SS", defensive_lineup_snapshot: before }),
      ab({ batter_id: null, result: "GO", outs_recorded: 1, fielder_position: "SS", defensive_lineup_snapshot: after }),
    ];
    const lines = rollupFielding(atBats);
    expect(lines.get("ss1")!.A).toBe(1);
    expect(lines.get("ss2")!.A).toBe(1);
  });

  it("ignores at-bats we were batting (no fielding chance for our players)", () => {
    const atBats = [
      ab({
        batter_id: "ourBatter",
        pitcher_id: null,
        opponent_pitcher_id: "opp",
        result: "GO",
        outs_recorded: 1,
        fielder_position: "SS",
        defensive_lineup_snapshot: ours,
      }),
    ];
    expect(rollupFielding(atBats).size).toBe(0);
  });

  it("accepts numeric scorebook positions (1-9) in fielder_position", () => {
    const atBats = [
      // "6" = SS, "3" = 1B in standard scorebook notation.
      ab({ batter_id: null, result: "GO", outs_recorded: 1, fielder_position: "6", defensive_lineup_snapshot: ours }),
    ];
    const lines = rollupFielding(atBats);
    expect(lines.get("ss1")!.A).toBe(1);
    expect(lines.get("first1")!.PO).toBe(1);
  });
});

describe("rollupBatting GIDP and LOB", () => {
  it("credits GIDP on a DP at-bat with 2 outs", () => {
    const atBats = [
      ab({
        batter_id: "p1",
        result: "DP",
        outs_recorded: 2,
        runner_advances: [
          { from: "first", to: "out", player_id: "p0" },
          { from: "batter", to: "out", player_id: "p1" },
        ],
      }),
    ];
    const line = rollupBatting(atBats).get("p1")!;
    expect(line.GIDP).toBe(1);
    expect(line.PA).toBe(1);
    expect(line.AB).toBe(1);
  });

  it("does not credit GIDP when the result is DP but only one out was recorded", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "DP", outs_recorded: 1 }),
    ];
    expect(rollupBatting(atBats).get("p1")!.GIDP).toBe(0);
  });

  it("credits LOB to the batter who made the third out with runners on", () => {
    // Batter grounds out to end the inning; 2 runners stranded.
    const atBats = [
      ab({
        batter_id: "p1",
        result: "GO",
        outs_recorded: 1,
        lob_on_play: 2,
      }),
    ];
    expect(rollupBatting(atBats).get("p1")!.LOB).toBe(2);
  });

  it("does not credit LOB on a play that did not end the half", () => {
    const atBats = [
      ab({ batter_id: "p1", result: "GO", outs_recorded: 1, lob_on_play: 0 }),
    ];
    expect(rollupBatting(atBats).get("p1")!.LOB).toBe(0);
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
