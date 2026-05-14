import { beforeEach, describe, expect, it } from "vitest";
import { applyErReconstructionToHalf, phantomOutsForAtBat } from "./er-reconstruction";
import { EMPTY_BASES } from "./types";
import type { DerivedAtBat, NonPaRun } from "./types";

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
    sequence: nextId,
    ...overrides,
  };
}

function npr(overrides: Partial<NonPaRun>): NonPaRun {
  nextId += 1;
  return {
    event_id: `npr${nextId}`,
    pitcher_id: "A",
    runs: 1,
    source: "wild_pitch",
    sequence: nextId,
    inning: 1,
    half: "top",
    ...overrides,
  };
}

describe("phantomOutsForAtBat", () => {
  it("result=E with no actual out → 1 phantom out", () => {
    expect(phantomOutsForAtBat(ab({ result: "E", outs_recorded: 0 }))).toBe(1);
  });

  it("result=E that recorded an out (rare combo) → no phantom out", () => {
    // Defensive: if the play somehow recorded both an error and an out,
    // the out is already counted in actual_outs.
    expect(phantomOutsForAtBat(ab({ result: "E", outs_recorded: 1 }))).toBe(0);
  });

  it("hit with error_step_index on the throw → 1 phantom out", () => {
    expect(
      phantomOutsForAtBat(ab({ result: "1B", error_step_index: 1, outs_recorded: 0 })),
    ).toBe(1);
  });

  it("hit without error_step_index → 0 phantom outs", () => {
    expect(phantomOutsForAtBat(ab({ result: "1B", outs_recorded: 0 }))).toBe(0);
  });

  it("groundout → 0 phantom outs", () => {
    expect(phantomOutsForAtBat(ab({ result: "GO", outs_recorded: 1 }))).toBe(0);
  });

  it("K3-dropped on E does not produce a phantom out (the K already records an actual out)", () => {
    expect(
      phantomOutsForAtBat(
        ab({ result: "K_swinging", outs_recorded: 1, batter_reached_on_k3: "E" }),
      ),
    ).toBe(0);
  });
});

