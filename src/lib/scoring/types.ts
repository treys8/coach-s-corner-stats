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
  /** Set true on derived advances whose persisted `player_id` was a
   *  pre-Phase-4 `opp-pa-*` placeholder (synthesized when the opposing
   *  lineup was empty). The derived view rewrites those to `player_id:
   *  null` so consumers don't accidentally treat the synthetic string as
   *  an FK; persisted payloads still carry the original string. Only
   *  present on `DerivedAtBat.runner_advances`, never on the persisted
   *  AtBatPayload. */
  opponent_synthetic?: boolean;
}

// ---- Stage 3 fielder chain -------------------------------------------------

/** Batted-ball type captured by the post-drag chip prompt. Smart-defaults
 *  from result (FO→fly, LO→line, PO→pop, SF→fly, SAC→bunt); coach can
 *  override. Null when batter didn't put ball in play (K/BB/HBP/CI/IBB). */
export type BattedBallType = "ground" | "fly" | "line" | "pop" | "bunt";

/** One step in an ordered fielder chain. Stage 3 captures the chain on
 *  drag-and-drop of fielder icons on the diamond: first step is who first
 *  touched the ball, subsequent steps are throw recipients. `target` is the
 *  base the throw is going to (set when the drop landed near a base), used
 *  by notation rendering ("6-3") and the rollup attribution. */
export interface FielderTouch {
  /** Position abbreviation: 'P','C','1B','2B','3B','SS','LF','CF','RF'. */
  position: string;
  /** What this fielder did on this step. */
  action: "fielded" | "caught" | "threw_to" | "received" | "tagged";
  /** Throw destination / tag spot when applicable. */
  target?: Base | "home";
}

// ---- Event payloads --------------------------------------------------------

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

/** A slot in the opposing batting order (set pre-game). Identity-fields are
 *  optional: each slot must have jersey OR last_name (UI-validated). The
 *  `opponent_player_id` references public.opponent_players — written by the
 *  pre-game submit path after upserting opponent identity rows. */
export interface OpposingLineupSlot {
  batting_order: number;
  opponent_player_id: string | null;
  jersey_number: string | null;
  last_name: string | null;
  position: string | null;
  is_dh: boolean;
}

export interface GameStartedPayload {
  we_are_home: boolean;
  use_dh: boolean;
  starting_lineup: LineupSlot[];
  starting_pitcher_id: string | null;            // ours
  opponent_starting_pitcher_id: string | null;   // game_opponent_pitchers.id (legacy) or opponent_players.id (post-phase-1)
  /** Opposing batting order set pre-game. Mirrors `starting_lineup` for
   *  symmetry. Absent on legacy game_started events emitted before phase 1
   *  of opponent tracking shipped — the replay engine treats absence as
   *  "no opposing lineup available." */
  opposing_lineup?: OpposingLineupSlot[];
  /** Opposing team's DH choice. Independent of `use_dh` (ours). Absent on
   *  legacy events → engine defaults to false. */
  opponent_use_dh?: boolean;
  /** Optional: league rule set for NFHS-specific behaviors (courtesy
   *  runner, re-entry validation, defensive-conference rule, pitch-count
   *  rest days). Defaults to "mlb" if absent. Phase 5. */
  league_type?: LeagueType;
  /** Optional: state code (e.g., 'NY', 'CA') for state-specific pitch
   *  count rules when league_type === 'nfhs'. */
  nfhs_state?: string | null;
  /** Which defensive position our DH bats for. Defaults to "P" (legacy
   *  behavior) when omitted with use_dh=true. Null/absent when use_dh=false.
   *  Any defensive position except "DH" is valid. */
  dh_covers_position?: string | null;
  /** When use_dh=true and dh_covers_position !== "P", the player who covers
   *  that defensive position without batting (the player the DH hits for).
   *  When dh_covers_position === "P", this is null and starting_pitcher_id
   *  carries the same identity. */
  fielding_only_player_id?: string | null;
  /** Mirror of dh_covers_position for the opposing side. */
  opponent_dh_covers_position?: string | null;
  /** Mirror of fielding_only_player_id for the opposing side. References
   *  public.opponent_players.id. */
  opponent_fielding_only_player_id?: string | null;
}

/** Mid-game replacement of the opposing batting order. The replay engine
 *  replaces ReplayState.opposing_lineup wholesale; no validation of starters
 *  / re-entry (opposing identity is much looser than ours since we never
 *  promise their stats are complete). */
