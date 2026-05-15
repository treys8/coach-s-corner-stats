// Real-game regression fixture #3: STRK (home) vs Heritage Academy (HRTG)
// 2026-05-15. Game 4 in the four-game replay-fixture initiative.
//
// Final: STRK 3, HRTG 1 — pitcher's duel ending Top 7th (no Bot 7th because
// STRK leads after Top 7th).
//
// Line score truth oracle:
//   HRTG (away)  1 0 0 0 0 0 0 — 1
//   STRK (home)  0 0 0 3 0 0 X — 3   (no Bot 7th played)
//
// High-priority edge cases this fixture probes (engine punch-list candidates,
// see memory replay_fixture_initiative §"Game 4"):
//   AA. Outfielder-to-catcher assist (7-2 / 9-2) gunning runner out at home on
//       a single. TWO instances (Top 1st McCrary, Bot 5th Mullins).
//   BB. Single + same batter out advancing on the same play (Top 2nd C Long
//       1B w/ 8-6 out at 2nd).
//   CC. Single passed ball advancing TWO runners on same pitch (Top 3rd
//       Tate 2→3 + Fowler 1→2).
//   DD. Mid-PA E1 scoring R2 and advancing R1 on same play (Bot 4th, on
//       Couvillion's K).
//   EE. Stacked-events PA: SB + advance-on-throw + WP scoring + WP advance
//       + 1B + RBI (Bot 4th, Templeton's AB) — most complex single PA seen.
//   FF. Defensive indifference vs SB attribution on trail runner (Bot 4th,
//       Little 1→2 when Mullins steals 3rd).
//   GG. Batter reaches AND advances to 2nd on the same error (Bot 6th,
//       Templeton on E6 — 2-base error scoring).
//   HH. Game ends after Top 7th with home team leading; no Bot 7th.
//
// Plus recurring patterns from earlier games:
//   - CS mid-PA + K = 2 outs in 1 PA (Bot 6th, Johnson K-looking with mid-PA
//     Templeton CS 3rd).
//   - Mid-game OUR pitching change (Top 5th, J Northcutt for B Burkley).
//
// Encoding gaps and engine divergence comments are inline as `// NOTE:` /
// `// PUNCH LIST:`.

