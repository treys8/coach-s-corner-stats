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
  | "E" | "DP" | "TP"
  | "CI";

// How the batter reached on an uncaught third strike (PDF §16, A.1).
// Pitcher still gets the K; batter is on first; downstream scoring
// classification depends on which: WP runs are earned, PB and E are
// unearned (PDF §17, §14).
export type K3ReachSource = "WP" | "PB" | "E";

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

// Defensive positions match diamond-geometry's FielderPosition. DH is
// omitted because the DH never fields; the fielding rollup keys off these
// nine slots only.
export type DefensivePosition =
  | "P" | "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF";

export interface DefensiveSlot {
  position: DefensivePosition;
  player_id: string | null;
}

export interface LineupSlot {
  batting_order: number; // 1..9 (or null for the pitcher in non-DH? see design)
  player_id: string | null;
  position: string | null;
  /** True for starting nine; preserved across subs so re-entry validation
   *  knows who's eligible (NFHS Rule 3-1-3: starters may re-enter once,
   *  to their original slot). The GameStartedPayload may omit this; the
   *  engine fills it on apply. Always present in `ReplayState.our_lineup`
   *  after game_started. */
  is_starter?: boolean;
  /** True after a starter has used their one re-entry. */
  re_entered?: boolean;
  /** Identity of the player who started in this batting slot. Stays
   *  pinned even when subs replace player_id, so re-entry can verify
   *  the returning starter is going back to their original slot. */
  original_player_id?: string | null;
}

export type LeagueType = "mlb" | "nfhs";

export interface GameStartedPayload {
  we_are_home: boolean;
  use_dh: boolean;
  starting_lineup: LineupSlot[];
  starting_pitcher_id: string | null;            // ours
  opponent_starting_pitcher_id: string | null;   // game_opponent_pitchers.id
  /** Optional: league rule set for NFHS-specific behaviors (courtesy
   *  runner, re-entry validation, defensive-conference rule, pitch-count
   *  rest days). Defaults to "mlb" if absent. Phase 5. */
  league_type?: LeagueType;
  /** Optional: state code (e.g., 'NY', 'CA') for state-specific pitch
   *  count rules when league_type === 'nfhs'. */
  nfhs_state?: string | null;
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
  /** Set when result is K_swinging/K_looking but the batter reached on
   *  an uncaught third strike (PDF §16). Pitcher still gets the K; batter
   *  is on first; the source determines whether downstream runs are
   *  earned (WP=earned, PB/E=unearned). */
  batter_reached_on_k3?: K3ReachSource;
}

export interface SubstitutionPayload {
  out_player_id: string;
  in_player_id: string;
  batting_order: number;
  position: string | null;
  sub_type: "regular" | "pinch_hit" | "pinch_run" | "courtesy_run" | "re_entry";
  /** For pinch_run / courtesy_run: which base the runner is on. The
   *  engine replaces the BaseRunner.player_id at this base while
   *  preserving pitcher_of_record_id and reached_on_error. */
  original_base?: Base;
}

export interface PitchingChangePayload {
  out_pitcher_id: string | null;
  in_pitcher_id: string | null;
}

// ---- Mid-PA running events (Phase B) ---------------------------------------

export interface StolenBasePayload {
  runner_id: string | null;
  from: Base;
  to: Base | "home";
}

export interface CaughtStealingPayload {
  runner_id: string | null;
  from: Base;
}

export interface PickoffPayload {
  runner_id: string | null;
  from: Base;
}

// Used for wild_pitch, passed_ball, balk, error_advance — UI provides an
// explicit advance plan because these can move multiple runners. Sources
// must be base names (no `batter`); destinations are bases / home / out.
export interface RunnerMovePayload {
  advances: RunnerAdvance[];
}

// ---- Per-pitch events (Phase E) -------------------------------------------

export type PitchType =
  | "ball"
  | "called_strike"
  | "swinging_strike"
  | "foul"
  | "in_play"
  | "hbp"
  | "foul_tip_caught"  // strike; records K when count is 2 strikes (PDF §4)
  | "pitchout"         // counts as a ball
  | "intentional_ball"; // counts as a ball; IBB-stream

export interface PitchPayload {
  pitch_type: PitchType;
  location_x?: number | null;
  location_y?: number | null;
}

