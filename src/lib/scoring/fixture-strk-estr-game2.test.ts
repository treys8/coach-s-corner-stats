// Real-game regression fixture #3: STRK vs ESTR (first matchup) 2026-05-15.
//
// Game 2 in the four-game replay-fixture initiative. STRK is AWAY this game
// (visitor). Final: STRK 14, ESTR 1 — run-rule end after Bot 6th (13-run lead).
// No Top/Bot 7th. Bot 6th plays to a full 3 outs, then game_finalized.
//
// Line score truth oracle:
//   STRK (away)   1 1 4 2 2 4 — 14
//   ESTR (home)   0 0 0 1 0 0 —  1
//
// High-priority edge cases this fixture probes (engine punch-list candidates):
//   1. Out on appeal at base ending half-inning (Top 1st, Templeton @ 3rd)
//   2. Sacrifice bunt (Top 2nd, Portera SAC to P)
//   3. 1B + 2 RBI + batter-advance-on-throw, no error (Top 3rd, Portera)
//   4. Bunt 1B + advance on E5 (cf Game 1 Top 5th)
//   5. Pickoff by catcher mid-PA (Bot 2nd, Johnson PO by Mullins)
//   6. Pinch hitter mid-game (Bot 2nd, Bankston PH for Cummins) — loose, skipped
//   7. CS @ HOME ending half (Top 4th, Berkery CS @ home C→P)
//   8. Multi-error play (Top 5th moved to Top 6th, Mullins 1B + own-run on E7)
//   9. Run-rule termination via game_finalized after Bot 6th inning_end
//  10. Two-way players A Bowman and B Bowman (same opaque id pattern)
//  11. Sacrifice fly during stolen base (Top 4th Berkery SB during Buckner SF;
//      Top 6th double steal during Couvillion SF)
//  12. WP advancing runner during a GO (Top 5th Knight WP 1→2 during Mullins GO)
//
// Encoding-gap and divergence comments are inline as `// NOTE:` / `// PUNCH-LIST:`.

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

// STRK lineup (visitor this game)
const P_MULLINS = "p_mullins";
const P_LITTLE = "p_little";
const P_TEMPLETON = "p_templeton";
const P_BERKERY = "p_berkery";
const P_BUCKNER = "p_buckner"; // batter (DH)
const P_JOHNSON = "p_johnson";
const P_PORTERA = "p_portera";
const P_COUVILLION = "p_couvillion";
const P_KNIGHT = "p_knight";
const P_BURKLEY = "p_burkley"; // our pitcher (complete game)

// ESTR opposing pitchers. Two-way players A Bowman and B Bowman appear both
// as batters and elsewhere; we use a single opaque id per name for both
// pitching and batting (per Game 3 two-way-player trick).
const OPP_B_BOWMAN = "opp_b_bowman"; // ESTR starting pitcher (also bats)
const OPP_A_BOWMAN = "opp_a_bowman"; // ESTR relief from Top 3rd (also bats)
const OPP_CARLISLE = "opp_carlisle"; // ESTR catcher (mentioned but no batting tracking)

// Opaque baserunner ids — one per opposing-runner appearance per inning.
const OPP_CARLISLE_R2 = "opp_carlisle_r2";   // Bot 2nd 1B (then out at 3rd)
const OPP_BBOWMAN_R2 = "opp_bbowman_r2";     // Bot 2nd ROE on E6
const OPP_JOHNSON_R2 = "opp_johnson_r2";     // Bot 2nd 1B (then picked off 1st)
const OPP_BANKSTON_R2 = "opp_bankston_r2";   // Bot 2nd 1B (PH for Cummins)
const OPP_ABOWMAN_R6 = "opp_abowman_r6";     // Bot 6th 2B

let seq = 0;
function evt<P>(type: GameEventRecord["event_type"], payload: P): GameEventRecord {
  seq += 1;
  return {
    id: `e${seq}`,
    game_id: "g_strk_estr_game2_20260515",
    client_event_id: `c${seq}`,
    sequence_number: seq,
    event_type: type,
    payload: payload as unknown as GameEventRecord["payload"],
    supersedes_event_id: null,
    created_at: new Date(2026, 4, 15, 12, seq).toISOString(),
  };
}

// STRK PA: we're visitor, batting "top".
const atBat = (p: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "top",
  batter_id: null,
  pitcher_id: null,
  opponent_pitcher_id: OPP_B_BOWMAN,
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

// ESTR PA: they're home, batting "bottom". Our pitcher Burkley on mound.
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
    we_are_home: false, // STRK is the visitor
    use_dh: true,
    starting_lineup: STRK_LINEUP,
    starting_pitcher_id: P_BURKLEY,
    opponent_starting_pitcher_id: OPP_B_BOWMAN,
    opposing_lineup: ESTR_LINEUP,
    opponent_use_dh: false,
  });
}

