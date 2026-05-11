// Event and state types for the live-scoring replay engine.
//
// Both the tablet (offline live state) and the server (canonical at_bats +
// game_live_state) reduce game_events through `replay()`. Payloads are
// versioned implicitly — Phase 1 ships these shapes; later phases extend
// without changing existing event types.

import type { GameEventType, InningHalf, GameStatus } from "@/integrations/supabase/types";

// ---- Outcomes --------------------------------------------------------------

export type AtBatResult =
  | "1B" | "2B" | "3B" | "HR"
  | "BB" | "IBB" | "HBP"
  | "K_swinging" | "K_looking"
  | "FO" | "GO" | "LO" | "PO" | "IF"
  | "FC" | "SAC" | "SF"
  | "E" | "DP" | "TP";

// Bases involved in a runner movement.
export type Base = "first" | "second" | "third";
export type RunnerSource = "batter" | Base;
export type RunnerDest = Base | "home" | "out";

export interface RunnerAdvance {
  from: RunnerSource;
  to: RunnerDest;
  player_id: string | null;
}

// ---- Event payloads --------------------------------------------------------

export interface LineupSlot {
  batting_order: number; // 1..9 (or null for the pitcher in non-DH? see design)
  player_id: string | null;
  position: string | null;
}

export interface GameStartedPayload {
  we_are_home: boolean;
  use_dh: boolean;
  starting_lineup: LineupSlot[];
  starting_pitcher_id: string | null;            // ours
  opponent_starting_pitcher_id: string | null;   // game_opponent_pitchers.id
}

export interface AtBatPayload {
  inning: number;
  half: InningHalf;
  batter_id: string | null;                 // null when opposing team is batting
  pitcher_id: string | null;                // our pitcher when fielding
  opponent_pitcher_id: string | null;       // opposing pitcher when batting
  batting_order: number | null;
  result: AtBatResult;
  rbi: number;
  pitch_count: number;
  balls: number;
  strikes: number;
  spray_x: number | null;
  spray_y: number | null;
  fielder_position: string | null;
  runner_advances: RunnerAdvance[];
  description: string | null;
}

// ---- Pitch event (GameChanger-style drill-down terminal selection) ---------
//
// Each tap on the pitch picker emits one `pitch` event. Most pitches (Ball,
// Called Strike, Swinging Strike, Foul) just advance the count. The terminal
// kind of a plate appearance (in_play / hbp / intentional_walk /
// catcher_interference / foul_tip_out / dropped_third_strike) carries the
// resolution data (result, spray, fielder, runner advances) and the replay
// engine emits a DerivedAtBat for that PA.
//
// The replay engine derives balls/strikes counts from the stream of pitch
// events for the current PA — the UI does not maintain them locally.

export type PitchKind =
  | "ball"
  | "called_strike"
  | "swinging_strike"
  | "foul"
  | "in_play"
  | "hbp"
  | "intentional_ball"
  | "intentional_walk"          // shortcut: skip remaining balls, resolve as IBB
  | "catcher_interference"      // batter awarded 1B
  | "illegal_pitch"             // ball + (advance baserunners — TODO)
  | "dropped_third_strike"
  | "foul_tip_out";             // foul tip caught for strike 3 = K_swinging

// Ball trajectory selected in the GC "Ball In Play" submenu. Captured so we
// can compute hard-hit %, line-drive rate, bunt success, etc. — richer than
// the FO/GO/LO/PO bucketing we had on AtBatResult.
export type PitchTrajectory =
  | "ground"
  | "hard_ground"
  | "fly"
  | "line"
  | "bunt"
  | "pop";

export interface PitchPayload {
  inning: number;
  half: InningHalf;
  batter_id: string | null;
  pitcher_id: string | null;
  opponent_pitcher_id: string | null;
  batting_order: number | null;
  kind: PitchKind;

  // In-play resolution. Only present when kind === "in_play". The result
  // reuses AtBatResult so the existing rollup logic keeps working.
  trajectory: PitchTrajectory | null;
  result: AtBatResult | null;
  spray_x: number | null;
  spray_y: number | null;
  fielder_position: string | null;
  runner_advances: RunnerAdvance[];
  rbi: number;

  description: string | null;
}

