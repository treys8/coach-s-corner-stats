// Real-game regression fixture: STRK @ BRKH 2026-05-13.
//
// First slice: Top 1st only. Captures four edge cases from the live-scoring
// replay-fixture initiative (see memory file replay-fixture-initiative):
//   1. Mid-PA wild pitch advancing two runners on one pitch
//   2. FC with no out recorded (GC quirk: ground ball to pitcher, batter safe,
//      lead runner scores, all other runners advance)
//   3. Mid-PA stolen base sustained through a strikeout AB
//   4. Mid-PA passed ball scoring R3 + advancing R2, followed by a fly out
//
// Truth oracle: STRK 11, BRKH 2 (line: 2,0,0,0,6,2,1 / 0,0,2,0,0,0,0).
// Encoded as a single chronological event stream with per-half assertion
// checkpoints. Encoding gaps (the 3rd out of Top 2nd; all of Bot 2nd) are
// marked with `// GAP:` comments.
//
// If a future change to the engine breaks one of these, the failing assertion
// names the half-inning.

import { describe, expect, it } from "vitest";
import { replay } from "./replay";
import type {
  AtBatPayload,
  AtBatResult,
  CaughtStealingPayload,
  GameEventRecord,
  GameStartedPayload,
  InningEndPayload,
  PitchingChangePayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "./types";

// STRK lineup (visitor)
const P_MULLINS = "p_mullins";
const P_LITTLE = "p_little";
const P_TEMPLETON = "p_templeton";
const P_BERKERY = "p_berkery";
const P_BUCKNER = "p_buckner";
const P_JOHNSON = "p_johnson";
const P_PORTERA = "p_portera";
const P_COUVILLION = "p_couvillion";
const P_KNIGHT = "p_knight";
const P_BURKLEY = "p_burkley"; // our pitcher (complete game)

// BRKH opposing identities. We don't fully populate the opposing lineup;
// the slot IDs here are only used to namespace constants if we ever need to
// assert on BRKH batter ids.
const OPP_PALMER = "opp_palmer"; // BRKH starting pitcher
const OPP_BROWN = "opp_brown";   // BRKH relief — enters mid-Berkery PA Top 7th

let seq = 0;
function evt<P>(type: GameEventRecord["event_type"], payload: P): GameEventRecord {
  seq += 1;
  return {
    id: `e${seq}`,
    game_id: "g_strk_brkh_20260513",
    client_event_id: `c${seq}`,
    sequence_number: seq,
    event_type: type,
    payload: payload as unknown as GameEventRecord["payload"],
    supersedes_event_id: null,
    created_at: new Date(2026, 4, 13, 18, seq).toISOString(),
  };
}

const atBat = (p: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "top",
  batter_id: null,
  pitcher_id: null,
  opponent_pitcher_id: OPP_PALMER,
  batting_order: null,
  result: "K_swinging",
  rbi: 0,
  pitch_count: 0,
  balls: 0,
  strikes: 0,
  spray_x: null,
  spray_y: null,
  fielder_position: null,
  runner_advances: [],
  description: null,
  ...p,
});

// Helper for BRKH PAs — opp batter, our pitcher on the mound.
const oppAtBat = (p: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "bottom",
  batter_id: null,
  pitcher_id: P_BURKLEY,
  opponent_pitcher_id: null,
  batting_order: null,
  result: "K_swinging",
  rbi: 0,
  pitch_count: 0,
  balls: 0,
  strikes: 0,
  spray_x: null,
  spray_y: null,
  fielder_position: null,
  runner_advances: [],
  description: null,
  ...p,
});