export interface OpposingLineupEditPayload {
  opposing_lineup: OpposingLineupSlot[];
  opponent_use_dh?: boolean;
  /** Plumbed for symmetry with `GameStartedPayload`. No editor surfaces this
   *  field today; the replay engine just mirrors it into ReplayState when
   *  present. */
  opponent_dh_covers_position?: string | null;
}

export interface AtBatPayload {
  inning: number;
  half: InningHalf;
  batter_id: string | null;                 // null when opposing team is batting
  opponent_batter_id?: string | null;       // opponent_players.id when opposing team is batting
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
  /** Set on a Pop/Fly out caught in foul territory (play-catalog §2.11,
   *  §2.17, §3.6). Pure notation hint — doesn't change base/out state.
   *  Stage 3 will surface it as the F2(f) / F7(f) scorebook suffix. */
  foul_out?: boolean;
  /** Ordered fielder touches captured by drag-chain (Stage 3). Empty when
   *  the coach skipped location (or pre-Stage-3 events). When present the
   *  first element's position is the canonical first-touch (replaces
   *  `fielder_position` semantics) and the rollup credits A on every
   *  non-terminal step, PO on the terminal step. */
  fielder_chain?: FielderTouch[];
  /** Captured from the post-drag chip (Ground/Fly/Line/Pop/Bunt). Smart-
   *  defaulted from `result` when the outcome implies it (FO→fly, etc.).
   *  Absent on legacy events. */
  batted_ball_type?: BattedBallType;
  /** Index into `fielder_chain` of the step that was an error. When set,
   *  that step's fielder gets +1 E (instead of A/PO), and the play retains
   *  its original outcome (e.g., a hit + throwing error stays "1B" with the
   *  error attributed to the throw). */
  error_step_index?: number | null;
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
  /** Ordered fielders who handled the ball on the CS play. First step is
   *  the throwing fielder (usually the catcher); subsequent steps are
   *  receivers / taggers. When present, the rollup credits A on every
   *  non-terminal step and PO on the terminal step. Catcher-specific CS
   *  credit (caught_stealing column) is independent and lands via
   *  `catcher_id` regardless of chain. */
  fielder_chain?: FielderTouch[];
}

export interface PickoffPayload {
  runner_id: string | null;
  from: Base;
  /** Ordered fielders on the pickoff play. Same semantics as
   *  CaughtStealingPayload.fielder_chain — A on non-terminal, PO on
   *  terminal. */
  fielder_chain?: FielderTouch[];
}

