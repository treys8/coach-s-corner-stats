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

  it("ineligible starter who was leadCandidate: W shifts to reliever (MLB)", () => {
    // Bug regression: previously the starter was credited W even though
    // they didn't complete the required 5 IP (15 outs), because the
    // leadCandidate path bypassed the eligibility check.
    const atBats: DerivedAtBat[] = [];
    // Bottom 1: we score 1 (we're home). leadCandidate is set to starter.
    atBats.push(ab({
      batter_id: "x", half: "bottom", inning: 1, result: "HR",
      runs_scored_on_play: 1,
      runner_advances: [{ from: "batter", to: "home", player_id: "x" }],
      pitcher_id: "starter", pitcher_of_record_id: "starter",
    }));
    // Top 1..2: starter records 6 outs (2 IP) — not enough for MLB 5 IP.
    for (let i = 1; i <= 2; i++) {
      for (let o = 0; o < 3; o++) {
        atBats.push(ab({
          pitcher_id: "starter", pitcher_of_record_id: "starter",
          half: "top", inning: i, result: "GO", outs_recorded: 1,
        }));
      }
    }
    // Top 3..7: reliever pitches 5 IP, no runs.
    for (let i = 3; i <= 7; i++) {
      for (let o = 0; o < 3; o++) {
        atBats.push(ab({
          pitcher_id: "reliever", pitcher_of_record_id: "reliever",
          half: "top", inning: i, result: "GO", outs_recorded: 1,
        }));
      }
    }
    const wls = computeWLS(atBats, [], true, 1, 0);
    expect(wls.W).toBe("reliever");
  });

  it("ineligible starter who was leadCandidate: W stays with starter if no reliever (NFHS short game)", () => {
    // NFHS allows 4-inning starter eligibility (12 outs). Here the starter
    // pitches a 3-inning rain-shortened win — ineligible AND no reliever.
    // W has to stay with starter.
    const atBats: DerivedAtBat[] = [];
    atBats.push(ab({
      batter_id: "x", half: "bottom", inning: 1, result: "HR",
      runs_scored_on_play: 1,
      runner_advances: [{ from: "batter", to: "home", player_id: "x" }],
      pitcher_id: "starter", pitcher_of_record_id: "starter",
    }));
    for (let i = 1; i <= 3; i++) {
      for (let o = 0; o < 3; o++) {
        atBats.push(ab({
          pitcher_id: "starter", pitcher_of_record_id: "starter",
          half: "top", inning: i, result: "GO", outs_recorded: 1,
        }));
      }
    }
    const wls = computeWLS(atBats, [], true, 1, 0, "nfhs");
    expect(wls.W).toBe("starter");
  });

  it("NFHS starter who pitches exactly 4 IP is eligible for W", () => {
    const atBats: DerivedAtBat[] = [];
    atBats.push(ab({
      batter_id: "x", half: "bottom", inning: 1, result: "HR",
      runs_scored_on_play: 1,
      runner_advances: [{ from: "batter", to: "home", player_id: "x" }],
      pitcher_id: "starter", pitcher_of_record_id: "starter",
    }));
    for (let i = 1; i <= 4; i++) {
      for (let o = 0; o < 3; o++) {
        atBats.push(ab({
          pitcher_id: "starter", pitcher_of_record_id: "starter",
          half: "top", inning: i, result: "GO", outs_recorded: 1,
        }));
      }
    }
    // Reliever in for the 5th to finish.
    for (let o = 0; o < 3; o++) {
      atBats.push(ab({
        pitcher_id: "reliever", pitcher_of_record_id: "reliever",
        half: "top", inning: 5, result: "GO", outs_recorded: 1,
      }));
    }
    const wls = computeWLS(atBats, [], true, 1, 0, "nfhs");
    expect(wls.W).toBe("starter");
  });

  it("ineligible starter who re-entered to finish: W goes to the reliever, not the starter", () => {
    // Bug regression: previously the fallback used lastFinisher(atBats),
    // which returns the pitcher of the LAST at-bat. If the starter exits
    // after a short outing and then returns to pitch the final outs
    // (legal in some leagues / scrim contexts), lastFinisher === starter,
    // so the old code awarded W back to the ineligible starter. Correct
    // behavior: pick the relief pitcher with the most outs.
    const atBats: DerivedAtBat[] = [];
    // Bot 1: we score 1 (pitcherA on the mound).
    atBats.push(ab({
      batter_id: "x", half: "bottom", inning: 1, result: "HR",
      runs_scored_on_play: 1,
      runner_advances: [{ from: "batter", to: "home", player_id: "x" }],
      pitcher_id: "starter", pitcher_of_record_id: "starter",
    }));
    // Top 1: starter records 3 outs (1 IP).
    for (let o = 0; o < 3; o++) {
      atBats.push(ab({
        pitcher_id: "starter", pitcher_of_record_id: "starter",
        half: "top", inning: 1, result: "GO", outs_recorded: 1,
      }));
    }
    // Top 2..6: reliever records 15 outs (5 IP).
    for (let i = 2; i <= 6; i++) {
      for (let o = 0; o < 3; o++) {
        atBats.push(ab({
          pitcher_id: "reliever", pitcher_of_record_id: "reliever",
          half: "top", inning: i, result: "GO", outs_recorded: 1,
        }));
      }
    }
    // Top 7: starter re-enters and records the final 3 outs.
    for (let o = 0; o < 3; o++) {
      atBats.push(ab({
        pitcher_id: "starter", pitcher_of_record_id: "starter",
        half: "top", inning: 7, result: "GO", outs_recorded: 1,
      }));
    }
    // Starter total: 6 outs (ineligible for MLB 15). Reliever: 15 outs.
    const wls = computeWLS(atBats, [], true, 1, 0);
    expect(wls.W).toBe("reliever");
  });

  it("WP that took opp into the lead credits L to the WP pitcher, not the next at-bat pitcher", () => {
    // Chronology:
    //   bot 1: we score 1 (team=1, opp=0).               (pitcherA defending)
    //   top 2: opp HR off pitcherA (team=1, opp=1).       (tied)
    //   top 2: WP by pitcherA (team=1, opp=2).            (opp takes lead → L should be pitcherA)
    //   sub to pitcherB.
    //   top 2: opp HR off pitcherB (team=1, opp=3).
    //   game ends 1-3.
    //
    // Bug: previously non-PA runs were folded after all at-bats, so the
    // lead-change transition was attributed to whoever was on the mound
    // at the LAST at-bat (pitcherB) instead of the WP pitcher (pitcherA).
    const atBats: DerivedAtBat[] = [
      // Bot 1: our HR.
      ab({
        sequence: 1, batter_id: "x", half: "bottom", inning: 1, result: "HR",
        runs_scored_on_play: 1,
        runner_advances: [{ from: "batter", to: "home", player_id: "x" }],
      }),
      // Top 2 (1st at-bat): opp HR off pitcherA.
      ab({
        sequence: 2, pitcher_id: "pitcherA", pitcher_of_record_id: "pitcherA",
        half: "top", inning: 2, result: "HR", runs_scored_on_play: 1,
        runner_advances: [{ from: "batter", to: "home", player_id: null }],
      }),
      // (WP happens at sequence 3 — see nonPaRuns below.)
      // Top 2 (2nd at-bat): opp HR off pitcherB.
      ab({
        sequence: 4, pitcher_id: "pitcherB", pitcher_of_record_id: "pitcherB",
        half: "top", inning: 2, result: "HR", runs_scored_on_play: 1,
        runner_advances: [{ from: "batter", to: "home", player_id: null }],
      }),
    ];
    const nonPaRuns = [{
      event_id: "wp1", pitcher_id: "pitcherA", runs: 1,
      source: "wild_pitch" as const, sequence: 3, inning: 2, half: "top" as const,
    }];
    const wls = computeWLS(atBats, nonPaRuns, true, 1, 3);
    expect(wls.L).toBe("pitcherA");
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