export interface SubstitutionPayload {
  out_player_id: string;
  in_player_id: string;
  batting_order: number;
  position: string | null;
  sub_type: "regular" | "pinch_hit" | "pinch_run" | "courtesy_run" | "re_entry";
}

export interface PitchingChangePayload {
  out_pitcher_id: string | null;
  in_pitcher_id: string | null;
}

export interface InningEndPayload {
  inning: number;
  half: InningHalf;
}

export type GameFinalizedPayload = Record<string, never>;

// Corrections carry the same shape as one of the other payloads, tagged with
// the event_id they're replacing. The replay engine skips the superseded
// event and applies this corrected payload in its place.
//
// `corrected_event_type` and `corrected_payload` may both be null for a
// "void" correction — the original event is superseded with no replacement.
// Used by un-finalize: the prior `game_finalized` event is skipped and
// nothing is applied in its place, so the game falls back to in_progress.
export interface CorrectionPayload {
  superseded_event_id: string;
  corrected_event_type: Exclude<GameEventType, "correction"> | null;
  corrected_payload: GameEventPayload | null;
}

export type GameEventPayload =
  | GameStartedPayload
  | AtBatPayload
  | PitchPayload
  | SubstitutionPayload
  | PitchingChangePayload
  | InningEndPayload
  | GameFinalizedPayload
  | CorrectionPayload;

// ---- Persisted shape used by the engine ------------------------------------

export interface GameEventRecord {
  id: string;
  game_id: string;
  client_event_id: string;
  sequence_number: number;
  event_type: GameEventType;
  payload: GameEventPayload;
  supersedes_event_id: string | null;
  created_at: string;
}

// ---- Reduced state ---------------------------------------------------------

export interface Bases {
  first: string | null;
  second: string | null;
  third: string | null;
}

export interface DerivedAtBat {
  event_id: string;
  inning: number;
  half: InningHalf;
  batting_order: number | null;
  batter_id: string | null;
  pitcher_id: string | null;
  opponent_pitcher_id: string | null;
  result: AtBatResult;
  rbi: number;
  pitch_count: number;
  balls: number;
  strikes: number;
  spray_x: number | null;
  spray_y: number | null;
  fielder_position: string | null;
  runs_scored_on_play: number;
  outs_recorded: number;
  /** Carried forward from the at-bat payload so the rollup can attribute
   *  R per scoring runner. Not persisted in the at_bats DB table. */
  runner_advances: RunnerAdvance[];
  description: string | null;
}

export interface ReplayState {
  status: GameStatus;
  we_are_home: boolean;
  use_dh: boolean;

  inning: number;
  half: InningHalf;
  outs: number;
  bases: Bases;
  team_score: number;        // ours
  opponent_score: number;    // theirs

  our_lineup: LineupSlot[];
  current_pitcher_id: string | null;
  current_opponent_pitcher_id: string | null;
  /** 1-based slot in our_lineup that's up next when we're batting. Null
   *  before game_started. Persists across half-innings since the order
   *  resumes where it left off. */
  current_batter_slot: number | null;

  // Pitch-by-pitch count for the current plate appearance. Reset to 0-0
  // each time a PA resolves (in_play, BB, K, HBP, etc.) or at inning_end.
  // Drives the live count display in the UI; the UI no longer maintains
  // its own balls/strikes state.
  balls: number;
  strikes: number;
  /** Number of pitches in the current PA. Reset alongside balls/strikes. */
  current_pa_pitches: number;

  last_play_text: string | null;
  last_event_at: string | null;

  at_bats: DerivedAtBat[];
}

export const EMPTY_BASES: Bases = { first: null, second: null, third: null };

export const INITIAL_STATE: ReplayState = {
  status: "draft",
  we_are_home: true,
  use_dh: true,
  inning: 1,
  half: "top",
  outs: 0,
  bases: { ...EMPTY_BASES },
  team_score: 0,
  opponent_score: 0,
  our_lineup: [],
  current_pitcher_id: null,
  current_opponent_pitcher_id: null,
  current_batter_slot: null,
  balls: 0,
  strikes: 0,
  current_pa_pitches: 0,
  last_play_text: null,
  last_event_at: null,
  at_bats: [],
};