// Used for wild_pitch, passed_ball, balk, error_advance — UI provides an
// explicit advance plan because these can move multiple runners. Sources
// must be base names (no `batter`); destinations are bases / home / out.
//
// `error_fielder_position` + `error_type` are populated only by runner-drag
// → "fielding/throwing error" attribution. Carry the fielder who
// committed the error so a future engine pass can credit it. Today the
// replay engine ignores both fields (error rollup happens at the at-bat
// fielder_chain level) — they're persisted for the follow-up.
//
// `attribution_label` is a free-form descriptor for non-error runner-drag
// advances ("Advanced on the throw", "Tag-up advance", "Defensive
// indifference"). Drives the description string in the timeline; not yet
// read by the stats rollup.
export interface RunnerMovePayload {
  advances: RunnerAdvance[];
  error_fielder_position?: string;
  error_type?: "fielding" | "throwing";
  attribution_label?: string;
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

// ---- Stage 5 umpire calls --------------------------------------------------

/** Umpire calls modeled as modifier events consumed by the next play-
 *  resolving event (at_bat / stolen_base / error_advance / etc).
 *  See /docs/live-scoring/schema-deltas-v2.md §3. */
export type UmpireCallKind =
  | "IFR"                       // infield fly — batter auto-out on next at_bat
  | "obstruction_a"             // play being made — base awarded immediately
  | "obstruction_b"             // no play being made — base awarded if put out
  | "batter_interference"       // batter out; runner returns
  | "runner_interference"       // runner out; ball dead
  | "spectator_interference"    // umpire-judged base award
  | "coach_interference";       // runner out

export interface UmpireCallPayload {
  kind: UmpireCallKind;
  fielder_position?: string;
  offender_id?: string | null;
  awarded_to?: Base | "home";
  notes?: string | null;
}

/** A queued umpire call awaiting consumption by the next play-resolving
 *  event. Stored on ReplayState; cleared in FIFO order when consumed. */
export interface PendingUmpireCall {
  event_id: string;
  kind: UmpireCallKind;
  fielder_position?: string;
  offender_id?: string | null;
  awarded_to?: Base | "home";
  notes?: string | null;
}

export interface InningEndPayload {
  inning: number;
  half: InningHalf;
}

export type GameFinalizedPayload = Record<string, never>;

/** Stage 6a: pauses the game. Status flips to 'suspended'; any subsequent
 *  play-resolving event (at_bat, pitch, runner movement, substitution, etc.)
 *  flips it back to 'in_progress' — no explicit "unsuspend" event. /scores
 *  and game_live_state consumers render suspended as in_progress with a
 *  banner; stat_snapshots writes stay gated to status==='final'. */
export interface GameSuspendedPayload {
  reason?: "weather" | "darkness" | "curfew" | "other";
  notes?: string | null;
}

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
  | DefensiveConferencePayload
  | OpposingLineupEditPayload
  | UmpireCallPayload
  | GameSuspendedPayload;

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
  /** Set on opposing PAs to identify the opposing batter. Mutually
   *  exclusive with batter_id (CHECK enforced in DB). */
  opponent_batter_id: string | null;
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
  /** Snapshot of the player who occupied `fielder_position` in our defensive
   *  lineup at the moment of this PA, resolved at replay time. Used by
   *  rollupFielding to credit PO/E/DP/TP to a specific player. Null when
   *  our team was batting (the fielder belongs to the opponent) or when
   *  fielder_position is null. In-memory only — not persisted to the
   *  at_bats DB table. */
  fielder_player_id?: string | null;
  /** Snapshot of our catcher (player at position 'C') at the moment of this
   *  PA. Used by rollupFielding to credit catcher PO on strikeouts and CI
   *  on catcher's interference. Null when we were batting. In-memory only. */
  catcher_player_id?: string | null;
  /** Pass-through of `AtBatPayload.fielder_chain`. The rollup reads this
   *  when present to attribute A/PO per chain step. Absent on legacy
   *  events; rollup falls back to `fielder_position` then. */
  fielder_chain?: FielderTouch[];
  /** Parallel array of player_ids resolved from each `fielder_chain` step
   *  against our defensive lineup at the moment of the PA. Same length as
   *  `fielder_chain`. Each element is null when we were batting (the
   *  fielder belongs to the opponent) or the position wasn't in our
   *  lineup. In-memory only — not persisted. */
  fielder_chain_player_ids?: (string | null)[];
  /** Pass-through of `AtBatPayload.batted_ball_type`. */
  batted_ball_type?: BattedBallType;
  /** Pass-through of `AtBatPayload.error_step_index`. */
  error_step_index?: number | null;
  /** The umpire_call that this at_bat consumed (FIFO from the pending
   *  queue), if any. IFR sets this to `{ kind: 'IFR', ... }` and the
   *  engine has already forced the batter out / cleared forced advances.
   *  In-memory only — not persisted. */
  applied_umpire_call?: PendingUmpireCall;
  /** Event sequence_number copied from the source game_event. Lets ER
   *  reconstruction interleave at_bats with non-PA running events
   *  chronologically inside a half-inning. In-memory only. Stage 6b. */
  sequence?: number;
  /** Set at the half-inning's `inning_end` by ER reconstruction (OSR 9.16)
   *  when this PA started at-or-after the "phantom 3rd out" — the
   *  would-have-been 3rd out that errors prevented. Runs scored on a PA
   *  flagged here are unearned, on top of the existing per-runner
   *  `reached_on_error` taint. In-memory only. Stage 6b. */
  after_phantom_third_out?: boolean;
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
  current_pitcher_id: string | null;
  current_opponent_pitcher_id: string | null;
  /** 1-based slot in our_lineup that's up next when we're batting. Null
   *  before game_started. Persists across half-innings since the order
   *  resumes where it left off. */
  current_batter_slot: number | null;

  /** Opposing batting order set pre-game (and mutable mid-game via
   *  `opposing_lineup_edit` events). Empty array before game_started or on
   *  legacy game_started events that predate opponent tracking. */
  opposing_lineup: OpposingLineupSlot[];
  /** Opposing team's DH choice. */
  opponent_use_dh: boolean;
  /** 1-based slot in opposing_lineup that's up next when we're fielding.
   *  Null before game_started or when opposing_lineup is empty. */
  current_opp_batter_slot: number | null;

  /** Which defensive position our DH covers ("P" in the common case, any
   *  other position when the DH bats for a non-pitcher). Null when
   *  use_dh=false. */
  dh_covers_position: string | null;
  /** Our fielder who plays defense but doesn't bat (the player our DH hits
   *  for). Null when use_dh=false OR dh_covers_position === "P" — in the
   *  pitcher case current_pitcher_id already carries this player. */
  fielding_only_player_id: string | null;
  /** Mirror of dh_covers_position for the opposing side. */
  opponent_dh_covers_position: string | null;
  /** Opposing fielder-only player (opponent_players.id). Mirror of
   *  fielding_only_player_id. */
  opponent_fielding_only_player_id: string | null;

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