describe("applyErReconstructionToHalf", () => {
  beforeEach(() => { nextId = 0; });

  it("returns identical arrays when no errors occurred", () => {
    const atBats = [
      ab({ result: "GO", outs_recorded: 1 }),
      ab({ result: "K_swinging", outs_recorded: 1 }),
      ab({ result: "FO", outs_recorded: 1 }),
    ];
    const { atBats: out, nonPaRuns } = applyErReconstructionToHalf(atBats, [], 1, "top");
    expect(out).toBe(atBats); // same reference when nothing flagged
    expect(nonPaRuns).toEqual([]);
    for (const a of out) {
      expect(a.after_phantom_third_out).toBeUndefined();
    }
  });

  it("OSR 9.16 canonical: 2 outs → E → HR → K — both HR runs are unearned", () => {
    // GO (1 out), GO (2 outs), E (would-be 3rd out, batter safe), HR
    // (2 runs — both AFTER phantom 3rd out), K (actual 3rd out).
    // ab() assigns nextId as sequence in call order, so this array IS
    // the chronological order.
    const atBats = [
      ab({ result: "GO", outs_recorded: 1 }),
      ab({ result: "GO", outs_recorded: 1 }),
      ab({ result: "E", outs_recorded: 0 }),
      ab({
        result: "HR",
        outs_recorded: 0,
        runner_advances: [
          { from: "first", to: "home", player_id: "X" },
          { from: "batter", to: "home", player_id: null },
        ],
      }),
      ab({ result: "K_swinging", outs_recorded: 1 }),
    ];

    const { atBats: out } = applyErReconstructionToHalf(atBats, [], 1, "top");

    // E is the boundary event (its phantom out pushes reconstructed from
    // 2 → 3). It and everything after is flagged.
    expect(out[0].after_phantom_third_out).toBeUndefined();
    expect(out[1].after_phantom_third_out).toBeUndefined();
    expect(out[2].after_phantom_third_out).toBe(true); // E itself
    expect(out[3].after_phantom_third_out).toBe(true); // HR runs unearned
    expect(out[4].after_phantom_third_out).toBe(true); // K — moot but flagged
  });

  it("error early in inning, no extra runs after — flag still set on E", () => {
    // E with 0 outs, then GO, GO, K. Reconstructed outs sequence: 1 (E),
    // 2 (GO), 3 (GO). Boundary lands ON the second GO. K is after.
    const atBats = [
      ab({ result: "E", outs_recorded: 0 }),
      ab({ result: "GO", outs_recorded: 1 }),
      ab({ result: "GO", outs_recorded: 1 }),
      ab({ result: "K_swinging", outs_recorded: 1 }),
    ];

    const { atBats: out } = applyErReconstructionToHalf(atBats, [], 1, "top");

    expect(out[0].after_phantom_third_out).toBeUndefined();
    expect(out[1].after_phantom_third_out).toBeUndefined();
    // Boundary at 2nd GO has no phantom outs (all actual) — not flagged.
    expect(out[2].after_phantom_third_out).toBeUndefined();
    expect(out[3].after_phantom_third_out).toBe(true);
  });

  it("non-PA run after phantom 3rd out is flagged", () => {
    // E (1 out reconstructed, 0 actual), then 2 GOs (reconstructed=3),
    // then a wild pitch scores a run. The WP run is after phantom 3rd out.
    const atBats = [
      ab({ result: "E", outs_recorded: 0, sequence: 1 }),
      ab({ result: "GO", outs_recorded: 1, sequence: 2 }),
      ab({ result: "GO", outs_recorded: 1, sequence: 3 }),
    ];
    const nonPaRuns = [npr({ source: "wild_pitch", sequence: 4 })];

    const { nonPaRuns: out } = applyErReconstructionToHalf(atBats, nonPaRuns, 1, "top");

    expect(out[0].after_phantom_third_out).toBe(true);
  });

  it("ignores entries from other halves", () => {
    const top = ab({ result: "E", outs_recorded: 0, inning: 1, half: "top" });
    const bot = ab({ result: "E", outs_recorded: 0, inning: 1, half: "bottom" });
    const atBats = [
      top,
      ab({ result: "GO", outs_recorded: 1, inning: 1, half: "top" }),
      ab({ result: "GO", outs_recorded: 1, inning: 1, half: "top" }),
      ab({ result: "K_swinging", outs_recorded: 1, inning: 1, half: "top" }),
      bot,
    ];

    const { atBats: out } = applyErReconstructionToHalf(atBats, [], 1, "top");

    // bottom-half E was not visited — flag stays undefined.
    expect(out[4].after_phantom_third_out).toBeUndefined();
    // top-half had error → boundary reached → last top entry flagged.
    expect(out[3].after_phantom_third_out).toBe(true);
  });

  it("clean half-inning with errors that did NOT trigger phantom 3rd out leaves runs earned", () => {
    // E with 0 outs, K, K (only 2 reconstructed outs from K's; E adds 1 → 3.
    // After 2 K's = 2 actual outs + 1 phantom (E) = 3 reconstructed.
    // Order matters: E first, then K, K — boundary at 2nd K.
    // No runs scored at all → no run-classification impact, but flag should
    // still be set for any later events (none here).
    const atBats = [
      ab({ result: "E", outs_recorded: 0 }),
      ab({ result: "K_swinging", outs_recorded: 1 }),
      ab({ result: "K_swinging", outs_recorded: 1 }),
    ];
    const { atBats: out } = applyErReconstructionToHalf(atBats, [], 1, "top");
    // 2nd K is the boundary (cumulative: E=1, K=2, K=3) — no phantom outs
    // on the 2nd K so its own runs (none) stay un-flagged.
    expect(out[0].after_phantom_third_out).toBeUndefined();
    expect(out[1].after_phantom_third_out).toBeUndefined();
    expect(out[2].after_phantom_third_out).toBeUndefined();
  });

  it("idempotent: re-running yields the same result", () => {
    const atBats = [
      ab({ result: "GO", outs_recorded: 1 }),
      ab({ result: "GO", outs_recorded: 1 }),
      ab({ result: "E", outs_recorded: 0 }),
      ab({
        result: "HR",
        outs_recorded: 0,
        runner_advances: [
          { from: "first", to: "home", player_id: "X" },
          { from: "batter", to: "home", player_id: null },
        ],
      }),
    ];
    const first = applyErReconstructionToHalf(atBats, [], 1, "top");
    const second = applyErReconstructionToHalf(first.atBats, first.nonPaRuns, 1, "top");
    expect(second.atBats[2].after_phantom_third_out).toBe(true);
    expect(second.atBats[3].after_phantom_third_out).toBe(true);
  });
});