const STRK_LINEUP = [
  { batting_order: 1, player_id: P_MULLINS,    position: "C"  },
  { batting_order: 2, player_id: P_LITTLE,     position: "LF" },
  { batting_order: 3, player_id: P_TEMPLETON,  position: "2B" },
  { batting_order: 4, player_id: P_BERKERY,    position: "SS" },
  { batting_order: 5, player_id: P_BUCKNER,    position: "DH" },
  { batting_order: 6, player_id: P_JOHNSON,    position: "1B" },
  { batting_order: 7, player_id: P_PORTERA,    position: "CF" },
  { batting_order: 8, player_id: P_COUVILLION, position: "RF" },
  { batting_order: 9, player_id: P_KNIGHT,     position: "3B" },
];

// BRKH lineup — we don't reference individual opp batters by id in
// assertions; opp_pa-* placeholders are fine since the engine only needs
// SOMETHING to slot into runner_advances.
const BRKH_LINEUP = Array.from({ length: 9 }, (_, i) => ({
  batting_order: i + 1,
  opponent_player_id: null,
  jersey_number: null,
  last_name: `brkh_${i + 1}`,
  position: null,
  is_dh: false,
}));

function startGame(): GameEventRecord {
  return evt<GameStartedPayload>("game_started", {
    we_are_home: false, // STRK is the visitor
    use_dh: true,
    starting_lineup: STRK_LINEUP,
    starting_pitcher_id: P_BURKLEY,
    opponent_starting_pitcher_id: OPP_PALMER,
    opposing_lineup: BRKH_LINEUP,
    opponent_use_dh: false,
  });
}

// Opaque opp baserunner ids (we don't model BRKH batters individually).
// Each at-bat that puts a BRKH runner on base uses a unique opp-runner id
// so subsequent runner_advances can reference them.
const OPP_TARVER_R = "opp_tarver_r"; // Bot 1st single, Bot 3rd HR, Bot 6th FC
const OPP_LEGGETT_R = "opp_leggett_r"; // Bot 3rd ROE

// ============================================================================