import { describe, expect, it } from "vitest";
import { replay } from "./replay";
import type {
  AtBatPayload,
  CaughtStealingPayload,
  GameEventRecord,
  GameStartedPayload,
  InningEndPayload,
  PitchingChangePayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "./types";

// STRK lineup (home this game). Same nine as Games 1 & 3.
const P_MULLINS = "p_mullins";
const P_LITTLE = "p_little";
const P_TEMPLETON = "p_templeton";
const P_BERKERY = "p_berkery";
const P_BUCKNER = "p_buckner";
const P_JOHNSON = "p_johnson";
const P_PORTERA = "p_portera";
const P_COUVILLION = "p_couvillion";
const P_KNIGHT = "p_knight";

// STRK pitchers
const P_BURKLEY = "p_burkley";    // starter; pitches through Top 4th
const P_NORTHCUTT = "p_northcutt"; // relief, in at Top 5th, finishes the game

// HRTG identities
const OPP_LONG = "opp_long";       // HRTG complete-game pitcher
// Opaque opp-batter / opp-runner ids — namespaced by inning when the same
// "name" reaches base in multiple PAs of the same game so we never collide
// across innings. (Game 3 used same pattern.)
const OPP_CLARK_R1 = "opp_clark_r1";       // Top 1st 1B
const OPP_FOWLER_R1 = "opp_fowler_r1";     // Top 1st 1B (later out at home)
const OPP_MCCRARY_R1 = "opp_mccrary_r1";   // Top 1st 1B + RBI
const OPP_TATE_R3 = "opp_tate_r3";         // Top 3rd 1B
const OPP_FOWLER_R3 = "opp_fowler_r3";     // Top 3rd HBP

let seq = 0;
function evt<P>(type: GameEventRecord["event_type"], payload: P): GameEventRecord {
  seq += 1;
  return {
    id: `e${seq}`,
    game_id: "g_strk_hrtg_20260515",
    client_event_id: `c${seq}`,
    sequence_number: seq,
    event_type: type,
    payload: payload as unknown as GameEventRecord["payload"],
    supersedes_event_id: null,
    created_at: new Date(2026, 4, 15, 19, seq).toISOString(),
  };
}

// STRK PA: we're home → "bottom" half.
const atBat = (p: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "bottom",
  batter_id: null,
  pitcher_id: null,
  opponent_pitcher_id: OPP_LONG,
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

// HRTG PA: they're visitor → "top" half. Our pitcher on the mound.
const oppAtBat = (p: Partial<AtBatPayload>): AtBatPayload => ({
  inning: 1,
  half: "top",
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

const HRTG_LINEUP = Array.from({ length: 9 }, (_, i) => ({
  batting_order: i + 1,
  opponent_player_id: null,
  jersey_number: null,
  last_name: `hrtg_${i + 1}`,
  position: null,
  is_dh: false,
}));

function startGame(): GameEventRecord {
  return evt<GameStartedPayload>("game_started", {
    we_are_home: true, // STRK is HOME
    use_dh: true,
    starting_lineup: STRK_LINEUP,
    starting_pitcher_id: P_BURKLEY,
    opponent_starting_pitcher_id: OPP_LONG,
    opposing_lineup: HRTG_LINEUP,
    opponent_use_dh: false,
  });
}

// ============================================================================

describe("STRK (home) vs HRTG 2026-05-15 — Game 4 pitcher's duel fixture", () => {
  it("reproduces the end state of the 3-1 win ending Top 7th", () => {
    seq = 0;
    const events: GameEventRecord[] = [];
    events.push(startGame());

    // -----------------------------------------------------------------------
    // TOP 1ST — HRTG 1 (we field). B Burkley on mound.
    // -----------------------------------------------------------------------
    // (1) Clark 1B GB to LF
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "top",
      result: "1B",
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_CLARK_R1 }],
    })));
    // Mid-Tate SB: Clark 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: OPP_CLARK_R1, from: "first", to: "second",
    }));
    // (2) Tate 5-3 GO (Clark held at 2nd)
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "top",
      result: "GO",
      fielder_position: "3B",
    })));
    // (3) Fowler 1B GB to 3B Knight — Clark to 3rd. NOTE: encoded as 1B to RF
    // for advancement clarity; play log says "1B GB to 3B Knight" which is
    // an infield single. Use fielder_position 3B; Clark 2→3.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "top",
      result: "1B",
      fielder_position: "3B",
      runner_advances: [
        { from: "second", to: "third", player_id: OPP_CLARK_R1 },
        { from: "batter", to: "first", player_id: OPP_FOWLER_R1 },
      ],
    })));
    // Mid-McCrary SB: Fowler 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: OPP_FOWLER_R1, from: "first", to: "second",
    }));
    // (4) McCrary 1B GB; LF Little → C Mullins (7-2 putout) — Clark scores,
    // Fowler GUNNED OUT advancing to home on the throw. HRTG 1-0.
    // PUNCH LIST (AA, LOSSY): the 7-2 outfielder-to-catcher assist chain
    // is lost — engine only sees `fielder_position: "LF"` for the hit and a
    // {from: "second", to: "out"} advance for the trail runner. The exact
    // fielder chain (Little → Mullins for the putout at home) is dropped.
    // Batter's 1B + 1 RBI credit IS preserved.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "top",
      result: "1B",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [
        { from: "third",  to: "home",  player_id: OPP_CLARK_R1 },
        { from: "second", to: "out",   player_id: OPP_FOWLER_R1 }, // out at home
        { from: "batter", to: "first", player_id: OPP_MCCRARY_R1 },
      ],
    })));
    // Mid-Weeks SB: McCrary 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: OPP_MCCRARY_R1, from: "first", to: "second",
    }));
    // (5) Weeks line out to SS → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 1, half: "top",
      result: "LO",
      fielder_position: "SS",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 1, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 1ST — STRK 0
    // -----------------------------------------------------------------------
    // (1) Mullins line out to CF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 1, half: "bottom",
      batter_id: P_MULLINS, batting_order: 1,
      result: "LO",
      fielder_position: "CF",
    })));
    // (2) Berkery K-swinging
    // NOTE: play log shows order in Bot 1st as Mullins / Berkery / Little — that
    // matches the actual scorecard ordering for this game, not the canonical
    // 1-2-3 lineup. We mirror exactly what the play log captured.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 1, half: "bottom",
      batter_id: P_BERKERY, batting_order: 4,
      result: "K_swinging",
    })));
    // (3) Little K-swinging → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 1, half: "bottom",
      batter_id: P_LITTLE, batting_order: 2,
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 1, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 2ND — HRTG 0
    // -----------------------------------------------------------------------
    // (1) C Long 1B line drive to CF — Portera → Berkery; Long out advancing
    //     to 2nd. PUNCH LIST (BB, NEW): single + same-batter out on same play.
    //     Result stays "1B" (hit credit preserved); enumerate {batter, out}.
    //     Engine's `applyAtBat` default-out logic is bypassed by enumeration:
    //     we expect outs_recorded = 1 and result = "1B".
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "top",
      result: "1B",
      fielder_position: "CF",
      runner_advances: [
        // Batter reaches AND is out — same player_id, batter→out tells the
        // engine to record the 1 out without flipping the result off "1B".
        { from: "batter", to: "out", player_id: OPP_LONG },
      ],
    })));
    // (2) Elliott F8
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "top",
      result: "FO",
      fielder_position: "CF",
    })));
    // (3) Gaskin 6-3 GO → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 2, half: "top",
      result: "GO",
      fielder_position: "SS",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 2, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 2ND — STRK 0
    // -----------------------------------------------------------------------
    // (1) Templeton 6-3 GO
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "bottom",
      batter_id: P_TEMPLETON, batting_order: 3,
      result: "GO",
      fielder_position: "SS",
    })));
    // (2) Buckner K-swinging
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "bottom",
      batter_id: P_BUCKNER, batting_order: 5,
      result: "K_swinging",
    })));
    // (3) Johnson line out to RF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 2, half: "bottom",
      batter_id: P_JOHNSON, batting_order: 6,
      result: "LO",
      fielder_position: "RF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 2, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 3RD — HRTG 0
    // -----------------------------------------------------------------------
    // (1) Dove 4-3 GO
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "GO",
      fielder_position: "2B",
    })));
    // (2) Clark K-swinging
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "K_swinging",
    })));
    // (3) Tate 1B to LF
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "1B",
      fielder_position: "LF",
      runner_advances: [{ from: "batter", to: "first", player_id: OPP_TATE_R3 }],
    })));
    // (4) Fowler HBP — Tate forced to 2nd
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "HBP",
      runner_advances: [
        { from: "first",  to: "second", player_id: OPP_TATE_R3 },
        { from: "batter", to: "first",  player_id: OPP_FOWLER_R3 },
      ],
    })));
    // Mid-McCrary PB: Tate 2→3 + Fowler 1→2 on one pitch.
    // PUNCH LIST (CC, working): single PB advancing TWO runners — should
    // work cleanly since RunnerMovePayload.advances accepts multiple entries.
    events.push(evt<RunnerMovePayload>("passed_ball", {
      advances: [
        { from: "second", to: "third",  player_id: OPP_TATE_R3 },
        { from: "first",  to: "second", player_id: OPP_FOWLER_R3 },
      ],
    }));
    // (5) McCrary F7 → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 3, half: "top",
      result: "FO",
      fielder_position: "LF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 3, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 3RD — STRK 0
    // -----------------------------------------------------------------------
    // (1) Couvillion line out to LF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_COUVILLION, batting_order: 8,
      result: "LO",
      fielder_position: "LF",
    })));
    // (2) Knight K-swinging
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_KNIGHT, batting_order: 9,
      result: "K_swinging",
    })));
    // (3) Portera F9 → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 3, half: "bottom",
      batter_id: P_PORTERA, batting_order: 7,
      result: "FO",
      fielder_position: "RF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 3, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 4TH — HRTG 0
    // -----------------------------------------------------------------------
    // (1) Weeks F8
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "top",
      result: "FO",
      fielder_position: "CF",
    })));
    // (2) C Long F7
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "top",
      result: "FO",
      fielder_position: "LF",
    })));
    // (3) Elliott F9 → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 4, half: "top",
      result: "FO",
      fielder_position: "RF",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 4, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 4TH — STRK 3 (the only STRK runs of the game)
    // -----------------------------------------------------------------------
    // (1) Mullins 1B line drive to RF
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_MULLINS, batting_order: 1,
      result: "1B",
      fielder_position: "RF",
      runner_advances: [{ from: "batter", to: "first", player_id: P_MULLINS }],
    })));
    // (2) Berkery F8 (Mullins stays)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_BERKERY, batting_order: 4,
      result: "FO",
      fielder_position: "CF",
    })));
    // (3) Little BB; Mullins forced to 2nd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_LITTLE, batting_order: 2,
      result: "BB",
      runner_advances: [
        { from: "first",  to: "second", player_id: P_MULLINS },
        { from: "batter", to: "first",  player_id: P_LITTLE },
      ],
    })));
    // (4) Templeton's PA — STACKED EVENTS (PUNCH LIST EE).
    // Play log sequence:
    //   a. Mullins SB 3rd (Little "advances to 2nd on the steal" — defensive
    //      indifference / advance-on-throw, NO SB credit per GC).
    //   b. (Foul, Ball 2)
    //   c. WP — Mullins scores from 3rd, Little 2→3 on same pitch.
    //   d. (Ball 3)
    //   e. In play: Templeton 1B to LF, Little scores. STRK 2-1.
    //
    // Encoding: emit each mid-PA event discretely, then the at_bat.
    //   1. stolen_base (Mullins 1→3) — full extra-base steal (GC scored 3rd
    //      as the SB destination; Little's advance on the throw isn't a SB).
    //   2. advance_on_throw for Little 1→2 — judgment-call advance with no
    //      error charged. Engine treats it as earned, no taint, no fielder
    //      error attribution. (Previously encoded as `error_advance` with
    //      an attribution_label; punch list #3 fixed this.)
    //   3. wild_pitch (Mullins 3→home, Little 2→3 on same pitch).
    //   4. at_bat 1B — Little 3→home, batter to 1st.
    //
    // Resulting STRK runs: Mullins via WP + Little via 1B = 2 runs in this PA.
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_MULLINS, from: "second", to: "third",
    }));
    events.push(evt<RunnerMovePayload>("advance_on_throw", {
      advances: [{ from: "first", to: "second", player_id: P_LITTLE }],
      attribution_label: "Advanced on the throw",
    }));
    // Foul/Ball pitches in between — we don't model individual count pitches
    // in this fixture (no `pitch` events emitted).
    events.push(evt<RunnerMovePayload>("wild_pitch", {
      advances: [
        { from: "third",  to: "home",  player_id: P_MULLINS },
        { from: "second", to: "third", player_id: P_LITTLE },
      ],
    }));
    // Templeton 1B; Little scores. STRK 2-1.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_TEMPLETON, batting_order: 3,
      result: "1B",
      rbi: 1,
      fielder_position: "LF",
      runner_advances: [
        { from: "third",  to: "home",  player_id: P_LITTLE },
        { from: "batter", to: "first", player_id: P_TEMPLETON },
      ],
    })));
    // (5) Buckner F8 (Templeton stays at 1st)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_BUCKNER, batting_order: 5,
      result: "FO",
      fielder_position: "CF",
    })));
    // (6) Johnson 1B GB to LF; Templeton to 2nd
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_JOHNSON, batting_order: 6,
      result: "1B",
      fielder_position: "LF",
      runner_advances: [
        { from: "first",  to: "second", player_id: P_TEMPLETON },
        { from: "batter", to: "first",  player_id: P_JOHNSON },
      ],
    })));
    // Mid-Couvillion E1 by Long — Templeton scores from 2nd, Johnson 1→2 on
    // the SAME error. PUNCH LIST (DD): mid-PA error_advance scoring R2 and
    // advancing R1. Engine should accept; verify the run lands as
    // non_pa_runs (since we're fielding side of the run — actually we are
    // BATTING here, so non_pa_runs entry should NOT appear; the engine only
    // logs non_pa_runs when WE are fielding).
    events.push(evt<RunnerMovePayload>("error_advance", {
      advances: [
        { from: "second", to: "home",   player_id: P_TEMPLETON },
        { from: "first",  to: "second", player_id: P_JOHNSON },
      ],
      error_fielder_position: "P",
      error_type: "fielding",
    }));
    // (7) Couvillion K-swinging → 3rd out. STRK 3-1.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 4, half: "bottom",
      batter_id: P_COUVILLION, batting_order: 8,
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 4, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 5TH — HRTG 0. J Northcutt comes in for B Burkley.
    // -----------------------------------------------------------------------
    events.push(evt<PitchingChangePayload>("pitching_change", {
      out_pitcher_id: P_BURKLEY,
      in_pitcher_id: P_NORTHCUTT,
    }));
    // (1) Gaskin K-looking (vs Burkley per play log)
    // NOTE: play log narrates "P Gaskin K-looking" first, then Dove F7, then
    // "J Northcutt in for B Burkley" before Clark K. Reading carefully:
    // the Northcutt swap-in announcement appears in the play log between
    // Dove and Clark. We emit pitching_change BEFORE the half-inning at
    // first PA to simplify; the at_bats below use the correct pitcher.
    //
    // RECONCILIATION: per play log the swap is mid-half (after Dove). We
    // honor that order — re-encode below with the pitching_change between
    // Dove and Clark.

    // Reset our quick-fix: encode the half in order — Gaskin/Dove vs
    // Burkley, then pitching_change, then Clark vs Northcutt.
    // Since we already emitted pitching_change above, we need to UNDO that
    // and re-emit at the right point. But we can't pop from a fluent push
    // sequence cleanly — instead, we MOVE the pitching_change to its proper
    // place by removing the prior push.
    events.pop(); // remove the early pitching_change

    // (1') Gaskin K-looking — vs Burkley
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      pitcher_id: P_BURKLEY,
      result: "K_looking",
    })));
    // (2) Dove F7 — vs Burkley
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      pitcher_id: P_BURKLEY,
      result: "FO",
      fielder_position: "LF",
    })));
    // Pitching change: Burkley → Northcutt
    events.push(evt<PitchingChangePayload>("pitching_change", {
      out_pitcher_id: P_BURKLEY,
      in_pitcher_id: P_NORTHCUTT,
    }));
    // (3) Clark K-looking — vs Northcutt → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 5, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "K_looking",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 5, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 5TH — STRK 0
    // -----------------------------------------------------------------------
    // (1) Knight F8
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_KNIGHT, batting_order: 9,
      result: "FO",
      fielder_position: "CF",
    })));
    // (2) Portera 1B bunt to P
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_PORTERA, batting_order: 7,
      result: "1B",
      fielder_position: "P",
      runner_advances: [{ from: "batter", to: "first", player_id: P_PORTERA }],
    })));
    // Mid-Mullins SB: Portera 1→2
    events.push(evt<StolenBasePayload>("stolen_base", {
      runner_id: P_PORTERA, from: "first", to: "second",
    }));
    // (3) Mullins 1B line drive; RF McCrary → C Fowler (9-2 putout):
    // Portera GUNNED OUT advancing to home from 2nd; Mullins to 2nd on the
    // throw. Hit credit preserved (1B). Batter advances to 2nd on the throw.
    // PUNCH LIST (AA, LOSSY) — same 9-2 chain attribution loss as Top 1st.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_MULLINS, batting_order: 1,
      result: "1B",
      fielder_position: "RF",
      runner_advances: [
        { from: "second", to: "out",    player_id: P_PORTERA },  // out at home
        { from: "batter", to: "second", player_id: P_MULLINS },  // takes 2nd on the throw
      ],
    })));
    // (4) Berkery BB; Mullins stays at 2nd (not forced; 1st was open)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_BERKERY, batting_order: 4,
      result: "BB",
      runner_advances: [{ from: "batter", to: "first", player_id: P_BERKERY }],
    })));
    // (5) Little K-looking → 3rd out
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 5, half: "bottom",
      batter_id: P_LITTLE, batting_order: 2,
      result: "K_looking",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 5, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 6TH — HRTG 0
    // -----------------------------------------------------------------------
    // (1) Tate K-looking
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "K_looking",
    })));
    // (2) Fowler line out to 2B
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "LO",
      fielder_position: "2B",
    })));
    // (3) McCrary K-swinging → 3rd out
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 6, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "K_swinging",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 6, half: "top" }));

    // -----------------------------------------------------------------------
    // BOT 6TH — STRK 0
    // -----------------------------------------------------------------------
    // (1) Templeton ROE on E6 (Tate); batter advances to 2nd on the same
    // error. PUNCH LIST (GG, NEW): 2-base error. Stat: ROE (result "E"),
    // batter takes 2nd. Enumerate {batter, second}.
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "bottom",
      batter_id: P_TEMPLETON, batting_order: 3,
      result: "E",
      fielder_position: "SS",
      runner_advances: [{ from: "batter", to: "second", player_id: P_TEMPLETON }],
    })));
    // (2) Buckner K-swinging (Templeton stays at 2nd)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "bottom",
      batter_id: P_BUCKNER, batting_order: 5,
      result: "K_swinging",
    })));
    // Mid-Johnson CS: Templeton CS 3rd (C Fowler → 3B Weeks)
    events.push(evt<CaughtStealingPayload>("caught_stealing", {
      runner_id: P_TEMPLETON, from: "second",
    }));
    // (3) Johnson K-looking → 3rd out (recurring pattern: CS + K = 2 outs)
    events.push(evt<AtBatPayload>("at_bat", atBat({
      inning: 6, half: "bottom",
      batter_id: P_JOHNSON, batting_order: 6,
      result: "K_looking",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 6, half: "bottom" }));

    // -----------------------------------------------------------------------
    // TOP 7TH — HRTG 0 (final defensive frame)
    // -----------------------------------------------------------------------
    // (1) Weeks F7
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "FO",
      fielder_position: "LF",
    })));
    // (2) C Long 1-1 GO to P (pitcher-to-1B). Pitcher fielded, threw to 1B.
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "GO",
      fielder_position: "P",
    })));
    // (3) Elliott 6-3 GO → 3rd out. GAME OVER (no Bot 7th).
    events.push(evt<AtBatPayload>("at_bat", oppAtBat({
      inning: 7, half: "top",
      pitcher_id: P_NORTHCUTT,
      result: "GO",
      fielder_position: "SS",
    })));
    events.push(evt<InningEndPayload>("inning_end", { inning: 7, half: "top" }));

    // No Bot 7th — STRK leads after Top 7th. Emit game_finalized to flip
    // status to "final". PUNCH LIST (HH): inning_end of Top 7th has already
    // advanced state to (7, bottom, 0 outs). game_finalized then sets status
    // = "final" without changing inning/half. Final reported state will be
    // (inning: 7, half: "bottom").
    events.push(evt("game_finalized", {}));

    // -----------------------------------------------------------------------
    // REPLAY + ASSERTIONS
    // -----------------------------------------------------------------------
    const state = replay(events);

    // Final score
    expect(state.team_score, "STRK 3 final").toBe(3);
    expect(state.opponent_score, "HRTG 1 final").toBe(1);
    expect(state.status, "Game finalized after Top 7th").toBe("final");
    expect(state.inning).toBe(7);
    // After Top 7th inning_end, state advances to (7, bottom, 0 outs).
    // game_finalized doesn't change inning/half.
    expect(state.half).toBe("bottom");

    // Per-half cumulative scores at every inning_end.
    const cum = computeCumulativeScores(events);
    expect(cum["1_top"]).toEqual({ team: 0, opp: 1 });
    expect(cum["1_bottom"]).toEqual({ team: 0, opp: 1 });
    expect(cum["2_top"]).toEqual({ team: 0, opp: 1 });
    expect(cum["2_bottom"]).toEqual({ team: 0, opp: 1 });
    expect(cum["3_top"]).toEqual({ team: 0, opp: 1 });
    expect(cum["3_bottom"]).toEqual({ team: 0, opp: 1 });
    expect(cum["4_top"]).toEqual({ team: 0, opp: 1 });
    expect(cum["4_bottom"]).toEqual({ team: 3, opp: 1 });
    expect(cum["5_top"]).toEqual({ team: 3, opp: 1 });
    expect(cum["5_bottom"]).toEqual({ team: 3, opp: 1 });
    expect(cum["6_top"]).toEqual({ team: 3, opp: 1 });
    expect(cum["6_bottom"]).toEqual({ team: 3, opp: 1 });
    expect(cum["7_top"]).toEqual({ team: 3, opp: 1 });
    // No 7_bottom — game ended after Top 7th.
    expect(cum["7_bottom"]).toBeUndefined();

    // Outs-per-half: every closed half should sum to 3.
    // Non-PA basepath outs: 1 CS in Bot 6th (Templeton).
    const halves: Array<[number, "top" | "bottom", number]> = [
      [1, "top", 3],
      [1, "bottom", 3],
      [2, "top", 3],
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
    ];
    for (const [inning, half, expectedOuts] of halves) {
      const abOuts = state.at_bats
        .filter((ab) => ab.inning === inning && ab.half === half)
        .reduce((sum, ab) => sum + ab.outs_recorded, 0);
      let nonPaOuts = 0;
      if (inning === 6 && half === "bottom") nonPaOuts += 1; // Templeton CS
      expect(abOuts + nonPaOuts, `${inning}_${half} outs`).toBe(expectedOuts);
    }

    // ---------- Edge-case spot checks ----------

    // (AA) Top 1st McCrary 1B: hit credit preserved despite Fowler out at
    // home. Result remains "1B"; outs_recorded = 1 (the trail-runner out).
    const mccrary1b = state.at_bats.find(
      (ab) => ab.inning === 1 && ab.half === "top" && ab.runner_advances.some(
        (ra) => ra.player_id === OPP_MCCRARY_R1 && ra.from === "batter",
      ),
    )!;
    expect(mccrary1b.result, "McCrary 1B (hit credit preserved)").toBe("1B");
    expect(mccrary1b.rbi, "1 RBI for Clark scoring").toBe(1);
    expect(mccrary1b.runs_scored_on_play, "Clark scores").toBe(1);
    expect(mccrary1b.outs_recorded, "Fowler out at home").toBe(1);

    // (BB) Top 2nd C Long 1B with same-batter out at 2nd. result="1B",
    // outs_recorded=1, runs_scored_on_play=0.
    const long1b = state.at_bats.find(
      (ab) => ab.inning === 2 && ab.half === "top" && ab.runner_advances.some(
        (ra) => ra.player_id === OPP_LONG && ra.to === "out",
      ),
    )!;
    expect(long1b.result, "Long 1B with same-play out (BB)").toBe("1B");
    expect(long1b.outs_recorded, "Long out at 2nd = 1 out").toBe(1);
    expect(long1b.runs_scored_on_play).toBe(0);

    // (CC) Top 3rd PB advancing TWO runners — engine accepts and the bases
    // configuration is correct (Tate 2→3, Fowler 1→2). Easiest assertion:
    // McCrary F7 ends inning with the bases state we'd expect — by the
    // time inning_end fires, all runners are cleared regardless. We assert
    // instead that the passed_balls log includes this event.
    const top3rdPb = state.passed_balls.length;
    expect(top3rdPb, "PB logged in Top 3rd").toBeGreaterThanOrEqual(1);

    // (DD) Bot 4th mid-PA E1: Templeton scores from 2nd, Johnson 1→2 on
    // same error_advance. This run happens while WE are batting, so it
    // should NOT appear in non_pa_runs (engine only logs there when we're
    // fielding). Verify the run still counted in team_score (already covered
    // by cum["4_bottom"]) but no non_pa_runs entry for source="error_advance".
    const errAdvNonPa = state.non_pa_runs.filter(
      (r) => r.source === "error_advance",
    );
    expect(errAdvNonPa.length, "Bot 4th E1 run not logged in non_pa_runs (we bat)").toBe(0);

    // (EE) Templeton's stacked-events PA Bot 4th — verify the 1B itself
    // scored 1 run (Little from 3rd), batter to 1st. The earlier WP that
    // scored Mullins is a separate event, not part of the PA.
    const templeton1b = state.at_bats.find(
      (ab) => ab.batter_id === P_TEMPLETON && ab.inning === 4 && ab.half === "bottom",
    )!;
    expect(templeton1b.result).toBe("1B");
    expect(templeton1b.rbi).toBe(1);
    expect(templeton1b.runs_scored_on_play, "Little scores on Templeton 1B").toBe(1);

    // Stolen base credit for Mullins (1→3) and a separate advance_on_throw
    // for Little. SB log should have an entry for Mullins.
    const mullinsSb = state.stolen_bases.filter((sb) => sb.runner_id === P_MULLINS);
    expect(mullinsSb.length, "Mullins SB credit in Bot 4th").toBeGreaterThanOrEqual(1);

    // (FF) Advance-on-throw for Little: encoded as the dedicated
    // advance_on_throw event (no SB credit, no error charged).
    const littleSb = state.stolen_bases.filter((sb) => sb.runner_id === P_LITTLE);
    // Little also has a separate SB elsewhere? Not in this game's play log,
    // so should be 0.
    expect(littleSb.length, "Little has no SB credit (advance on throw)").toBe(0);

    // (GG) Bot 6th Templeton ROE: result="E", outs_recorded=0, batter ends
    // at 2nd. We can't directly query "where is the batter after the PA"
    // from at_bats, but result + runner_advances is the source of truth.
    const templetonE = state.at_bats.find(
      (ab) => ab.batter_id === P_TEMPLETON && ab.inning === 6 && ab.half === "bottom",
    )!;
    expect(templetonE.result).toBe("E");
    expect(templetonE.outs_recorded).toBe(0);
    const batterAdvance = templetonE.runner_advances.find((ra) => ra.from === "batter");
    expect(batterAdvance?.to, "Templeton ends at 2nd on 2-base error").toBe("second");

    // CS mid-PA + K = 2 outs in 1 PA (Bot 6th Johnson). Engine should have
    // the CS recorded in caught_stealing and Johnson's K as 1 out.
    const johnsonK = state.at_bats.find(
      (ab) => ab.batter_id === P_JOHNSON && ab.inning === 6 && ab.half === "bottom",
    )!;
    expect(johnsonK.result).toBe("K_looking");
    expect(johnsonK.outs_recorded).toBe(1);
    const templetonCs = state.caught_stealing.filter((cs) => cs.runner_id === P_TEMPLETON);
    expect(templetonCs.length, "Templeton CS recorded").toBe(1);

    // OUR pitching change at Top 5th: state.current_pitcher_id should be
    // Northcutt by game end.
    expect(state.current_pitcher_id, "Northcutt finishes the game").toBe(P_NORTHCUTT);

    // STRK total hits — count batter PAs with hit result types in the bottom
    // half. STRK had: Bot 4th Mullins 1B, Templeton 1B, Johnson 1B; Bot 5th
    // Portera 1B, Mullins 1B = 5 hits total.
    const HIT_RESULTS = new Set(["1B", "2B", "3B", "HR"]);
    const strkHits = state.at_bats.filter(
      (ab) => ab.half === "bottom" && HIT_RESULTS.has(ab.result),
    ).length;
    expect(strkHits, "STRK should have 5 hits").toBe(5);

    // HRTG total hits — Top 1st had 3 hits (Clark 1B, Fowler 1B, McCrary 1B),
    // Top 2nd Long 1B, Top 3rd Tate 1B = 5 hits.
    const hrtgHits = state.at_bats.filter(
      (ab) => ab.half === "top" && HIT_RESULTS.has(ab.result),
    ).length;
    expect(hrtgHits, "HRTG should have 5 hits").toBe(5);

    // non_pa_runs: HRTG was top, we fielded — but the only HRTG run scored
    // via McCrary's 1B (an at_bat), NOT via WP/PB/balk/error_advance. So
    // non_pa_runs should be empty.
    expect(state.non_pa_runs.length, "No non_pa_runs (HRTG's run came via 1B)").toBe(0);
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
