import { describe, expect, it } from "vitest";
import { computeWLS } from "./wls";
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