describe("STRK @ BRKH 2026-05-13 — full game fixture", () => {
  it("reproduces the full-game end state from GameChanger truth", () => {
    seq = 0;
    const events: GameEventRecord[] = [];
    events.push(startGame());

    // ---------------------------------------------------------------------
    // TOP 1ST — STRK 2, BRKH 0
    // ---------------------------------------------------------------------
    // (1) Mullins K-looking
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_MULLINS,
      batting_order: 1,
      result: "K_looking",
    })));
    // (2) Little BB → 1B
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_LITTLE,
      batting_order: 2,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_LITTLE }],
    })));
    // (3) Templeton 1B to LF — Little to 2B, batter at 1B
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_TEMPLETON,
      batting_order: 3,
      result: "1B",
      fielder_position: "LF",
      runner_advances: [
        { from: "first",  to: "second", player_id: P_LITTLE },
        { from: "batter", to: "first",  player_id: P_TEMPLETON },
      ],
    })));
    // Mid-Berkery WP: Little 2→3, Templeton 1→2
    events.push(evt<RunnerMovePayload>("wild_pitch", {
      advances: [
        { from: "second", to: "third",  player_id: P_LITTLE },
        { from: "first",  to: "second", player_id: P_TEMPLETON },
      ],
    }));
    // (4) Berkery FC (GC quirk: NO OUT). Little scores, Templeton to 3B,
    //     Berkery to 1B.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_BERKERY,
      batting_order: 4,
      result: "FC",
      rbi: 1,
      fielder_position: "P",
      runner_advances: [
        { from: "third",  to: "home",   player_id: P_LITTLE },
        { from: "second", to: "third",  player_id: P_TEMPLETON },
        { from: "batter", to: "first",  player_id: P_BERKERY },
      ],
    })));
    // Mid-Buckner SB: Berkery 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_BERKERY,
      from: "first",
      to: "second",
    }));
    // (5) Buckner K-looking
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_BUCKNER,
      batting_order: 5,
      result: "K_looking",
    })));
    // Mid-Johnson PB: Templeton home, Berkery 2→3
    events.push(evt<RunnerMovePayload>("passed_ball", {
      advances: [
        { from: "third",  to: "home",  player_id: P_TEMPLETON },
        { from: "second", to: "third", player_id: P_BERKERY },
      ],
    }));
    // (6) Johnson F9 → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_JOHNSON,
      batting_order: 6,
      result: "FO",
      fielder_position: "RF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }));

    // ---------------------------------------------------------------------
    // BOT 1ST — BRKH 0 (we field). Burkley pitching.
    // ---------------------------------------------------------------------
    // (1) W. Smith K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "bottom",
      result: "K_swinging",
    })));
    // (2) Tarver 1B to LF (Little)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "bottom",
      result: "1B",
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_TARVER_R }],
    })));
    // (3) Simmons K-swinging — mid-PA E1 advances Tarver 1→2
    events.push(evt<RunnerMovePayload>("error_advance", {
      advances: [{ from: "first", to: "second", player_id: OPP_TARVER_R }],
      error_fielder_position: "P",
      error_type: "throwing",
    }));
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "bottom",
      result: "K_swinging",
    })));
    // (4) Palmer 6-3 GO
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "bottom",
      result: "GO",
      fielder_position: "SS",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 1, half: "bottom" }));

    // ---------------------------------------------------------------------
    // TOP 2ND — STRK 0
    // ---------------------------------------------------------------------
    // (1) Portera K-swinging
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "top",
      batter_id: P_PORTERA,
      batting_order: 7,
      result: "K_swinging",
    })));
    // (2) Couvillion 4-3 GO
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "top",
      batter_id: P_COUVILLION,
      batting_order: 8,
      result: "GO",
      fielder_position: "2B",
    })));
    // (3) GAP: 3rd out of Top 2nd not captured — encoded as K_swinging.
    // Per truth oracle Knight has 3 AB / 0 H / 1 SO; some K must land here.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "top",
      batter_id: P_KNIGHT,
      batting_order: 9,
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 2, half: "top" }));

    // ---------------------------------------------------------------------
    // BOT 2ND — BRKH 0 (we field). GAP — all 3 outs unknown.
    // ---------------------------------------------------------------------
    // GAP: encode as three generic GOs.
    for (let i = 0; i < 3; i++) {
      events.push(evt<AtBatPayload>("at_bat", oppAtBat({
        inning: 2, half: "bottom",
        result: "GO",
        fielder_position: "P",
      })));
    }
    events.push(evt<InningEndPayload>("inning_end", { inning: 2, half: "bottom" }));

    // ---------------------------------------------------------------------
    // TOP 3RD — STRK 0
    // ---------------------------------------------------------------------
    // (1) Mullins PO to 2B
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_MULLINS,
      batting_order: 1,
      result: "PO",
      fielder_position: "2B",
    })));
    // (2) Little GO to 2B
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_LITTLE,
      batting_order: 2,
      result: "GO",
      fielder_position: "2B",
    })));
    // (3) Templeton foul PO to 3B
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_TEMPLETON,
      batting_order: 3,
      result: "PO",
      fielder_position: "3B",
      foul_out: true,
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 3, half: "top" }));

    // ---------------------------------------------------------------------
    // BOT 3RD — STRK 2, BRKH 2 (2-run HR by Tarver)
    // ---------------------------------------------------------------------
    // (1) S Smith 4-3 GO
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "GO",
      fielder_position: "2B",
    })));
    // (2) Leggett ROE on E6 (Berkery)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "E",
      fielder_position: "SS",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_LEGGETT_R }],
    })));
    // (3) W Smith PO to SS (Leggett stays at 1st)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "PO",
      fielder_position: "SS",
    })));
    // (4) Tarver 2-run HR to LF, Leggett scores
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "HR",
      rbi: 2,
      fielder_position: "LF",
      runner_advances: [
        { from: "first",  to: "home", player_id: OPP_LEGGETT_R },
        { from: "batter", to: "home", player_id: OPP_TARVER_R },
      ],
    })));
    // (5) Simmons K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 3, half: "bottom" }));

    // ---------------------------------------------------------------------
    // TOP 4TH — STRK 0
    // ---------------------------------------------------------------------
    // (1) Buckner K-looking
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_BUCKNER,
      batting_order: 5,
      result: "K_looking",
    })));
    // (2) Johnson K-swinging
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_JOHNSON,
      batting_order: 6,
      result: "K_swinging",
    })));
    // (3) Berkery 5-3 GO
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_BERKERY,
      batting_order: 4,
      result: "GO",
      fielder_position: "3B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 4, half: "top" }));

    // ---------------------------------------------------------------------
    // BOT 4TH — BRKH 0
    // ---------------------------------------------------------------------
    // (1) Palmer K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "bottom",
      result: "K_swinging",
    })));
    // (2) Authement 6-3 GO
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "bottom",
      result: "GO",
      fielder_position: "SS",
    })));
    // (3) Cline F9
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "bottom",
      result: "FO",
      fielder_position: "RF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 4, half: "bottom" }));

    // ---------------------------------------------------------------------
    // TOP 5TH — STRK 6 (BIG INNING)
    // ---------------------------------------------------------------------
    // (1) Portera bunt 1B; advances to 3rd on E5
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_PORTERA,
      batting_order: 7,
      result: "1B",
      fielder_position: "3B",
      runner_advances: [{ from: "batter", to: "third", player_id: P_PORTERA }],
    })));
    // (2) Couvillion 1B hard GB to RF, Portera scores → STRK 3-2
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_COUVILLION,
      batting_order: 8,
      result: "1B",
      rbi: 1,
      fielder_position: "RF",
      runner_advances: [
        { from: "third",  to: "home",  player_id: P_PORTERA },
        { from: "batter", to: "first", player_id: P_COUVILLION },
      ],
    })));
    // (3) Knight 1B line drive to LF, Couvillion to 3rd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_KNIGHT,
      batting_order: 9,
      result: "1B",
      fielder_position: "LF",
      runner_advances: [
        { from: "first",  to: "third", player_id: P_COUVILLION },
        { from: "batter", to: "first", player_id: P_KNIGHT },
      ],
    })));
    // Mid-Mullins SB: Knight 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_KNIGHT,
      from: "first",
      to: "second",
    }));
    // (4) Mullins 5-3 GO (Couvillion held, Knight held)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_MULLINS,
      batting_order: 1,
      result: "GO",
      fielder_position: "3B",
    })));
    // (5) Little ROE on E6 (S Smith), Couvillion scores → STRK 4-2,
    //     Knight to 3rd.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_LITTLE,
      batting_order: 2,
      result: "E",
      rbi: 1,
      fielder_position: "SS",
      runner_advances: [
        { from: "third",  to: "home",   player_id: P_COUVILLION },
        { from: "second", to: "third",  player_id: P_KNIGHT },
        { from: "batter", to: "first",  player_id: P_LITTLE },
      ],
    })));
    // (6) Templeton BB
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_TEMPLETON,
      batting_order: 3,
      result: "BB",
      runner_advances: [
        // Knight stays at 3rd, Little forced to 2nd (per below SB), Templeton to 1st.
        // Per truth, the SB happened mid-PA — at the BB itself, Templeton walked
        // and Little was already at 2nd (or alternatively the BB happens before
        // the SB). We encode SB happening AFTER the walk: Little at 2nd, then
        // SB advances him. Actually per play log: "B Little SB 2nd" mid-PA, so
        // SB happens before BB walks force-load the bases. Simpler to encode the
        // walk with Little forced to 2nd and skip the SB credit. We choose to
        // emit the SB event separately so SB credit isn't lost.
        { from: "first",  to: "second", player_id: P_LITTLE },
        { from: "batter", to: "first",  player_id: P_TEMPLETON },
      ],
    })));
    // Mid-Templeton SB recorded after the walk for stat-credit purposes —
    // Little is already on 2nd, so emit a "SB 2nd" credit that's effectively
    // recorded but the engine will try to move from 2→3. Per play log, the
    // SB was DURING the BB; the bases-loaded outcome is: Knight 3B / Little
    // 2B / Templeton 1B. We've already represented that.
    //
    // ATTRIBUTION TRADE-OFF: drop the SB event to avoid changing the on-base
    // configuration. Box score: Little stole, gets +1 SB credit. We accept the
    // loss of SB credit here (the engine SB-rollup is not asserted in this
    // fixture) in exchange for correct on-base state.
    //
    // (7) Berkery K-swinging, bases stay loaded
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_BERKERY,
      batting_order: 4,
      result: "K_swinging",
    })));
    // (8) Buckner 3-run HR to LF — Knight, Little, Templeton all score
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_BUCKNER,
      batting_order: 5,
      result: "HR",
      rbi: 4, // 3 runners + himself
      fielder_position: "LF",
      runner_advances: [
        { from: "third",  to: "home", player_id: P_KNIGHT },
        { from: "second", to: "home", player_id: P_LITTLE },
        { from: "first",  to: "home", player_id: P_TEMPLETON },
        { from: "batter", to: "home", player_id: P_BUCKNER },
      ],
    })));
    // (9) Johnson F8 → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_JOHNSON,
      batting_order: 6,
      result: "FO",
      fielder_position: "CF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 5, half: "top" }));

    // ---------------------------------------------------------------------
    // BOT 5TH — BRKH 0
    // ---------------------------------------------------------------------
    // (1) Boyd 6-3 GO
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "bottom",
      result: "GO",
      fielder_position: "SS",
    })));
    // (2) S Smith 3-out GO to 1B
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "bottom",
      result: "GO",
      fielder_position: "1B",
    })));
    // (3) Leggett PO to 2B
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "bottom",
      result: "PO",
      fielder_position: "2B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 5, half: "bottom" }));

    // ---------------------------------------------------------------------
    // TOP 6TH — STRK 2
    // ---------------------------------------------------------------------
    // (1) Portera 1B line drive to CF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_PORTERA,
      batting_order: 7,
      result: "1B",
      fielder_position: "CF",
      runner_advances: [{ from: "batter", to: "first", player_id: P_PORTERA }],
    })));
    // (2) Couvillion K-swinging
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_COUVILLION,
      batting_order: 8,
      result: "K_swinging",
    })));
    // (3) Knight 2B — E5 advances him to 3rd, Portera scores on the throw
    // Modeled per task instructions: batter ends at third, Portera home.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_KNIGHT,
      batting_order: 9,
      result: "2B",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [
        { from: "first",  to: "home",  player_id: P_PORTERA },
        { from: "batter", to: "third", player_id: P_KNIGHT },
      ],
    })));
    // (4) Mullins ROE on E2, Knight scores
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_MULLINS,
      batting_order: 1,
      result: "E",
      rbi: 0, // ROE: catcher's error, not an RBI per scorer
      fielder_position: "C",
      runner_advances: [
        { from: "third",  to: "home",  player_id: P_KNIGHT },
        { from: "batter", to: "first", player_id: P_MULLINS },
      ],
    })));
    // Mid-Little CS: Mullins CS 2nd
    events.push(evt<CaughtStealingPayload>("caught_stealing", {
      runner_id: P_MULLINS,
      from: "first",
    }));
    // (5) Little 5-3 GO → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_LITTLE,
      batting_order: 2,
      result: "GO",
      fielder_position: "3B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 6, half: "top" }));

    // ---------------------------------------------------------------------
    // BOT 6TH — BRKH 0
    // ---------------------------------------------------------------------
    // (Defensive sub J Northcutt for J Knight at 3B — opposing side. No
    // event surface in our engine — we omit it; no assertions depend on it.)
    //
    // (1) W Smith 1B line drive to LF
    const OPP_WSMITH_R = "opp_wsmith_r";
    const OPP_TARVER_R6 = "opp_tarver_r6";
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "bottom",
      result: "1B",
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_WSMITH_R }],
    })));
    // (2) Tarver FC, W Smith out at 2nd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "bottom",
      result: "FC",
      fielder_position: "3B",
      runner_advances: [
        { from: "first",  to: "out",   player_id: OPP_WSMITH_R },
        { from: "batter", to: "first", player_id: OPP_TARVER_R6 },
      ],
    })));
    // (3) Simmons K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "bottom",
      result: "K_swinging",
    })));
    // Mid-Palmer WP: Tarver 1→2
    events.push(evt<RunnerMovePayload>("wild_pitch", {
      advances: [{ from: "first", to: "second", player_id: OPP_TARVER_R6 }],
    }));
    // (4) Palmer GO to C → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "bottom",
      result: "GO",
      fielder_position: "C",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 6, half: "bottom" }));

    // ---------------------------------------------------------------------
    // TOP 7TH — STRK 1
    // ---------------------------------------------------------------------
    // Top 6th ended on Little (slot 2). Top 7th leads off with Templeton
    // (slot 3) per batting order. Truth-oracle box score: Templeton 2 H
    // (incl HR), 3 R, 1 RBI; Berkery 3 AB / 0 R / 0 H / 1 RBI; Buckner
    // 4 AB / 1 H / 4 RBI; Johnson 4 AB / 0 H / 0 R / 0 RBI / 1 SO.
    //
    // RECONCILIATION: Line score says 1 run in Top 7th, but play log narrates
    // Templeton's HR as 2-run (Berkery scores). Truth-oracle line score
    // (2,0,0,0,6,2,1) wins — we encode Templeton's HR as a SOLO HR (Berkery
    // not yet on base). Then Berkery's HBP comes AFTER the HR. Johnson's
    // GIDP at the end forces Berkery off the bases as the runner being
    // doubled up. This is the only ordering consistent with the line score.
    //
    // (1) Templeton solo HR → STRK 11-2
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 7, half: "top",
      batter_id: P_TEMPLETON,
      batting_order: 3,
      opponent_pitcher_id: OPP_PALMER,
      result: "HR",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [
        { from: "batter", to: "home", player_id: P_TEMPLETON },
      ],
    })));
    // (2) Pitching change mid-Berkery (post-HR per narrative)
    events.push(evt<PitchingChangePayload>("pitching_change", {
      out_pitcher_id: OPP_PALMER,
      in_pitcher_id: OPP_BROWN,
    }));
    // (3) Berkery HBP
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 7, half: "top",
      batter_id: P_BERKERY,
      batting_order: 4,
      opponent_pitcher_id: OPP_BROWN,
      result: "HBP",
      runner_advances: [{ from: "batter", to: "first", player_id: P_BERKERY }],
    })));
    // (4) Buckner F9
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 7, half: "top",
      batter_id: P_BUCKNER,
      batting_order: 5,
      opponent_pitcher_id: OPP_BROWN,
      result: "FO",
      fielder_position: "RF",
    })));
    // (6) Johnson GIDP 4-X — batter out at 1st, Berkery (1st) out at 2nd.
    // Per task instructions: result="DP" with 2 enumerated outs.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 7, half: "top",
      batter_id: P_JOHNSON,
      batting_order: 6,
      opponent_pitcher_id: OPP_BROWN,
      result: "DP",
      fielder_position: "2B",
      runner_advances: [
        { from: "batter", to: "out", player_id: P_JOHNSON },
        { from: "first",  to: "out", player_id: P_BERKERY },
      ],
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 7, half: "top" }));

    // ---------------------------------------------------------------------
    // BOT 7TH — BRKH 0 (game ends 11-2)
    // ---------------------------------------------------------------------
    // (1) Authement K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "bottom",
      result: "K_swinging",
    })));
    // (2) Cline 6-3 GO
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "bottom",
      result: "GO",
      fielder_position: "SS",
    })));
    // (3) Boyd F7 → 3rd out, game over
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "bottom",
      result: "FO",
      fielder_position: "LF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 7, half: "bottom" }));

    // ---------------------------------------------------------------------
    // REPLAY + ASSERTIONS
    // ---------------------------------------------------------------------
    const state = replay(events);

    // Final score per truth oracle.
    expect(state.team_score, "STRK 11 final").toBe(11);
    expect(state.opponent_score, "BRKH 2 final").toBe(2);
    expect(state.status).toBe("in_progress");

    // Per-half cumulative score progression from the line score:
    //   STRK 2,0,0,0,6,2,1 / BRKH 0,0,2,0,0,0,0
    // We assert via the cumulative score at each inning_end checkpoint.
    // Reconstruct by walking events partially.
    const cumByInningEnd = computeCumulativeScores(events);
    // After Top 1: STRK 2, BRKH 0
    expect(cumByInningEnd["1_top"]).toEqual({ team: 2, opp: 0 });
    expect(cumByInningEnd["1_bottom"]).toEqual({ team: 2, opp: 0 });
    expect(cumByInningEnd["2_top"]).toEqual({ team: 2, opp: 0 });
    expect(cumByInningEnd["2_bottom"]).toEqual({ team: 2, opp: 0 });
    expect(cumByInningEnd["3_top"]).toEqual({ team: 2, opp: 0 });
    expect(cumByInningEnd["3_bottom"]).toEqual({ team: 2, opp: 2 });
    expect(cumByInningEnd["4_top"]).toEqual({ team: 2, opp: 2 });
    expect(cumByInningEnd["4_bottom"]).toEqual({ team: 2, opp: 2 });
    expect(cumByInningEnd["5_top"]).toEqual({ team: 8, opp: 2 });
    expect(cumByInningEnd["5_bottom"]).toEqual({ team: 8, opp: 2 });
    expect(cumByInningEnd["6_top"]).toEqual({ team: 10, opp: 2 });
    expect(cumByInningEnd["6_bottom"]).toEqual({ team: 10, opp: 2 });
    expect(cumByInningEnd["7_top"]).toEqual({ team: 11, opp: 2 });
    expect(cumByInningEnd["7_bottom"]).toEqual({ team: 11, opp: 2 });

    // Outs-per-half: every closed half-inning should sum to 3.
    // Bot 6th ended on a GO with a runner on 2nd, so still 3 outs.
    const halves = [
      "1_top", "1_bottom", "2_top", "2_bottom",
      "3_top", "3_bottom", "4_top", "4_bottom",
      "5_top", "5_bottom", "6_top", "6_bottom",
      "7_top", "7_bottom",
    ] as const;
    for (const key of halves) {
      const [inningStr, halfStr] = key.split("_");
      const inning = Number(inningStr);
      const half = halfStr as "top" | "bottom";
      const outs = state.at_bats
        .filter((ab) => ab.inning === inning && ab.half === half)
        .reduce((sum, ab) => sum + ab.outs_recorded, 0);
      // Non-PA basepath outs (CS in Top 6th) need to be added too:
      const nonPaOuts = (key === "6_top") ? 1 : 0; // Mullins CS
      expect(outs + nonPaOuts, `${key} should have 3 outs`).toBe(3);
    }

    // Hit count for STRK — count at_bats with hit results where it's our half.
    const HIT_RESULTS: AtBatResult[] = ["1B", "2B", "3B", "HR"];
    const strkHits = state.at_bats.filter((ab) => {
      const ourHalf = ab.half === "top"; // we're visitor
      return ourHalf && HIT_RESULTS.includes(ab.result);
    }).length;
    expect(strkHits, "STRK should have 8 hits").toBe(8);

    // BRKH hits: 3 per truth oracle (Tarver 1B Bot 1st, Tarver HR Bot 3rd,
    // W Smith 1B Bot 6th).
    const brkhHits = state.at_bats.filter((ab) => {
      const oppHalf = ab.half === "bottom";
      return oppHalf && HIT_RESULTS.includes(ab.result);
    }).length;
    expect(brkhHits, "BRKH should have 3 hits").toBe(3);

    // Per-PA spot checks for noteworthy edge cases.

    // Top 6th Knight 2B with E5: hit credit stays 2B, batter ends at 3rd.
    const knight2b = state.at_bats.find(
      (ab) => ab.batter_id === P_KNIGHT && ab.inning === 6 && ab.half === "top",
    )!;
    expect(knight2b.result).toBe("2B");
    expect(knight2b.runs_scored_on_play, "Portera scored on Knight's 2B").toBe(1);

    // Top 6th Mullins ROE on E2: result=E, Knight scored.
    const mullinsRoe = state.at_bats.find(
      (ab) => ab.batter_id === P_MULLINS && ab.inning === 6 && ab.half === "top",
    )!;
    expect(mullinsRoe.result).toBe("E");
    expect(mullinsRoe.runs_scored_on_play, "Knight scored on Mullins ROE").toBe(1);

    // Top 7th Templeton solo HR (line score reconciliation — see encoding note).
    const templetonHr = state.at_bats.find(
      (ab) => ab.batter_id === P_TEMPLETON && ab.inning === 7 && ab.half === "top",
    )!;
    expect(templetonHr.result).toBe("HR");
    expect(templetonHr.runs_scored_on_play, "Solo HR per line score").toBe(1);
    expect(templetonHr.rbi).toBe(1);

    // Top 7th Johnson GIDP: 2 outs.
    const johnsonGidp = state.at_bats.find(
      (ab) => ab.batter_id === P_JOHNSON && ab.inning === 7 && ab.half === "top",
    )!;
    expect(johnsonGidp.result).toBe("DP");
    expect(johnsonGidp.outs_recorded, "GIDP = 2 outs").toBe(2);

    // Top 5th Buckner 3-run HR
    const bucknerHr = state.at_bats.find(
      (ab) => ab.batter_id === P_BUCKNER && ab.inning === 5 && ab.half === "top",
    )!;
    expect(bucknerHr.result).toBe("HR");
    expect(bucknerHr.runs_scored_on_play, "Buckner HR scores 4").toBe(4);
    expect(bucknerHr.rbi).toBe(4);

    // Top 1st Berkery FC quirk preserved.
    const berkeryFc = state.at_bats.find(
      (ab) => ab.batter_id === P_BERKERY && ab.inning === 1 && ab.half === "top",
    )!;
    expect(berkeryFc.result).toBe("FC");
    expect(berkeryFc.outs_recorded).toBe(0);

    // non_pa_runs should ONLY contain BRKH-side runs (when we're fielding).
    // BRKH scored entirely via the Tarver HR in Bot 3rd — that's an at_bat,
    // not a non_pa_run. So non_pa_runs should be empty.
    expect(state.non_pa_runs, "No non-PA runs charged to Burkley").toEqual([]);
  });
});

// Helper: walk events sequentially, snapshotting cumulative scores at
// every inning_end event. Returns map of "{inning}_{half}" -> {team, opp}.
function computeCumulativeScores(events: GameEventRecord[]): Record<string, { team: number; opp: number }> {
  const result: Record<string, { team: number; opp: number }> = {};
  // Replay incrementally up to and including each inning_end.
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.event_type !== "inning_end") continue;
    const subset = events.slice(0, i + 1);
    const s = replay(subset);
    const p = e.payload as InningEndPayload;
    result[`${p.inning}_${p.half}`] = { team: s.team_score, opp: s.opponent_score };
  }
  return result;
}