export interface DefensiveConferencePayload {
  pitcher_id: string;
  inning: number;
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
  | SubstitutionPayload
  | PitchingChangePayload
  | InningEndPayload
  | GameFinalizedPayload
  | CorrectionPayload
  | StolenBasePayload
  | CaughtStealingPayload
  | PickoffPayload
  | RunnerMovePayload
  | PitchPayload
  | DefensiveConferencePayload;

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

// A runner on base, tagged with the pitcher who put them there. The
// `pitcher_of_record_id` travels with the runner across pitching changes
// and downstream advances, so when this runner eventually scores the
// rollup can credit the run to the correct pitcher (PDF §17, inherited
// runners). `reached_on_error` flags runners who reached on errors or
// passed balls — used by ER reconstruction in Phase 2 to identify
// error-fueled runs that survive in the unearned bucket.
export interface BaseRunner {
  player_id: string;
  pitcher_of_record_id: string | null;
  reached_on_error: boolean;
}

export interface Bases {
  first: BaseRunner | null;
  second: BaseRunner | null;
  third: BaseRunner | null;
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
  /** Pitcher of record from the offense's perspective at the moment this
   *  PA began. Used by the rollup so per-PA pitcher attribution doesn't
   *  depend on a separate event lookup. */
  pitcher_of_record_id: string | null;
  /** Snapshot of base occupants (with pitcher_of_record) BEFORE this PA
   *  started. Used by ER reconstruction to identify inherited runners
   *  and trace error-fueled scoring chains. */
  bases_before: Bases;
  description: string | null;
  /** Per-pitch trail captured during this PA (Phase E). In-memory only —
   *  the engine reconstitutes it from `pitch` events on every replay. */
  pitches: PitchPayload[];
  /** Set when batter reached on uncaught K3 (mirrors AtBatPayload). */
  batter_reached_on_k3?: K3ReachSource;
  /** Snapshot of who's playing each defensive position at the moment
   *  this PA started. The fielding rollup resolves `fielder_position`
   *  against this snapshot to credit the right player even when subs
   *  shifted the defense between innings. In-memory only. */
  defensive_lineup_snapshot: DefensiveSlot[];
  /** Runners stranded if this PA ended the half-inning (outs crossed
   *  from <3 to 3 on this play). Credited to the batter as LOB by the
   *  rollup. 0 when this play didn't end the half. */
  lob_on_play: number;
}

export interface ReplayState {
  status: GameStatus;
  we_are_home: boolean;
  use_dh: boolean;
  /** Rule set for NFHS-only behaviors. Defaults 'mlb'. Phase 5. */
  league_type: LeagueType;
  nfhs_state: string | null;

  inning: number;
  half: InningHalf;
  outs: number;
  bases: Bases;
  team_score: number;        // ours
  opponent_score: number;    // theirs

  our_lineup: LineupSlot[];
  /** Who's playing each defensive position right now. Set on
   *  game_started from the starting lineup; mutated on substitution
   *  events that carry a position and on pitching_change. Used by the
   *  fielding rollup to map `fielder_position` → player_id. */
  our_defensive_lineup: DefensiveSlot[];
  current_pitcher_id: string | null;
  current_opponent_pitcher_id: string | null;
  /** 1-based slot in our_lineup that's up next when we're batting. Null
   *  before game_started. Persists across half-innings since the order
   *  resumes where it left off. */
  current_batter_slot: number | null;

  last_play_text: string | null;
  last_event_at: string | null;

  at_bats: DerivedAtBat[];

  /** Live count for the current PA, derived from pitch events. Reset on
   *  at_bat / inning_end. (Phase E) */
  current_balls: number;
  current_strikes: number;
  /** Pitch trail accumulated during the current open PA. */
  current_pa_pitches: PitchPayload[];

  /** Non-PA running events (SB-home, WP, PB, balk, error_advance) that
   *  scored a run, paired with the pitcher of record at that moment.
   *  `source` lets the rollup distinguish earned-vs-unearned (PB runs
   *  are unearned; WP and balk are earned — PDF §14, §17). */
  non_pa_runs: NonPaRun[];

  /** Defensive conferences (mound visits) per pitcher per inning.
   *  NFHS Rule 3-4-1: 3 charged conferences per pitcher per game; 4th
   *  forces removal. PDF §28.9. The replay engine just tracks the log;
   *  the UI consults it for warnings and forced pitching changes. */
  defensive_conferences: { pitcher_id: string; inning: number }[];

  /** NFHS courtesy-runner usage. A courtesy runner is permitted at any
   *  time for the pitcher and/or catcher of record; only one CR per
   *  pitcher and one per catcher per game. Not the same as a regular
   *  substitution (PDF §28.3). Tracked by the player_id who acted as the
   *  CR each time, plus which role they covered. */
  courtesy_runners_used: {
    runner_player_id: string;
    role: "pitcher" | "catcher";
    inning: number;
  }[];
}

export type NonPaRunSource =
  | "wild_pitch"
  | "passed_ball"
  | "balk"
  | "error_advance"
  | "stolen_base";

export interface NonPaRun {
  event_id: string;
  pitcher_id: string | null;
  runs: number;
  source: NonPaRunSource;
}

export const EMPTY_BASES: Bases = { first: null, second: null, third: null };

export const INITIAL_STATE: ReplayState = {
  status: "draft",
  we_are_home: true,
  use_dh: true,
  league_type: "mlb",
  nfhs_state: null,
  inning: 1,
  half: "top",
  outs: 0,
  bases: { ...EMPTY_BASES },
  team_score: 0,
  opponent_score: 0,
  our_lineup: [],
  our_defensive_lineup: [],
  current_pitcher_id: null,
  current_opponent_pitcher_id: null,
  current_batter_slot: null,
  last_play_text: null,
  last_event_at: null,
  at_bats: [],
  current_balls: 0,
  current_strikes: 0,
  current_pa_pitches: [],
  non_pa_runs: [],
  defensive_conferences: [],
  courtesy_runners_used: [],
};
