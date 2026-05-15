// Real-game regression fixture #2: STRK vs ESTR rematch 2026-05-15.
//
// Game 3 in the four-game replay-fixture initiative. STRK is HOME this time
// (different from Game 1). Final: STRK 7, ESTR 6 — walk-off win in Bot 7th
// (Couvillion's bunt single scores Buckner from 3rd, only 2 outs in the half).
//
// Line score truth oracle:
//   ESTR (away)  0 1 1 0 1 3 0 — 6
//   STRK (home)  0 0 3 3 0 0 1 — 7  (partial Bot 7th; walk-off)
//
// High-priority edge cases this fixture probes (engine punch-list candidates):
//   1. Mid-PA CS + K in same PA = 2 outs (Top 1st: Tillman CS + Ingram K)
//   2. FC where lead runner is out at HOME (Top 2nd: Bankston FC 5-2)
//   3. Multi-fielder pickoff 3-6 (Top 2nd: B Bowman picked off 2nd, ends half)
//   4. Mid-PA E1 spanning 2 bases (Bot 3rd: Couvillion 1→3 on Ingram E)
//   5. Mid-PA Balk (Bot 5th + Bot 7th: McGee balks)
//   6. Tag-up advance (Bot 7th: Buckner 2→3 on Portera F9)
//   7. Walk-off (Bot 7th: game ends mid-inning at 2 outs)
//   8. Mid-game position swap C→P (Carlisle, opposing, loose; mostly skipped)
//   9. PH + starter re-entry (Bankston Top 6→7th; Cummins same)
//  10. Two-way player (McGee pitches AND HRs same game; same opaque id)
//
// Encoding-gap and divergence comments are inline as `// GAP:` and `// NOTE:`.