  /** Per-runner stolen base / caught stealing / pickoff logs, populated
   *  by the corresponding event handlers. Used by rollupBatting to
   *  credit SB/CS/PIK per batter. Runner_id may be null when the event
   *  payload omitted it (legacy events); such entries are ignored by
   *  the rollup. `catcher_id` is the player at 'C' in our defensive
   *  lineup at the moment of the event when we were fielding, null when
   *  we were batting — rollupFielding uses it to credit catcher SB
   *  (allowed) / CS / PIK. */
  stolen_bases: { runner_id: string | null; event_id: string; catcher_id: string | null }[];
  /** `from` echoes the payload base so consumers can distinguish CS-at-2nd
   *  from CS-at-home in rollups without an out-of-band event lookup.
   *  `fielder_chain` + `fielder_chain_player_ids` are snapshotted from the
   *  event when a chain was attached; rollupFielding walks them for A/PO
   *  credit. */
  caught_stealing: {
    runner_id: string | null;
    event_id: string;
    catcher_id: string | null;
    from: Base;
    fielder_chain?: FielderTouch[];
    fielder_chain_player_ids?: (string | null)[];
  }[];
  pickoffs: {
    runner_id: string | null;
    event_id: string;
    catcher_id: string | null;
    from: Base;
    fielder_chain?: FielderTouch[];
    fielder_chain_player_ids?: (string | null)[];
  }[];

  /** Passed-ball events logged so rollupFielding can credit each one to
   *  the catcher in play at the moment. Only populated when we were
   *  fielding. PB-derived runs continue to flow through `non_pa_runs`. */
  passed_balls: { event_id: string; catcher_id: string | null }[];

  /** Between-PA error_advance events tagged with the fielder who committed
   *  the error (resolved from `RunnerMovePayload.error_fielder_position`
   *  at apply time). Only populated when we were fielding AND the payload
   *  named a position. rollupFielding credits each entry as +1 E. */
  error_advance_fielders: { event_id: string; fielder_player_id: string }[];

  /** Umpire calls that have been emitted but not yet consumed by a
   *  play-resolving event. FIFO. IFR flips the batter to an automatic out
   *  on the next at_bat; obstruction overrides the runner's destination on
   *  the next runner-movement event. Cleared on inning_end with a warning
   *  if anything remained (per /docs/live-scoring/schema-deltas-v2.md §3). */
  pending_umpire_calls: PendingUmpireCall[];

  /** Defensive outs accumulated per (player_id, position). Every at_bat
   *  with outs_recorded > 0 during a half we were fielding contributes
   *  those outs to each player currently in our defensive lineup (the 8
   *  LineupSlots with a position plus current_pitcher_id at 'P').
   *  Converted to innings (outs / 3) by rollupFielding. */
  defensive_innings_outs: { [player_id: string]: { [position: string]: number } };
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
  /** Event sequence_number, used by ER reconstruction (Stage 6b) to interleave
   *  non-PA running events with at_bats chronologically inside a half-inning.
   *  Optional for back-compat with replay states materialized before 6b. */
  sequence?: number;
  /** Set at the half-inning's `inning_end` by ER reconstruction (OSR 9.16)
   *  when this run scored at-or-after the "phantom 3rd out" — the would-have-
   *  been 3rd out that errors prevented. Such runs are unearned regardless
   *  of source. Stage 6b. */
  after_phantom_third_out?: boolean;
  /** Half-inning the run scored in. Populated by the replay engine so
   *  reconstruction can group non-PA runs by (inning, half) without an
   *  out-of-band lookup. Optional for back-compat with pre-6b state. */
  inning?: number;
  half?: InningHalf;
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
  current_pitcher_id: null,
  current_opponent_pitcher_id: null,
  current_batter_slot: null,
  opposing_lineup: [],
  opponent_use_dh: false,
  current_opp_batter_slot: null,
  dh_covers_position: null,
  fielding_only_player_id: null,
  opponent_dh_covers_position: null,
  opponent_fielding_only_player_id: null,
  last_play_text: null,
  last_event_at: null,
  at_bats: [],
  current_balls: 0,
  current_strikes: 0,
  current_pa_pitches: [],
  non_pa_runs: [],
  defensive_conferences: [],
  courtesy_runners_used: [],
  stolen_bases: [],
  caught_stealing: [],
  pickoffs: [],
  passed_balls: [],
  error_advance_fielders: [],
  pending_umpire_calls: [],
  defensive_innings_outs: {},
};
