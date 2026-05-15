import { describe, expect, it } from "vitest";
import { verifyBoxScore } from "./index";
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