import { describe, expect, it } from "vitest";
import { replay } from "./replay";
import type {
  AtBatPayload,
  CaughtStealingPayload,
  GameEventRecord,
  GameStartedPayload,
  InningEndPayload,
  PickoffPayload,
  PitchingChangePayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "./types";

// STRK lineup (home this game)
const P_MULLINS = "p_mullins";
const P_LITTLE = "p_little";
const P_TEMPLETON = "p_templeton";
const P_BERKERY = "p_berkery";
const P_BUCKNER = "p_buckner";      // batter (DH)
const P_JOHNSON = "p_johnson";
const P_PORTERA = "p_portera";
const P_COUVILLION = "p_couvillion";
const P_KNIGHT = "p_knight";

// STRK pitchers (DISTINCT from P_BUCKNER the DH-batter)
const P_S_BUCKNER = "p_s_buckner";  // starting pitcher
const P_NORTHCUTT = "p_northcutt";  // relief, in for Top 6th

// ESTR opposing identities. Opaque ids for any baserunner we need to track
// across multiple mid-PA / between-PA events.
const OPP_INGRAM = "opp_ingram";    // ESTR starting pitcher
const OPP_MCGEE = "opp_mcgee";      // ESTR relief pitcher AND batter (two-way)
//
// Runner-tracking opaque ids (one per opposing baserunner appearance).
const OPP_TILLMAN_R1 = "opp_tillman_r1";   // Top 1st BB
const OPP_A_BOWMAN_R2 = "opp_a_bowman_r2"; // Top 2nd 1B
const OPP_CARLISLE_R2 = "opp_carlisle_r2"; // Top 2nd BB (then out at home FC)
const OPP_B_BOWMAN_R2 = "opp_b_bowman_r2"; // Top 2nd 1B
const OPP_PRESTWOOD_R3 = "opp_prestwood_r3"; // Top 3rd HBP
const OPP_MCGEE_R3 = "opp_mcgee_r3"; // Top 3rd 2B
const OPP_BBOWMAN_R4 = "opp_bbowman_r4";    // Top 4th BB
const OPP_PRESTWOOD_R5 = "opp_prestwood_r5"; // Top 5th BB
const OPP_TILLMAN_R5 = "opp_tillman_r5"; // Top 5th FC reach
const OPP_INGRAM_R5 = "opp_ingram_r5"; // Top 5th BB
const OPP_ABOWMAN_R5 = "opp_abowman_r5"; // Top 5th HBP
const OPP_PRESTWOOD_R6 = "opp_prestwood_r6";
const OPP_TILLMAN_R6 = "opp_tillman_r6";
const OPP_BBOWMAN_R7 = "opp_bbowman_r7";

let seq = 0;
function evt<P>(type: GameEventRecord["event_type"], payload: P): GameEventRecord {
  seq += 1;
  return {
    id: `e${seq}`,
    game_id: "g_strk_estr_20260515",
    client_event_id: `c${seq}`,
    sequence_number: seq,
    event_type: type,
    payload: payload as unknown as GameEventRecord["payload"],
    supersedes_event_id: null,
    created_at: new Date(2026, 4, 15, 18, seq).toISOString(),
  };
}

// STRK PA: we're home, batting "bottom".
const atBat = (p: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "bottom",
  batter_id: null,
  pitcher_id: null,
  opponent_pitcher_id: OPP_INGRAM,
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

// ESTR PA: they're visitor, batting "top". Our pitcher on the mound.
const oppAtBat = (p: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "top",
  batter_id: null,
  pitcher_id: P_S_BUCKNER,
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

const ESTR_LINEUP = Array.from({ length: 9 }, (_, i) => ({
  batting_order: i + 1,
  opponent_player_id: null,
  jersey_number: null,
  last_name: `estr_${i + 1}`,
  position: null,
  is_dh: false,
}));

function startGame(): GameEventRecord {
  return evt<GameStartedPayload>("game_started", {
    we_are_home: true, // STRK is HOME this game
    use_dh: true,
    starting_lineup: STRK_LINEUP,
    starting_pitcher_id: P_S_BUCKNER,
    opponent_starting_pitcher_id: OPP_INGRAM,
    opposing_lineup: ESTR_LINEUP,
    opponent_use_dh: false,
  });
}

// ============================================================================

describe("STRK (home) vs ESTR (rematch) 2026-05-15 — Game 3 walk-off fixture", () => {
  it("reproduces the end state of the 7-6 walk-off win", () => {
    seq = 0;
    const events: GameEventRecord[] = [];
    events.push(startGame());

    // -----------------------------------------------------------------------
    // TOP 1ST — ESTR 0 (we field). S Buckner on mound.
    // -----------------------------------------------------------------------
    // (1) Tillman BB (opp runner on 1st)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "top",
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_TILLMAN_R1 }],
    })));
    // (2) McGee pop out to P
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "top",
      result: "PO",
      fielder_position: "P",
    })));
    // Mid-PA CS during Ingram's K: Tillman caught stealing 2nd (C → 2B).
    events.push(evt<CaughtStealingPayload>("caught_stealing", {
      runner_id: OPP_TILLMAN_R1,
      from: "first",
    }));
    // (3) Ingram K-swinging — independently 3rd out (CS already gave 2nd out).
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "top",
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 1ST — STRK 0. Ingram pitching.
    // -----------------------------------------------------------------------
    // (1) Mullins BB
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_MULLINS, batting_order: 1,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_MULLINS }],
    })));
    // (2) Little F9
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_LITTLE, batting_order: 2,
      result: "FO",
      fielder_position: "RF",
    })));
    // Mid-Templeton SB: Mullins 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_MULLINS, from: "first", to: "second",
    }));
    // (3) Templeton line out to LF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_TEMPLETON, batting_order: 3,
      result: "LO",
      fielder_position: "LF",
    })));
    // (4) Berkery 4-3 GO
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_BERKERY, batting_order: 4,
      result: "GO",
      fielder_position: "2B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 1, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 2ND — ESTR 1
    // -----------------------------------------------------------------------
    // (1) A Bowman 1B hard GB to CF Portera
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "top",
      result: "1B",
      fielder_position: "CF",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_A_BOWMAN_R2 }],
    })));
    // (2) Carlisle BB, A Bowman to 2nd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "top",
      result: "BB",
      runner_advances: [
        { from: "first",  to: "second", player_id: OPP_A_BOWMAN_R2 },
        { from: "batter", to: "first",  player_id: OPP_CARLISLE_R2 },
      ],
    })));
    // (3) B Bowman 1B to CF — A Bowman scores, Carlisle to 3rd, B Bowman
    //     takes 2nd on the throw (recurring "single + advance on throw" pattern).
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "top",
      result: "1B",
      rbi: 1,
      fielder_position: "CF",
      runner_advances: [
        { from: "second", to: "home",   player_id: OPP_A_BOWMAN_R2 },
        { from: "first",  to: "third",  player_id: OPP_CARLISLE_R2 },
        { from: "batter", to: "second", player_id: OPP_B_BOWMAN_R2 },
      ],
    })));
    // (4) Bankston FC 5-2 — Carlisle gunned down at HOME, B Bowman held at 2nd.
    //     Engine doesn't distinguish 5-2 notation; runner_advance `to: "out"`
    //     conveys the lead-runner-out-at-home outcome. Batter safe at 1st.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "top",
      result: "FC",
      fielder_position: "3B",
      runner_advances: [
        { from: "third",  to: "out",   player_id: OPP_CARLISLE_R2 },
        { from: "batter", to: "first", player_id: "opp_bankston_r2" },
      ],
    })));
    // (5) Cummins K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "top",
      result: "K_swinging",
    })));
    // (6) Between-PA multi-fielder pickoff: B Bowman picked off 2nd via 3-6
    //     (1B Johnson throws to SS Berkery). Engine supports basic `pickoff`
    //     event; multi-fielder chain (3-6) is LOSSY — recorded as a simple
    //     pickoff at 2nd.
    events.push(evt<PickoffPayload>("pickoff", {
      runner_id: OPP_B_BOWMAN_R2,
      from: "second",
    }));
    events.push(evt<InningEndPayload>("inning_end", { inning: 2, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 2ND — STRK 0
    // -----------------------------------------------------------------------
    // (1) Buckner 4-3 GO
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "bottom",
      batter_id: P_BUCKNER, batting_order: 5,
      result: "GO",
      fielder_position: "2B",
    })));
    // (2) Johnson 5-3 GO
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "bottom",
      batter_id: P_JOHNSON, batting_order: 6,
      result: "GO",
      fielder_position: "3B",
    })));
    // (3) Portera 3-1 GO
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "bottom",
      batter_id: P_PORTERA, batting_order: 7,
      result: "GO",
      fielder_position: "1B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 2, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 3RD — ESTR 1 (running 2-0)
    // -----------------------------------------------------------------------
    // (1) Prestwood HBP
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "HBP",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_PRESTWOOD_R3 }],
    })));
    // (2) Tillman K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "K_swinging",
    })));
    // (3) McGee 2B to RF; Prestwood to 3rd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "2B",
      fielder_position: "RF",
      runner_advances: [
        { from: "first",  to: "third",  player_id: OPP_PRESTWOOD_R3 },
        { from: "batter", to: "second", player_id: OPP_MCGEE_R3 },
      ],
    })));
    // (4) Ingram SF to CF; Prestwood scores, McGee holds at 2nd.
    //     Explicit batter-out per engine quirk (any runner_advances disables
    //     the default 1-out for SF/FO/GO/etc).
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "SF",
      rbi: 1,
      fielder_position: "CF",
      runner_advances: [
        { from: "batter", to: "out",  player_id: OPP_INGRAM },
        { from: "third",  to: "home", player_id: OPP_PRESTWOOD_R3 },
      ],
    })));
    // (5) A Bowman pop out to SS
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "PO",
      fielder_position: "SS",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 3, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 3RD — STRK 3 (running 3-2)
    // -----------------------------------------------------------------------
    // (1) Couvillion 1B line drive to RF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_COUVILLION, batting_order: 8,
      result: "1B",
      fielder_position: "RF",
      runner_advances: [{ from: "batter", to: "first", player_id: P_COUVILLION }],
    })));
    // Mid-Knight E1: Couvillion advances 1→3 (pitcher error spanning 2 bases)
    events.push(evt<RunnerMovePayload>("error_advance", {
      advances: [{ from: "first", to: "third", player_id: P_COUVILLION }],
      error_fielder_position: "P",
      error_type: "fielding",
    }));
    // (2) Knight SF to CF; Couvillion scores → STRK 1-2
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_KNIGHT, batting_order: 9,
      result: "SF",
      rbi: 1,
      fielder_position: "CF",
      runner_advances: [
        { from: "batter", to: "out",  player_id: P_KNIGHT },
        { from: "third",  to: "home", player_id: P_COUVILLION },
      ],
    })));
    // (3) Mullins 1B hard GB to LF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_MULLINS, batting_order: 1,
      result: "1B",
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "first", player_id: P_MULLINS }],
    })));
    // (4) Little 1B pop fly to RF; Mullins to 2nd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_LITTLE, batting_order: 2,
      result: "1B",
      fielder_position: "RF",
      runner_advances: [
        { from: "first",  to: "second", player_id: P_MULLINS },
        { from: "batter", to: "first",  player_id: P_LITTLE },
      ],
    })));
    // (5) Templeton F7
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_TEMPLETON, batting_order: 3,
      result: "FO",
      fielder_position: "LF",
    })));
    // (6) Berkery BB; Mullins to 3rd, Little to 2nd (forced)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_BERKERY, batting_order: 4,
      result: "BB",
      runner_advances: [
        { from: "second", to: "third",  player_id: P_MULLINS },
        { from: "first",  to: "second", player_id: P_LITTLE },
        { from: "batter", to: "first",  player_id: P_BERKERY },
      ],
    })));
    // (7) Buckner 1B fly ball to CF — Little scores, Mullins scores, Berkery
    //     to 3rd, Buckner to 2nd on the throw. (Recurring 1B + 2 RBI +
    //     advance-on-throw pattern.) STRK 3-2.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_BUCKNER, batting_order: 5,
      result: "1B",
      rbi: 2,
      fielder_position: "CF",
      runner_advances: [
        { from: "third",  to: "home",   player_id: P_MULLINS },
        { from: "second", to: "home",   player_id: P_LITTLE },
        { from: "first",  to: "third",  player_id: P_BERKERY },
        { from: "batter", to: "second", player_id: P_BUCKNER },
      ],
    })));
    // (8) Johnson 5-3 GO → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_JOHNSON, batting_order: 6,
      result: "GO",
      fielder_position: "3B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 3, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 4TH — ESTR 0
    // -----------------------------------------------------------------------
    // (1) Carlisle 5-3 GO
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "top",
      result: "GO",
      fielder_position: "3B",
    })));
    // (2) B Bowman BB
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "top",
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_BBOWMAN_R4 }],
    })));
    // (3) Bankston K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "top",
      result: "K_swinging",
    })));
    // (4) Cummins FC 5-4, B Bowman out at 2nd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "top",
      result: "FC",
      fielder_position: "3B",
      runner_advances: [
        { from: "first",  to: "out",   player_id: OPP_BBOWMAN_R4 },
        { from: "batter", to: "first", player_id: "opp_cummins_r4" },
      ],
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 4, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 4TH — STRK 3 (running 3-6)
    // -----------------------------------------------------------------------
    // (1) Portera solo HR to LF → STRK 4-2
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_PORTERA, batting_order: 7,
      result: "HR",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "home", player_id: P_PORTERA }],
    })));
    // (2) Couvillion pop out to SS
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_COUVILLION, batting_order: 8,
      result: "PO",
      fielder_position: "SS",
    })));
    // (3) Knight HBP
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_KNIGHT, batting_order: 9,
      result: "HBP",
      runner_advances: [{ from: "batter", to: "first", player_id: P_KNIGHT }],
    })));
    // (4) Mullins F8 (Knight stays)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_MULLINS, batting_order: 1,
      result: "FO",
      fielder_position: "CF",
    })));
    // Mid-Little SB: Knight 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_KNIGHT, from: "first", to: "second",
    }));
    // (5) Little 2-run HR to CF — Knight scores → STRK 6-2
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_LITTLE, batting_order: 2,
      result: "HR",
      rbi: 2,
      fielder_position: "CF",
      runner_advances: [
        { from: "second", to: "home", player_id: P_KNIGHT },
        { from: "batter", to: "home", player_id: P_LITTLE },
      ],
    })));
    // (6) Templeton 1B GB to CF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_TEMPLETON, batting_order: 3,
      result: "1B",
      fielder_position: "CF",
      runner_advances: [{ from: "batter", to: "first", player_id: P_TEMPLETON }],
    })));
    // (7) Berkery K-swinging → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_BERKERY, batting_order: 4,
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 4, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 5TH — ESTR 1 (running 3-6)
    // -----------------------------------------------------------------------
    // (1) Prestwood BB
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_PRESTWOOD_R5 }],
    })));
    // (2) Tillman FC 4-6, Prestwood out at 2nd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      result: "FC",
      fielder_position: "2B",
      runner_advances: [
        { from: "first",  to: "out",   player_id: OPP_PRESTWOOD_R5 },
        { from: "batter", to: "first", player_id: OPP_TILLMAN_R5 },
      ],
    })));
    // (3) McGee F9 (Tillman stays)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      result: "FO",
      fielder_position: "RF",
    })));
    // (4) Ingram BB; Tillman to 2nd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      result: "BB",
      runner_advances: [
        { from: "first",  to: "second", player_id: OPP_TILLMAN_R5 },
        { from: "batter", to: "first",  player_id: OPP_INGRAM_R5 },
      ],
    })));
    // (5) A Bowman HBP; bases loaded (Tillman→3rd, Ingram→2nd)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      result: "HBP",
      runner_advances: [
        { from: "second", to: "third",  player_id: OPP_TILLMAN_R5 },
        { from: "first",  to: "second", player_id: OPP_INGRAM_R5 },
        { from: "batter", to: "first",  player_id: OPP_ABOWMAN_R5 },
      ],
    })));
    // (6) Carlisle 1B GB to 3B Knight — Tillman scores (forced), Ingram to 3rd,
    //     A Bowman to 2nd. ESTR 3-6.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      result: "1B",
      rbi: 1,
      fielder_position: "3B",
      runner_advances: [
        { from: "third",  to: "home",   player_id: OPP_TILLMAN_R5 },
        { from: "second", to: "third",  player_id: OPP_INGRAM_R5 },
        { from: "first",  to: "second", player_id: OPP_ABOWMAN_R5 },
        { from: "batter", to: "first",  player_id: "opp_carlisle_r5" },
      ],
    })));
    // (7) B Bowman F6 → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      result: "FO",
      fielder_position: "SS",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 5, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 5TH — STRK 0. McGee comes in to pitch (1B → P).
    // -----------------------------------------------------------------------
    // ESTR-side pitching change. We don't have an event type for "opposing
    // pitching change" beyond setting opponent_pitcher_id on subsequent at_bats.
    // Engine doesn't validate opposing pitchers, so we just thread the new id.
    //
    // (1) Buckner pop out to 1B
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_BUCKNER, batting_order: 5,
      opponent_pitcher_id: OPP_MCGEE,
      result: "PO",
      fielder_position: "1B",
    })));
    // (2) Johnson BB
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_JOHNSON, batting_order: 6,
      opponent_pitcher_id: OPP_MCGEE,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_JOHNSON }],
    })));
    // Mid-Portera BALK by McGee: Johnson 1→2
    events.push(evt<RunnerMovePayload>("balk", {
      advances: [{ from: "first", to: "second", player_id: P_JOHNSON }],
    }));
    // (3) Portera K-swinging
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_PORTERA, batting_order: 7,
      opponent_pitcher_id: OPP_MCGEE,
      result: "K_swinging",
    })));
    // (4) Couvillion pop out to C
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_COUVILLION, batting_order: 8,
      opponent_pitcher_id: OPP_MCGEE,
      result: "PO",
      fielder_position: "C",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 5, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 6TH — ESTR 3 (TIE 6-6). Northcutt comes in. Two PHs on ESTR side.
    // -----------------------------------------------------------------------
    // Pitching change: S Buckner → Northcutt
    events.push(evt<PitchingChangePayload>("pitching_change", {
      out_pitcher_id: P_S_BUCKNER,
      in_pitcher_id: P_NORTHCUTT,
    }));
    // ESTR PH events not modeled — opposing roster bookkeeping is loose by
    // design. We just emit the at_bats with thread to OPP_MCGEE (now batting
    // too — two-way player, same opaque id as the pitcher).
    //
    // (1) #15 PH for Bankston → GO to P (1 out)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "GO",
      fielder_position: "P",
    })));
    // (2) Johnson PH for Cummins → 6-3 GO (2 outs)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "GO",
      fielder_position: "SS",
    })));
    // (3) Prestwood 1B to SS
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "1B",
      fielder_position: "SS",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_PRESTWOOD_R6 }],
    })));
    // (4) Tillman BB; Prestwood to 2nd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "BB",
      runner_advances: [
        { from: "first",  to: "second", player_id: OPP_PRESTWOOD_R6 },
        { from: "batter", to: "first",  player_id: OPP_TILLMAN_R6 },
      ],
    })));
    // (5) McGee 3-run HR to RF — Prestwood + Tillman score → TIE 6-6
    //     NOTE: McGee opaque id is same as the pitcher id (two-way player).
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "HR",
      rbi: 3,
      fielder_position: "RF",
      runner_advances: [
        { from: "second", to: "home", player_id: OPP_PRESTWOOD_R6 },
        { from: "first",  to: "home", player_id: OPP_TILLMAN_R6 },
        { from: "batter", to: "home", player_id: OPP_MCGEE },
      ],
    })));
    // (6) Ingram K-swinging → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 6, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 6TH — STRK 0. McGee pitching.
    // -----------------------------------------------------------------------
    // (1) Knight line out to CF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "bottom",
      batter_id: P_KNIGHT, batting_order: 9,
      opponent_pitcher_id: OPP_MCGEE,
      result: "LO",
      fielder_position: "CF",
    })));
    // (2) Mullins BB
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "bottom",
      batter_id: P_MULLINS, batting_order: 1,
      opponent_pitcher_id: OPP_MCGEE,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_MULLINS }],
    })));
    // (3) Little F8 (Mullins stays at 1st)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "bottom",
      batter_id: P_LITTLE, batting_order: 2,
      opponent_pitcher_id: OPP_MCGEE,
      result: "FO",
      fielder_position: "CF",
    })));
    // Mid-Templeton SB: Mullins 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_MULLINS, from: "first", to: "second",
    }));
    // (4) Templeton BB; Mullins held at 2nd (not forced because 1st is open)
    //     ... actually with Mullins on 2nd and a walk: Templeton to 1st,
    //     Mullins stays at 2nd. Then on Berkery FC Mullins out at 3rd.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "bottom",
      batter_id: P_TEMPLETON, batting_order: 3,
      opponent_pitcher_id: OPP_MCGEE,
      result: "BB",
      runner_advances: [
        { from: "batter", to: "first", player_id: P_TEMPLETON },
      ],
    })));
    // (5) Berkery FC to 3B Ingram — Mullins out advancing to 3rd; Templeton
    //     forced to 2nd, Berkery safe at 1st.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "bottom",
      batter_id: P_BERKERY, batting_order: 4,
      opponent_pitcher_id: OPP_MCGEE,
      result: "FC",
      fielder_position: "3B",
      runner_advances: [
        { from: "second", to: "out",    player_id: P_MULLINS },
        { from: "first",  to: "second", player_id: P_TEMPLETON },
        { from: "batter", to: "first",  player_id: P_BERKERY },
      ],
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 6, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 7TH — ESTR 0
    // -----------------------------------------------------------------------
    // PH re-entries on opposing side (Bankston re-enters for #15; Cummins
    // re-enters for Johnson) — NOT modeled, opposing-side roster bookkeeping
    // is loose. We just continue emitting at_bats.
    //
    // (1) A Bowman 3-3 GO unassisted
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "GO",
      fielder_position: "1B",
    })));
    // (2) Carlisle F7
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "FO",
      fielder_position: "LF",
    })));
    // (3) B Bowman BB
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_BBOWMAN_R7 }],
    })));
    // (4) Bankston (re-enters) 1B to RF; B Bowman to 2nd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "1B",
      fielder_position: "RF",
      runner_advances: [
        { from: "first",  to: "second", player_id: OPP_BBOWMAN_R7 },
        { from: "batter", to: "first",  player_id: "opp_bankston_r7" },
      ],
    })));
    // (5) Cummins (re-enters) K-swinging → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 7, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 7TH — STRK 1 (WALK-OFF). 2 outs total.
    // -----------------------------------------------------------------------
    // (1) Buckner BB
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 7, half: "bottom",
      batter_id: P_BUCKNER, batting_order: 5,
      opponent_pitcher_id: OPP_MCGEE,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_BUCKNER }],
    })));
    // Mid-Johnson BALK by McGee: Buckner 1→2
    events.push(evt<RunnerMovePayload>("balk", {
      advances: [{ from: "first", to: "second", player_id: P_BUCKNER }],
    }));
    // (2) Johnson K-swinging
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 7, half: "bottom",
      batter_id: P_JOHNSON, batting_order: 6,
      opponent_pitcher_id: OPP_MCGEE,
      result: "K_swinging",
    })));
    // (3) Portera F9; Buckner tags up and advances 2→3
    //     NOTE (engine quirk): when `runner_advances` is non-empty the engine
    //     does NOT auto-add the default 1 out for FO — the batter's out must
    //     be explicitly enumerated. Same applies to other default-1-out
    //     results when you also need to express a runner advance.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 7, half: "bottom",
      batter_id: P_PORTERA, batting_order: 7,
      opponent_pitcher_id: OPP_MCGEE,
      result: "FO",
      fielder_position: "RF",
      runner_advances: [
        { from: "batter", to: "out",   player_id: P_PORTERA },
        { from: "second", to: "third", player_id: P_BUCKNER },
      ],
    })));
    // (4) Couvillion walk-off bunt 1B to P; Buckner scores from 3rd.
    //     GAME OVER: STRK 7, ESTR 6. NO inning_end (only 2 outs); we emit
    //     game_finalized to flip status to "final".
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 7, half: "bottom",
      batter_id: P_COUVILLION, batting_order: 8,
      opponent_pitcher_id: OPP_MCGEE,
      result: "1B",
      rbi: 1,
      fielder_position: "P",
      runner_advances: [
        { from: "third",  to: "home",  player_id: P_BUCKNER },
        { from: "batter", to: "first", player_id: P_COUVILLION },
      ],
    })));
    events.push(evt("game_finalized", {}));

    // -----------------------------------------------------------------------
    // REPLAY + ASSERTIONS
    // -----------------------------------------------------------------------
    const state = replay(events);

    // Final score per truth oracle: STRK 7, ESTR 6.
    expect(state.team_score, "STRK 7 final (walk-off)").toBe(7);
    expect(state.opponent_score, "ESTR 6 final").toBe(6);
    expect(state.status).toBe("final");
    expect(state.inning).toBe(7);
    expect(state.half).toBe("bottom");
    expect(state.outs, "Walk-off — half ended at 2 outs").toBe(2);

    // Per-half cumulative score progression at each inning_end.
    const cum = computeCumulativeScores(events);
    // ESTR (top) accumulates: 0, 1, 1, 0, 1, 3, 0 = 6 total.
    // STRK (bottom, partial 7th): 0, 0, 3, 3, 0, 0  (walk-off after that)
    expect(cum["1_top"]).toEqual({ team: 0, opp: 0 });
    expect(cum["1_bottom"]).toEqual({ team: 0, opp: 0 });
    expect(cum["2_top"]).toEqual({ team: 0, opp: 1 });
    expect(cum["2_bottom"]).toEqual({ team: 0, opp: 1 });
    expect(cum["3_top"]).toEqual({ team: 0, opp: 2 });
    expect(cum["3_bottom"]).toEqual({ team: 3, opp: 2 });
    expect(cum["4_top"]).toEqual({ team: 3, opp: 2 });
    expect(cum["4_bottom"]).toEqual({ team: 6, opp: 2 });
    expect(cum["5_top"]).toEqual({ team: 6, opp: 3 });
    expect(cum["5_bottom"]).toEqual({ team: 6, opp: 3 });
    expect(cum["6_top"]).toEqual({ team: 6, opp: 6 });
    expect(cum["6_bottom"]).toEqual({ team: 6, opp: 6 });
    expect(cum["7_top"]).toEqual({ team: 6, opp: 6 });
    // Bot 7th: no inning_end fired (walk-off). State at game_finalized
    // already asserted above.

    // Outs-per-half checks. CS / pickoff add 1 out each. Walk-off Bot 7th
    // has only 2 outs total — fewer than 3.
    const halves: Array<[number, "top" | "bottom", number]> = [
      // (inning, half, expected outs)
      [1, "top", 3],     // 2 AB outs + 1 CS out (Tillman CS during Ingram K)
      [1, "bottom", 3],
      [2, "top", 3],     // 2 AB outs + 1 pickoff (B Bowman PO at 2nd)
      [2, "bottom", 3],
      [3, "top", 3],
      [3, "bottom", 3],
      [4, "top", 3],
      [4, "bottom", 3],
      [5, "top", 3],
      [5, "bottom", 3],
      [6, "top", 3],
      [6, "bottom", 3],
      [7, "top", 3],
      [7, "bottom", 2], // walk-off, only 2 outs
    ];
    for (const [inning, half, expectedOuts] of halves) {
      const abOuts = state.at_bats
        .filter((ab) => ab.inning === inning && ab.half === half)
        .reduce((sum, ab) => sum + ab.outs_recorded, 0);
      // Non-PA basepath outs: 1 CS in 1_top + 1 pickoff in 2_top.
      let nonPaOuts = 0;
      if (inning === 1 && half === "top") nonPaOuts += 1; // Tillman CS
      if (inning === 2 && half === "top") nonPaOuts += 1; // B Bowman PO
      expect(abOuts + nonPaOuts, `${inning}_${half} outs`).toBe(expectedOuts);
    }

    // ---------- Edge-case spot checks ----------

    // (1) Tillman CS is recorded in state.caught_stealing exactly once.
    const tillmanCs = state.caught_stealing.filter(
      (cs) => cs.runner_id === OPP_TILLMAN_R1,
    );
    expect(tillmanCs.length, "Tillman CS @ 2nd in Top 1st").toBe(1);

    // (2) Top 2nd Bankston FC 5-2: result=FC, outs_recorded=1, Carlisle out
    //     at home.
    const bankstonFc = state.at_bats.find(
      (ab) => ab.inning === 2 && ab.half === "top" && ab.result === "FC",
    )!;
    expect(bankstonFc.outs_recorded, "FC 5-2 records 1 out").toBe(1);
    expect(bankstonFc.runs_scored_on_play, "Lead runner out at home, no run").toBe(0);

    // (3) Multi-fielder pickoff recorded.
    const bbowmanPo = state.pickoffs.filter((po) => po.runner_id === OPP_B_BOWMAN_R2);
    expect(bbowmanPo.length, "B Bowman picked off 2nd").toBe(1);

    // (4) Bot 3rd Knight SF with mid-PA E1 advance:
    //     - Knight SF records 1 out, 1 RBI, runs_scored_on_play=1.
    //     - error_advance event itself doesn't score (Couvillion moved to 3rd,
    //       not home).
    const knightSf = state.at_bats.find(
      (ab) => ab.batter_id === P_KNIGHT && ab.inning === 3 && ab.half === "bottom",
    )!;
    expect(knightSf.result).toBe("SF");
    expect(knightSf.outs_recorded).toBe(1);
    expect(knightSf.runs_scored_on_play, "Couvillion scored on Knight SF").toBe(1);

    // (5) Both mid-PA balks recorded as non_pa_runs entries with source="balk".
    //     BUT only when we are FIELDING — both Game 3 balks happened while we
    //     are BATTING (Bot 5th + Bot 7th), so they should NOT appear in
    //     non_pa_runs. The runner advancement still affects bases though.
    //
    //     Per note in the task: "non_pa_runs only populated when we are
    //     fielding." Both balks happen during STRK at-bats, so no entries.
    const balkRunsCharged = state.non_pa_runs.filter((r) => r.source === "balk");
    expect(balkRunsCharged.length, "Balks during STRK at-bat → no non_pa_runs").toBe(0);

    // (6) Bot 7th Portera FO with tag-up advance: outs_recorded=1, no run.
    const porteraFo = state.at_bats.find(
      (ab) => ab.batter_id === P_PORTERA && ab.inning === 7 && ab.half === "bottom",
    )!;
    expect(porteraFo.result).toBe("FO");
    expect(porteraFo.outs_recorded).toBe(1);

    // (7) Walk-off: Couvillion's 1B scored Buckner.
    const walkoff = state.at_bats.find(
      (ab) => ab.batter_id === P_COUVILLION && ab.inning === 7 && ab.half === "bottom",
    )!;
    expect(walkoff.result).toBe("1B");
    expect(walkoff.runs_scored_on_play, "Buckner scores on walk-off bunt").toBe(1);
    expect(walkoff.rbi).toBe(1);

    // (8) McGee two-way: 3-run HR in Top 6th.
    const mcgeeHr = state.at_bats.find(
      (ab) => ab.inning === 6 && ab.half === "top" && ab.result === "HR",
    )!;
    expect(mcgeeHr.runs_scored_on_play, "McGee 3-run HR").toBe(3);

    // (9) Couvillion error_advance in Bot 3rd should be in non_pa_runs ONLY
    //     if it scored a run. It didn't (1→3 only). So nothing logged.
    const couvErr = state.non_pa_runs.filter((r) => r.source === "error_advance");
    expect(couvErr.length, "Mid-PA E1 1→3 didn't score, no non_pa_run").toBe(0);
  });
});

// Walk events through replay() incrementally, snapshotting cumulative
// team/opp scores at every inning_end. Returns "{inning}_{half}" → {team, opp}.
function computeCumulativeScores(
  events: GameEventRecord[],
): Record<string, { team: number; opp: number }> {
  const result: Record<string, { team: number; opp: number }> = {};
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