// ============================================================================

describe("STRK (away) vs ESTR (first matchup) 2026-05-15 — Game 2 run-rule fixture", () => {
  it("reproduces the end state of the 14-1 run-rule game", () => {
    seq = 0;
    const events: GameEventRecord[] = [];
    events.push(startGame());

    // -----------------------------------------------------------------------
    // TOP 1ST — STRK 1
    // -----------------------------------------------------------------------
    // (1) Mullins 1B to RF (B Bowman pitching)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_MULLINS, batting_order: 1,
      result: "1B",
      fielder_position: "RF",
      runner_advances: [{ from: "batter", to: "first", player_id: P_MULLINS }],
    })));
    // (2) Little PO to SS
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_LITTLE, batting_order: 2,
      result: "PO",
      fielder_position: "SS",
    })));
    // Mid-Templeton SB: Mullins 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_MULLINS, from: "first", to: "second",
    }));
    // (3) Templeton 1B to LF — Mullins scores from 2nd. STRK 1-0
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_TEMPLETON, batting_order: 3,
      result: "1B",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [
        { from: "second", to: "home",  player_id: P_MULLINS },
        { from: "batter", to: "first", player_id: P_TEMPLETON },
      ],
    })));
    // (4) Berkery PO to SS
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_BERKERY, batting_order: 4,
      result: "PO",
      fielder_position: "SS",
    })));
    // (5) Buckner 2B hard GB to LF, Templeton to 3rd.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      batter_id: P_BUCKNER, batting_order: 5,
      result: "2B",
      fielder_position: "LF",
      runner_advances: [
        { from: "first",  to: "third",  player_id: P_TEMPLETON },
        { from: "batter", to: "second", player_id: P_BUCKNER },
      ],
    })));
    // (6) Templeton out on appeal at 3rd — half-inning ends on the basepath.
    //
    // PUNCH-LIST (Game 2 NEW): no engine event type for "out on appeal at base".
    // Closest analog is a pickoff at 3rd. We encode as a `pickoff` event with
    // from="third" so the runner is removed and out count gets +1.
    // Attribution as an appeal is LOSSY. Severity: MINOR (rare play).
    events.push(evt<PickoffPayload>("pickoff", {
      runner_id: P_TEMPLETON,
      from: "third",
    }));
    events.push(evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 1ST — ESTR 0. Burkley pitching.
    // -----------------------------------------------------------------------
    // (1) Tillman line out to 1B
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "bottom",
      result: "LO",
      fielder_position: "1B",
    })));
    // (2) McGee K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "bottom",
      result: "K_swinging",
    })));
    // (3) Ingram BB
    const OPP_INGRAM_R1 = "opp_ingram_r1";
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "bottom",
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_INGRAM_R1 }],
    })));
    // Mid-A-Bowman WP: Ingram 1→2
    events.push(evt<RunnerMovePayload>("wild_pitch", {
      advances: [{ from: "first", to: "second", player_id: OPP_INGRAM_R1 }],
    }));
    // (4) A Bowman 5-3 GO → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "bottom",
      result: "GO",
      fielder_position: "3B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 1, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 2ND — STRK 1 (cum 2-0)
    // -----------------------------------------------------------------------
    // (1) Johnson 2B line drive to LF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "top",
      batter_id: P_JOHNSON, batting_order: 6,
      result: "2B",
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "second", player_id: P_JOHNSON }],
    })));
    // (2) Portera SAC bunt to P B Bowman; Portera out at 1st, Johnson to 3rd.
    //
    // NOTE: Engine silent-zero-outs trap — when runner_advances is non-empty
    // on SAC, must enumerate batter-out explicitly.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "top",
      batter_id: P_PORTERA, batting_order: 7,
      result: "SAC",
      fielder_position: "P",
      runner_advances: [
        { from: "batter", to: "out",   player_id: P_PORTERA },
        { from: "second", to: "third", player_id: P_JOHNSON },
      ],
    })));
    // (3) Couvillion 1B GB to RF; Johnson scores. STRK 2-0
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "top",
      batter_id: P_COUVILLION, batting_order: 8,
      result: "1B",
      rbi: 1,
      fielder_position: "RF",
      runner_advances: [
        { from: "third",  to: "home",  player_id: P_JOHNSON },
        { from: "batter", to: "first", player_id: P_COUVILLION },
      ],
    })));
    // (4) Knight 4-3 GO; Couvillion to 2nd. NOTE: silent-zero-outs trap —
    // must enumerate batter-out since we have a runner advance.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "top",
      batter_id: P_KNIGHT, batting_order: 9,
      result: "GO",
      fielder_position: "2B",
      runner_advances: [
        { from: "batter", to: "out",    player_id: P_KNIGHT },
        { from: "first",  to: "second", player_id: P_COUVILLION },
      ],
    })));
    // (5) Mullins F9 → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "top",
      batter_id: P_MULLINS, batting_order: 1,
      result: "FO",
      fielder_position: "RF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 2, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 2ND — ESTR 0
    // -----------------------------------------------------------------------
    // (1) Carlisle 1B hard GB to CF
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "bottom",
      result: "1B",
      fielder_position: "CF",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_CARLISLE_R2 }],
    })));
    // (2) Johnson 1B GB (6-3); Carlisle out advancing to 3rd. Hit credit
    //     stays on Johnson's batter, separate runner out at 3rd.
    //
    // NOTE: silent-zero-outs trap — enumerate batter to first (the hit) AND
    // Carlisle to "out" at 3rd.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "bottom",
      result: "1B",
      fielder_position: "SS",
      runner_advances: [
        { from: "first",  to: "out",   player_id: OPP_CARLISLE_R2 },
        { from: "batter", to: "first", player_id: OPP_JOHNSON_R2 },
      ],
    })));
    // (3) B Bowman ROE on E6 (Berkery). Mid-PA: Johnson picked off 1st by
    //     catcher Mullins.
    //
    // PUNCH-LIST (carried from Game 3 #2): pickoff by catcher loses C-1
    // fielder-chain notation. Engine just records pickoff at 1st.
    events.push(evt<PickoffPayload>("pickoff", {
      runner_id: OPP_JOHNSON_R2,
      from: "first",
    }));
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "bottom",
      result: "E",
      fielder_position: "SS",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_BBOWMAN_R2 }],
    })));
    // (4) Bankston PH for Cummins → 1B to RF; B Bowman to 2nd.
    //
    // PUNCH-LIST (carried from Game 3 #4): opposing-side pinch-hitter
    // substitution has no event surface. Per Game 3, opposing-side roster
    // bookkeeping is loose by design — we just emit the at_bat for Bankston
    // and accept the lost attribution. Severity: LOSSY.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "bottom",
      result: "1B",
      fielder_position: "RF",
      runner_advances: [
        { from: "first",  to: "second", player_id: OPP_BBOWMAN_R2 },
        { from: "batter", to: "first",  player_id: OPP_BANKSTON_R2 },
      ],
    })));
    // (5) Prestwood F8 → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "bottom",
      result: "FO",
      fielder_position: "CF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 2, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 3RD — STRK 4 (cum 6-0). ESTR pitching change to A Bowman.
    // -----------------------------------------------------------------------
    // A Bowman replaces B Bowman by Top 3rd. Per Game 3, opposing pitching-
    // change events are LOSSY in the engine. We thread opponent_pitcher_id
    // on the at_bats but skip a `pitching_change` event (no event type for
    // opposing-side pitching changes — only for our own).
    //
    // PUNCH-LIST (carried from Game 3 #4): opposing pitching change is not
    // expressible as a first-class event. Threading opponent_pitcher_id is
    // the only signal. Severity: LOSSY (handoff timing lost).
    //
    // (1) Little HR to LF. STRK 3-0 → solo HR (1 run)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_LITTLE, batting_order: 2,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "HR",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "home", player_id: P_LITTLE }],
    })));
    // (2) Templeton 1B line drive to LF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_TEMPLETON, batting_order: 3,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "first", player_id: P_TEMPLETON }],
    })));
    // (3) Berkery 1B bunt to P; Templeton to 2nd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_BERKERY, batting_order: 4,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      fielder_position: "P",
      runner_advances: [
        { from: "first",  to: "second", player_id: P_TEMPLETON },
        { from: "batter", to: "first",  player_id: P_BERKERY },
      ],
    })));
    // (4) Buckner 1B GB to 2B; Templeton to 3rd, Berkery to 2nd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_BUCKNER, batting_order: 5,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      fielder_position: "2B",
      runner_advances: [
        { from: "second", to: "third",  player_id: P_TEMPLETON },
        { from: "first",  to: "second", player_id: P_BERKERY },
        { from: "batter", to: "first",  player_id: P_BUCKNER },
      ],
    })));
    // (5) Johnson SF to CF — Templeton scores, Berkery to 3rd, Buckner to 2nd
    //     STRK 4-0, 1 out. NOTE: silent-zero-outs trap — enumerate batter-out.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_JOHNSON, batting_order: 6,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "SF",
      rbi: 1,
      fielder_position: "CF",
      runner_advances: [
        { from: "batter", to: "out",    player_id: P_JOHNSON },
        { from: "third",  to: "home",   player_id: P_TEMPLETON },
        { from: "second", to: "third",  player_id: P_BERKERY },
        { from: "first",  to: "second", player_id: P_BUCKNER },
      ],
    })));
    // (6) Portera 1B GB to RF — Buckner and Berkery both score on the throw;
    //     Portera advances to 2nd on the throw. NO error charged. STRK 6-0.
    //
    // PUNCH-LIST (Game 2 NEW + matches Game 3 #Y): "single + 2 RBI + batter
    // advances on the throw, no error" — engine has no `attribution_label`
    // on AtBatPayload (only RunnerMovePayload), so "advance on throw" notation
    // is LOSSY. The numeric outcome (1B/2 RBI/batter on 2nd) replays correctly.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_PORTERA, batting_order: 7,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      rbi: 2,
      fielder_position: "RF",
      runner_advances: [
        { from: "second", to: "home",   player_id: P_BERKERY },
        { from: "third",  to: "home",   player_id: P_BUCKNER },
        { from: "batter", to: "second", player_id: P_PORTERA },
      ],
    })));
    // (7) Couvillion K-looking (2 outs)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_COUVILLION, batting_order: 8,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "K_looking",
    })));
    // (8) Knight HBP
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_KNIGHT, batting_order: 9,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "HBP",
      runner_advances: [
        { from: "second", to: "third",  player_id: P_PORTERA },
        { from: "batter", to: "first",  player_id: P_KNIGHT },
      ],
    })));
    // (9) Mullins FC 4-6 — Knight out at 2nd, Portera to 3rd, Mullins to 1st.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "top",
      batter_id: P_MULLINS, batting_order: 1,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "FC",
      fielder_position: "2B",
      runner_advances: [
        { from: "first",  to: "out",   player_id: P_KNIGHT },
        { from: "third",  to: "third", player_id: P_PORTERA }, // stays
        { from: "batter", to: "first", player_id: P_MULLINS },
      ],
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 3, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 3RD — ESTR 0
    // -----------------------------------------------------------------------
    // (1) Tillman 1B hard GB to CF
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "1B",
      fielder_position: "CF",
      runner_advances: [{ from: "batter", to: "first", player_id: "opp_tillman_r3" }],
    })));
    // (2) McGee PO to SS
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "PO",
      fielder_position: "SS",
    })));
    // (3) Ingram LO to 3B
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "LO",
      fielder_position: "3B",
    })));
    // (4) A Bowman 4-3 GO → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "bottom",
      result: "GO",
      fielder_position: "2B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 3, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 4TH — STRK 2 (cum 8-0)
    // -----------------------------------------------------------------------
    // (1) Little BB
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_LITTLE, batting_order: 2,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_LITTLE }],
    })));
    // (2) Templeton 2B hard GB to LF, Little to 3rd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_TEMPLETON, batting_order: 3,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "2B",
      fielder_position: "LF",
      runner_advances: [
        { from: "first",  to: "third",  player_id: P_LITTLE },
        { from: "batter", to: "second", player_id: P_TEMPLETON },
      ],
    })));
    // (3) Berkery 1B line drive to LF — Little scores, Templeton to 3rd.
    //     STRK 7-0.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_BERKERY, batting_order: 4,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [
        { from: "third",  to: "home",  player_id: P_LITTLE },
        { from: "second", to: "third", player_id: P_TEMPLETON },
        { from: "batter", to: "first", player_id: P_BERKERY },
      ],
    })));
    // Mid-Buckner SB: Berkery 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_BERKERY, from: "first", to: "second",
    }));
    // (4) Buckner SF to CF — Templeton scores, Berkery to 3rd (after SB).
    //     STRK 8-0, 1 out. NOTE: silent-zero-outs trap — enumerate batter-out.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_BUCKNER, batting_order: 5,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "SF",
      rbi: 1,
      fielder_position: "CF",
      runner_advances: [
        { from: "batter", to: "out",   player_id: P_BUCKNER },
        { from: "third",  to: "home",  player_id: P_TEMPLETON },
        { from: "second", to: "third", player_id: P_BERKERY },
      ],
    })));
    // (5) Johnson K-looking (2 outs)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_JOHNSON, batting_order: 6,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "K_looking",
    })));
    // (6) Portera BB; Berkery stays at 3rd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "top",
      batter_id: P_PORTERA, batting_order: 7,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_PORTERA }],
    })));
    // (7) Berkery CS @ HOME (C → P). Ends the half on the basepath.
    //
    // PUNCH-LIST (Game 2 NEW): engine `caught_stealing` payload has `from`
    // but not a fielder chain — C→P notation is LOSSY. The standalone
    // basepath out terminating the half works fine (from="third" gives
    // a CS-at-home out). Severity: LOSSY (attribution detail lost).
    events.push(evt<CaughtStealingPayload>("caught_stealing", {
      runner_id: P_BERKERY,
      from: "third",
    }));
    events.push(evt<InningEndPayload>("inning_end", { inning: 4, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 4TH — ESTR 1 (their only run)
    // -----------------------------------------------------------------------
    // (1) Carlisle 4-3 GO
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "bottom",
      result: "GO",
      fielder_position: "2B",
    })));
    // (2) Johnson HR to RF — STRK 8-1
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "bottom",
      result: "HR",
      rbi: 1,
      fielder_position: "RF",
      runner_advances: [{ from: "batter", to: "home", player_id: "opp_johnson_r4" }],
    })));
    // (3) B Bowman foul PO to P
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "bottom",
      result: "PO",
      fielder_position: "P",
      foul_out: true,
    })));
    // (4) Bankston K-swinging → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "bottom",
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 4, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 5TH — STRK 2 (cum 10-1)
    // -----------------------------------------------------------------------
    // (1) Couvillion PO to 2B
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_COUVILLION, batting_order: 8,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "PO",
      fielder_position: "2B",
    })));
    // (2) Knight 1B GB to CF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_KNIGHT, batting_order: 9,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      fielder_position: "CF",
      runner_advances: [{ from: "batter", to: "first", player_id: P_KNIGHT }],
    })));
    // Mid-Mullins WP: Knight 1→2
    //
    // PUNCH-LIST (Game 2 NEW related to silent-zero-outs): Mullins's GO with
    // runner-advance (Knight to 3rd) requires enumerating batter-out — the
    // play-log says Knight ends at 3rd on the GO. Encode WP first, then GO
    // with batter→out + Knight 2→3.
    events.push(evt<RunnerMovePayload>("wild_pitch", {
      advances: [{ from: "first", to: "second", player_id: P_KNIGHT }],
    }));
    // (3) Mullins 6-3 GO; Knight 2→3 on the GO
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_MULLINS, batting_order: 1,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "GO",
      fielder_position: "SS",
      runner_advances: [
        { from: "batter", to: "out",   player_id: P_MULLINS },
        { from: "second", to: "third", player_id: P_KNIGHT },
      ],
    })));
    // (4) Little HBP; Knight stays at 3rd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_LITTLE, batting_order: 2,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "HBP",
      runner_advances: [{ from: "batter", to: "first", player_id: P_LITTLE }],
    })));
    // Mid-Templeton SB: Little 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_LITTLE, from: "first", to: "second",
    }));
    // (5) Templeton 1B to LF — Knight scores, Little scores. STRK 10-1.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_TEMPLETON, batting_order: 3,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      rbi: 2,
      fielder_position: "LF",
      runner_advances: [
        { from: "third",  to: "home",  player_id: P_KNIGHT },
        { from: "second", to: "home",  player_id: P_LITTLE },
        { from: "batter", to: "first", player_id: P_TEMPLETON },
      ],
    })));
    // (6) Berkery 1B GB to CF; Templeton to 3rd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_BERKERY, batting_order: 4,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      fielder_position: "CF",
      runner_advances: [
        { from: "first",  to: "third", player_id: P_TEMPLETON },
        { from: "batter", to: "first", player_id: P_BERKERY },
      ],
    })));
    // Mid-Buckner SB: Berkery 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_BERKERY, from: "first", to: "second",
    }));
    // (7) Buckner F7 to LF → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "top",
      batter_id: P_BUCKNER, batting_order: 5,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "FO",
      fielder_position: "LF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 5, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 5TH — ESTR 0
    // -----------------------------------------------------------------------
    // (1) Prestwood 1-3 GO to P
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "bottom",
      result: "GO",
      fielder_position: "P",
    })));
    // (2) Tillman K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "bottom",
      result: "K_swinging",
    })));
    // (3) McGee 1B line drive to CF
    const OPP_MCGEE_R5 = "opp_mcgee_r5";
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "bottom",
      result: "1B",
      fielder_position: "CF",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_MCGEE_R5 }],
    })));
    // (4) Ingram FC SS→2B, McGee out at 2nd → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "bottom",
      result: "FC",
      fielder_position: "SS",
      runner_advances: [
        { from: "first",  to: "out",   player_id: OPP_MCGEE_R5 },
        { from: "batter", to: "first", player_id: "opp_ingram_r5" },
      ],
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 5, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 6TH — STRK 4 (cum 14-1, run-rule trigger)
    // -----------------------------------------------------------------------
    // (1) Johnson BB
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_JOHNSON, batting_order: 6,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_JOHNSON }],
    })));
    // (2) Portera HBP; Johnson to 2nd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_PORTERA, batting_order: 7,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "HBP",
      runner_advances: [
        { from: "first",  to: "second", player_id: P_JOHNSON },
        { from: "batter", to: "first",  player_id: P_PORTERA },
      ],
    })));
    // Mid-Couvillion DOUBLE STEAL: Johnson 2→3, Portera 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_JOHNSON, from: "second", to: "third",
    }));
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_PORTERA, from: "first", to: "second",
    }));
    // (3) Couvillion SF to CF — Johnson scores, Portera to 3rd. STRK 11-1.
    //     NOTE: silent-zero-outs trap — enumerate batter-out.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_COUVILLION, batting_order: 8,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "SF",
      rbi: 1,
      fielder_position: "CF",
      runner_advances: [
        { from: "batter", to: "out",   player_id: P_COUVILLION },
        { from: "third",  to: "home",  player_id: P_JOHNSON },
        { from: "second", to: "third", player_id: P_PORTERA },
      ],
    })));
    // (4) Knight 1B line drive to CF; Portera scores. STRK 12-1.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_KNIGHT, batting_order: 9,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      rbi: 1,
      fielder_position: "CF",
      runner_advances: [
        { from: "third",  to: "home",  player_id: P_PORTERA },
        { from: "batter", to: "first", player_id: P_KNIGHT },
      ],
    })));
    // Mid-Mullins SB: Knight 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_KNIGHT, from: "first", to: "second",
    }));
    // (5) Mullins 1B GB to LF — Knight scores; Mullins scores on E7 (Bankston).
    //     STRK 14-1. Batter 1B + 1 RBI (Knight); batter's own run scored on
    //     the LF's error, NOT extra hit credit.
    //
    // PUNCH-LIST (Game 2 NEW): "batter's own run scores on an outfielder
    // error after his single" — engine has no per-step error attribution on
    // an AB-result. We model this by enumerating Mullins's path "batter→home"
    // inside an `error_advance` event AFTER the 1B records. The 1B credits
    // 1 hit + 1 RBI (Knight). The error_advance scores Mullins's run charged
    // to the LF. Severity: LOSSY (error fielder attribution to LF is captured
    // in error_fielder_position but rollup ignores it).
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_MULLINS, batting_order: 1,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "1B",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [
        { from: "second", to: "home",  player_id: P_KNIGHT },
        { from: "batter", to: "first", player_id: P_MULLINS },
      ],
    })));
    // Mullins's own run on E7 (Bankston) — separate error_advance event so
    // his hit credit stays a 1B (not inside-the-park HR) and the run is
    // recorded as an error advance.
    events.push(evt<RunnerMovePayload>("error_advance", {
      advances: [{ from: "first", to: "home", player_id: P_MULLINS }],
      error_fielder_position: "LF",
      error_type: "fielding",
    }));
    // (6) Little LO to LF (2 outs)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_LITTLE, batting_order: 2,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "LO",
      fielder_position: "LF",
    })));
    // (7) Templeton 2B hard GB to LF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_TEMPLETON, batting_order: 3,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "2B",
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "second", player_id: P_TEMPLETON }],
    })));
    // (8) Berkery BB; Templeton stays at 2nd (not forced)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_BERKERY, batting_order: 4,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_BERKERY }],
    })));
    // (9) Buckner FC to 3B Ingram — Templeton out at 3rd, Berkery to 2nd,
    //     Buckner to 1st → 3rd out (FC quirk: no out on the FC itself).
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "top",
      batter_id: P_BUCKNER, batting_order: 5,
      opponent_pitcher_id: OPP_A_BOWMAN,
      result: "FC",
      fielder_position: "3B",
      runner_advances: [
        { from: "second", to: "out",    player_id: P_TEMPLETON },
        { from: "first",  to: "second", player_id: P_BERKERY },
        { from: "batter", to: "first",  player_id: P_BUCKNER },
      ],
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 6, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 6TH — ESTR 0 (final inning, run-rule)
    // -----------------------------------------------------------------------
    // (1) A Bowman 2B line drive to RF
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "bottom",
      result: "2B",
      fielder_position: "RF",
      runner_advances: [{ from: "batter", to: "second", player_id: OPP_ABOWMAN_R6 }],
    })));
    // (2) Carlisle F8 to CF; A Bowman stays
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "bottom",
      result: "FO",
      fielder_position: "CF",
    })));
    // (3) Johnson 6-3 GO; A Bowman to 3rd. NOTE: silent-zero-outs trap.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "bottom",
      result: "GO",
      fielder_position: "SS",
      runner_advances: [
        { from: "batter", to: "out",   player_id: "opp_johnson_r6" },
        { from: "second", to: "third", player_id: OPP_ABOWMAN_R6 },
      ],
    })));
    // (4) B Bowman 4-3 GO → 3rd out. Game over.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "bottom",
      result: "GO",
      fielder_position: "2B",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 6, half: "bottom" }));
    // Run-rule: game ends after Bot 6th. No Top/Bot 7th.
    events.push(evt("game_finalized", {}));

    // -----------------------------------------------------------------------
    // REPLAY + ASSERTIONS
    // -----------------------------------------------------------------------
    const state = replay(events);

    // Final score per truth oracle: STRK 14, ESTR 1 (run-rule).
    expect(state.team_score, "STRK 14 final").toBe(14);
    expect(state.opponent_score, "ESTR 1 final").toBe(1);
    expect(state.status).toBe("final");
    // After Bot 6th `inning_end`, the engine advances bookkeeping to the
    // next half (Top 7th). `game_finalized` flips status to "final" but does
    // not roll the inning back. State reflects "next half that would have
    // started had play continued."
    expect(state.inning).toBe(7);
    expect(state.half).toBe("top");

    // Per-half cumulative score progression at each inning_end.
    const cum = computeCumulativeScores(events);
    // STRK (top) accumulates: 1, 2, 6, 8, 10, 14 = 14 total.
    // ESTR (bottom): 0, 0, 0, 1, 1, 1 = 1 total.
    expect(cum["1_top"]).toEqual({ team: 1, opp: 0 });
    expect(cum["1_bottom"]).toEqual({ team: 1, opp: 0 });
    expect(cum["2_top"]).toEqual({ team: 2, opp: 0 });
    expect(cum["2_bottom"]).toEqual({ team: 2, opp: 0 });
    expect(cum["3_top"]).toEqual({ team: 6, opp: 0 });
    expect(cum["3_bottom"]).toEqual({ team: 6, opp: 0 });
    expect(cum["4_top"]).toEqual({ team: 8, opp: 0 });
    expect(cum["4_bottom"]).toEqual({ team: 8, opp: 1 });
    expect(cum["5_top"]).toEqual({ team: 10, opp: 1 });
    expect(cum["5_bottom"]).toEqual({ team: 10, opp: 1 });
    expect(cum["6_top"]).toEqual({ team: 14, opp: 1 });
    expect(cum["6_bottom"]).toEqual({ team: 14, opp: 1 });

    // Outs-per-half checks. Top 1st ends on a basepath out (Templeton appeal,
    // encoded as a pickoff at 3rd). Top 4th ends on a CS @ home. So:
    //   - 1_top: 2 AB outs + 1 pickoff out = 3
    //   - 4_top: 2 AB outs + 1 CS out      = 3
    const halves: Array<[number, "top" | "bottom", number]> = [
      [1, "top", 3], [1, "bottom", 3],
      [2, "top", 3], [2, "bottom", 3],
      [3, "top", 3], [3, "bottom", 3],
      [4, "top", 3], [4, "bottom", 3],
      [5, "top", 3], [5, "bottom", 3],
      [6, "top", 3], [6, "bottom", 3],
    ];
    for (const [inning, half, expectedOuts] of halves) {
      const abOuts = state.at_bats
        .filter((ab) => ab.inning === inning && ab.half === half)
        .reduce((sum, ab) => sum + ab.outs_recorded, 0);
      // Non-PA basepath outs: Top 1st pickoff (Templeton appeal); Bot 2nd
      // pickoff (Johnson); Top 4th CS (Berkery @ home).
      let nonPaOuts = 0;
      if (inning === 1 && half === "top")    nonPaOuts += 1; // Templeton appeal as PO
      if (inning === 2 && half === "bottom") nonPaOuts += 1; // Johnson PO by C
      if (inning === 4 && half === "top")    nonPaOuts += 1; // Berkery CS @ home
      expect(abOuts + nonPaOuts, `${inning}_${half} outs`).toBe(expectedOuts);
    }

    // ---------- Edge-case spot checks ----------

    // (1) Top 1st Templeton appeal (encoded as pickoff at 3rd).
    const templetonAppealPo = state.pickoffs.filter(
      (po) => po.runner_id === P_TEMPLETON,
    );
    expect(templetonAppealPo.length, "Templeton appeal as pickoff @ 3rd").toBe(1);

    // (2) Top 2nd Portera SAC bunt — 1 out, 0 RBI.
    const porteraSac = state.at_bats.find(
      (ab) => ab.batter_id === P_PORTERA && ab.inning === 2 && ab.half === "top",
    )!;
    expect(porteraSac.result).toBe("SAC");
    expect(porteraSac.outs_recorded, "SAC = 1 out").toBe(1);
    expect(porteraSac.rbi, "SAC bunt for advance, no RBI").toBe(0);

    // (3) Top 3rd Portera 1B + 2 RBI + advance to 2nd on the throw, no error.
    const portera1b3 = state.at_bats.find(
      (ab) => ab.batter_id === P_PORTERA && ab.inning === 3 && ab.half === "top",
    )!;
    expect(portera1b3.result).toBe("1B");
    expect(portera1b3.rbi, "Portera 1B with 2 RBI").toBe(2);
    expect(portera1b3.runs_scored_on_play, "Buckner+Berkery score").toBe(2);

    // (4) Bot 2nd Johnson picked off 1st by catcher.
    const johnsonPo = state.pickoffs.filter(
      (po) => po.runner_id === OPP_JOHNSON_R2,
    );
    expect(johnsonPo.length, "Johnson picked off 1st by C").toBe(1);

    // (5) Top 4th Berkery CS @ home. NOTE: engine's state.caught_stealing
    // entries don't preserve `from` (only runner_id, event_id, catcher_id).
    // The "@ home" attribution is implicitly carried by the source-payload
    // `from: "third"` we emitted. Severity: LOSSY (CS-at-home vs CS-at-2nd
    // can't be distinguished by replaying the rollup).
    const berkeryCs = state.caught_stealing.filter(
      (cs) => cs.runner_id === P_BERKERY,
    );
    expect(berkeryCs.length, "Berkery CS in Top 4th (encoded @ home)").toBe(1);

    // (6) Top 4th Buckner SF — 1 out, 1 RBI, 1 run scored.
    const bucknerSf = state.at_bats.find(
      (ab) => ab.batter_id === P_BUCKNER && ab.inning === 4 && ab.half === "top",
    )!;
    expect(bucknerSf.result).toBe("SF");
    expect(bucknerSf.outs_recorded).toBe(1);
    expect(bucknerSf.runs_scored_on_play, "Templeton scored on Buckner SF").toBe(1);

    // (7) Top 6th Couvillion SF after double-steal — 1 out, 1 RBI, 1 run.
    const couvSf = state.at_bats.find(
      (ab) => ab.batter_id === P_COUVILLION && ab.inning === 6 && ab.half === "top",
    )!;
    expect(couvSf.result).toBe("SF");
    expect(couvSf.outs_recorded).toBe(1);
    expect(couvSf.runs_scored_on_play, "Johnson scored on Couvillion SF").toBe(1);

    // (8) Top 6th Mullins 1B + own-run on E7. The AB itself scores 1 run
    //     (Knight); the error_advance scores Mullins's run separately.
    const mullins1b6 = state.at_bats.find(
      (ab) => ab.batter_id === P_MULLINS && ab.inning === 6 && ab.half === "top"
        && ab.result === "1B",
    )!;
    expect(mullins1b6.result).toBe("1B");
    expect(mullins1b6.rbi, "Mullins gets 1 RBI for Knight only").toBe(1);
    expect(mullins1b6.runs_scored_on_play, "Knight scored on the hit").toBe(1);

    // (9) ESTR's only run — Johnson HR Bot 4th.
    const oppJohnsonHr = state.at_bats.find(
      (ab) => ab.inning === 4 && ab.half === "bottom" && ab.result === "HR",
    )!;
    expect(oppJohnsonHr.runs_scored_on_play, "ESTR Johnson solo HR").toBe(1);

    // (10) Top 3rd Little HR — solo (no runners on).
    const littleHr = state.at_bats.find(
      (ab) => ab.batter_id === P_LITTLE && ab.inning === 3 && ab.half === "top"
        && ab.result === "HR",
    )!;
    expect(littleHr.runs_scored_on_play, "Little solo HR").toBe(1);
    expect(littleHr.rbi).toBe(1);

    // (11) STRK hits — count batting-side at_bats with hit results.
    const HIT_RESULTS = ["1B", "2B", "3B", "HR"] as const;
    type HitResult = typeof HIT_RESULTS[number];
    const strkHits = state.at_bats.filter((ab) => {
      const ourHalf = ab.half === "top"; // we're visitor
      return ourHalf && (HIT_RESULTS as readonly string[]).includes(ab.result);
    }).length;
    // STRK hits in play log:
    //   Top 1: Mullins 1B + Templeton 1B + Buckner 2B = 3
    //   Top 2: Johnson 2B + Couvillion 1B = 2
    //   Top 3: Little HR + Templeton 1B + Berkery 1B + Buckner 1B + Portera 1B = 5
    //   Top 4: Templeton 2B + Berkery 1B = 2
    //   Top 5: Knight 1B + Templeton 1B + Berkery 1B = 3
    //   Top 6: Knight 1B + Mullins 1B + Templeton 2B = 3
    //   Total: 3+2+5+2+3+3 = 18
    expect(strkHits, "STRK 18 hits across game").toBe(18);

    // (12) ESTR hits: Bot 2 Carlisle 1B + Johnson 1B + Bankston 1B = 3.
    //      Bot 3 Tillman 1B = 1.
    //      Bot 4 Johnson HR = 1.
    //      Bot 5 McGee 1B = 1.
    //      Bot 6 A Bowman 2B = 1.
    //      Total: 3+1+1+1+1 = 7
    const estrHits = state.at_bats.filter((ab) => {
      const oppHalf = ab.half === "bottom";
      return oppHalf && (HIT_RESULTS as readonly string[]).includes(ab.result as HitResult);
    }).length;
    expect(estrHits, "ESTR 7 hits across game").toBe(7);

    // (13) non_pa_runs: when STRK is FIELDING (Bot innings) any WP/PB/error/balk
    //      runs charge to Burkley. Only the WP in Bot 1st advanced a runner —
    //      no run scored (Ingram 1→2). No non_pa_runs entries.
    expect(state.non_pa_runs, "Burkley charged no non-PA runs").toEqual([]);
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
