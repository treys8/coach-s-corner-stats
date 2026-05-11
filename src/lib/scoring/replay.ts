// Pure replay engine. Reduces a sequence of game_events into a canonical
// ReplayState (live state + derived at_bats). Same module is imported by:
//   - the tablet, which folds events into the local UI state
//   - the server, which writes the result to at_bats / game_live_state
//
// Determinism: the engine never reads the wall clock. Every effect is a
// function of the input event sequence. `last_event_at` mirrors the event's
// `created_at`.
//
// Handles: game_started, at_bat (legacy PA-level events), pitch (new
// pitch-by-pitch GameChanger-style flow), substitution (regular only),
// pitching_change, inning_end, game_finalized, correction. Edge-case event
// types from the design (stolen_base, courtesy runners, etc.) light up
// later by extending `applyEvent`.

import { defaultAdvances } from "./advances";
import type {
  AtBatPayload,
  AtBatResult,
  Bases,
  CorrectionPayload,
  DerivedAtBat,
  GameEventRecord,
  GameStartedPayload,
  InningEndPayload,
  PitchKind,
  PitchPayload,
  PitchingChangePayload,
  ReplayState,
  RunnerAdvance,
  SubstitutionPayload,
} from "./types";
import { EMPTY_BASES, INITIAL_STATE } from "./types";

// Default outs charged to the at-bat when the payload doesn't enumerate
// runner_advances. DP/TP land here too — UIs may opt to enumerate explicitly.
const DEFAULT_OUTS_FOR: Partial<Record<AtBatResult, number>> = {
  K_swinging: 1, K_looking: 1,
  FO: 1, GO: 1, LO: 1, PO: 1, IF: 1,
  SAC: 1, SF: 1,
  DP: 2, TP: 3,
};

// ---- Public API ------------------------------------------------------------

export function replay(events: GameEventRecord[]): ReplayState {
  // Sort by sequence_number to be safe (server enforces monotonicity, but
  // offline merges may arrive out of order).
  const sorted = [...events].sort((a, b) => a.sequence_number - b.sequence_number);

  // Build the supersession map so corrections override prior events in place.
  const superseded = new Set<string>();
  for (const e of sorted) {
    if (e.event_type === "correction") {
      const p = e.payload as CorrectionPayload;
      superseded.add(p.superseded_event_id);
    }
  }

  let state: ReplayState = { ...INITIAL_STATE, bases: { ...EMPTY_BASES }, our_lineup: [], at_bats: [] };

  for (const e of sorted) {
    if (superseded.has(e.id)) continue;
    state = applyEvent(state, e);
  }

  return state;
}

// ---- Reducer ---------------------------------------------------------------

function applyEvent(state: ReplayState, event: GameEventRecord): ReplayState {
  const next: ReplayState = {
    ...state,
    bases: { ...state.bases },
    our_lineup: state.our_lineup.map((s) => ({ ...s })),
    at_bats: state.at_bats,
    last_event_at: event.created_at,
  };

  switch (event.event_type) {
    case "game_started":
      return applyGameStarted(next, event.payload as GameStartedPayload);
    case "at_bat":
      return applyAtBat(next, event.id, event.payload as AtBatPayload);
    case "pitch":
      return applyPitch(next, event.id, event.payload as PitchPayload);
    case "substitution":
      return applySubstitution(next, event.payload as SubstitutionPayload);
    case "pitching_change":
      return applyPitchingChange(next, event.payload as PitchingChangePayload);
    case "inning_end":
      return applyInningEnd(next, event.payload as InningEndPayload);
    case "game_finalized":
      return { ...next, status: "final" };
    case "correction": {
      const p = event.payload as CorrectionPayload;
      // Void correction: original is in `superseded` and skipped; nothing to
      // apply in its place (un-finalize takes this path).
      if (p.corrected_event_type === null || p.corrected_payload === null) {
        return next;
      }
      return applyEvent(next, {
        ...event,
        event_type: p.corrected_event_type,
        payload: p.corrected_payload,
      });
    }
    default:
      // Phase 3 events fall through as no-ops until their handlers land.
      return next;
  }
}

// ---- Handlers --------------------------------------------------------------

function applyGameStarted(state: ReplayState, p: GameStartedPayload): ReplayState {
  // game_started flips draft → in_progress so the UI can move from the
  // pre-game form into the scoring screen the moment the lineup is set,
  // without waiting for a first pitch. The design doc described this as
  // "first scoring event flips status" — in practice users expect the
  // scoring screen as soon as they start the game.
  return {
    ...state,
    status: "in_progress",
    we_are_home: p.we_are_home,
    use_dh: p.use_dh,
    our_lineup: p.starting_lineup.map((s) => ({ ...s })),
    current_pitcher_id: p.starting_pitcher_id,
    current_opponent_pitcher_id: p.opponent_starting_pitcher_id,
    current_batter_slot: 1,
    inning: 1,
    half: "top",
    outs: 0,
    bases: { ...EMPTY_BASES },
    team_score: 0,
    opponent_score: 0,
  };
}

function applyAtBat(state: ReplayState, eventId: string, p: AtBatPayload): ReplayState {
  const weAreBatting = isOurHalf(state.we_are_home, p.half);
  const { bases, runsScored, outsAdded } = resolveRunnerAdvances(state.bases, p);

  const team_score = weAreBatting ? state.team_score + runsScored : state.team_score;
  const opponent_score = weAreBatting ? state.opponent_score : state.opponent_score + runsScored;

  // Advance the batter slot only when our team batted. Wrap 9 → 1.
  const lineupSize = state.our_lineup.length || 9;
  const next_batter_slot =
    weAreBatting && state.current_batter_slot !== null
      ? (state.current_batter_slot % lineupSize) + 1
      : state.current_batter_slot;

  const derived: DerivedAtBat = {
    event_id: eventId,
    inning: p.inning,
    half: p.half,
    batting_order: p.batting_order,
    batter_id: p.batter_id,
    pitcher_id: p.pitcher_id,
    opponent_pitcher_id: p.opponent_pitcher_id,
    result: p.result,
    rbi: p.rbi,
    pitch_count: p.pitch_count,
    balls: p.balls ?? 0,
    strikes: p.strikes ?? 0,
    spray_x: p.spray_x,
    spray_y: p.spray_y,
    fielder_position: p.fielder_position,
    runs_scored_on_play: runsScored,
    outs_recorded: outsAdded,
    runner_advances: p.runner_advances,
    description: p.description,
  };

  return {
    ...state,
    status: state.status === "draft" ? "in_progress" : state.status,
    bases,
    outs: state.outs + outsAdded,
    team_score,
    opponent_score,
    current_batter_slot: next_batter_slot,
    // PA resolved — count resets for the next batter.
    balls: 0,
    strikes: 0,
    current_pa_pitches: 0,
    last_play_text: p.description,
    at_bats: [...state.at_bats, derived],
  };
}

// Pitch event: most pitches just bump the count; the terminal pitch of a PA
// (in_play, hbp, intentional_walk, foul_tip_out, dropped_third_strike,
// catcher_interference, or the 4th-ball / 3rd-strike pitch) resolves the PA
// by synthesizing an AtBatPayload and routing through applyAtBat — which
// already knows how to advance bases, score runs, advance the lineup, and
// reset the count.
function applyPitch(state: ReplayState, eventId: string, p: PitchPayload): ReplayState {
  const nextBalls = nextBallCount(state.balls, p.kind);
  const nextStrikes = nextStrikeCount(state.strikes, p.kind);
  const nextPaPitches = countsAsPitch(p.kind) ? state.current_pa_pitches + 1 : state.current_pa_pitches;

  const resolution = resolvePitch(p, nextBalls, nextStrikes, state.bases);
  if (resolution === null) {
    // PA not over — just update count + pitch tally.
    return {
      ...state,
      status: state.status === "draft" ? "in_progress" : state.status,
      balls: nextBalls,
      strikes: nextStrikes,
      current_pa_pitches: nextPaPitches,
    };
  }

  const synthAtBat: AtBatPayload = {
    inning: p.inning,
    half: p.half,
    batter_id: p.batter_id,
    pitcher_id: p.pitcher_id,
    opponent_pitcher_id: p.opponent_pitcher_id,
    batting_order: p.batting_order,
    result: resolution.result,
    rbi: resolution.rbi,
    pitch_count: nextPaPitches,
    balls: nextBalls,
    strikes: nextStrikes,
    spray_x: resolution.spray_x,
    spray_y: resolution.spray_y,
    fielder_position: resolution.fielder_position,
    runner_advances: resolution.runner_advances,
    description: p.description,
  };
  return applyAtBat(state, eventId, synthAtBat);
}

function applySubstitution(state: ReplayState, p: SubstitutionPayload): ReplayState {
  if (p.sub_type !== "regular") {
    // Phase 3 covers pinch_hit / pinch_run / courtesy_run / re_entry semantics.
    return state;
  }
  const our_lineup = state.our_lineup.map((slot) =>
    slot.batting_order === p.batting_order
      ? { ...slot, player_id: p.in_player_id, position: p.position ?? slot.position }
      : slot,
  );
  return { ...state, our_lineup };
}

function applyPitchingChange(state: ReplayState, p: PitchingChangePayload): ReplayState {
  return { ...state, current_pitcher_id: p.in_pitcher_id };
}

function applyInningEnd(state: ReplayState, p: InningEndPayload): ReplayState {
  const nextHalf = p.half === "top" ? "bottom" : "top";
  const nextInning = p.half === "bottom" ? p.inning + 1 : p.inning;
  return {
    ...state,
    inning: nextInning,
    half: nextHalf,
    outs: 0,
    bases: { ...EMPTY_BASES },
    // Mid-PA pitches don't carry across half-innings. (In real baseball
    // they actually do for the same batter, but inning_end is only emitted
    // after the third out — so any pending count is moot.)
    balls: 0,
    strikes: 0,
    current_pa_pitches: 0,
  };
}

// ---- Helpers ---------------------------------------------------------------

function isOurHalf(weAreHome: boolean, half: "top" | "bottom"): boolean {
  // Visiting team bats in the top, home in the bottom.
  return weAreHome ? half === "bottom" : half === "top";
}

interface ResolvedAdvances {
  bases: Bases;
  runsScored: number;
  outsAdded: number;
}

// Apply runner_advances from the at-bat payload. The tablet/UI is
// responsible for producing a complete advancement plan; this function
// just executes it and counts the runs/outs that resulted.
//
// If `runner_advances` is empty (e.g., a strikeout with no runners moved),
// we fall back to DEFAULT_OUTS_FOR to charge the standard outs for the
// outcome.
function resolveRunnerAdvances(prev: Bases, p: AtBatPayload): ResolvedAdvances {
  const next: Bases = { ...prev };
  let runsScored = 0;
  let outsAdded = 0;

  // Track which source bases have been emptied so we don't double-clear.
  const cleared: Record<"first" | "second" | "third", boolean> = {
    first: false, second: false, third: false,
  };

  for (const adv of p.runner_advances) {
    if (adv.from !== "batter") {
      if (!cleared[adv.from]) {
        next[adv.from] = null;
        cleared[adv.from] = true;
      }
    }
    if (adv.to === "home") {
      runsScored += 1;
    } else if (adv.to === "out") {
      outsAdded += 1;
    } else {
      // first / second / third
      next[adv.to] = adv.player_id;
    }
  }

  // Implicit outs for outcomes the UI didn't enumerate (e.g., a clean K).
  if (p.runner_advances.length === 0) {
    outsAdded = DEFAULT_OUTS_FOR[p.result] ?? 0;
  }

  return { bases: next, runsScored, outsAdded };
}

// ---- Pitch helpers ---------------------------------------------------------

// `intentional_walk` is the GC shortcut button: no pitch is thrown, the
// PA resolves directly. Every other kind counts toward the pitcher's
// thrown-pitch tally and the PA's pitch count.
function countsAsPitch(kind: PitchKind): boolean {
  return kind !== "intentional_walk";
}

function nextBallCount(balls: number, kind: PitchKind): number {
  switch (kind) {
    case "ball":
    case "intentional_ball":
    case "illegal_pitch":
      return balls + 1;
    default:
      return balls;
  }
}

function nextStrikeCount(strikes: number, kind: PitchKind): number {
  switch (kind) {
    case "called_strike":
    case "swinging_strike":
      return strikes + 1;
    case "foul":
      // Fouls cap at two strikes (a foul with two strikes leaves the count
      // unchanged). foul_tip_out is the exception — it's a kind of its own.
      return Math.min(2, strikes + 1);
    default:
      return strikes;
  }
}

interface PaResolution {
  result: AtBatResult;
  rbi: number;
  spray_x: number | null;
  spray_y: number | null;
  fielder_position: string | null;
  runner_advances: RunnerAdvance[];
}

// Decide whether this pitch terminates the PA, and if so, build the
// resolution payload. Terminal kinds (in_play, hbp, etc.) resolve regardless
// of count; ball / called_strike / swinging_strike resolve only when the
// count hits 4 or 3 respectively.
function resolvePitch(
  p: PitchPayload,
  balls: number,
  strikes: number,
  prevBases: Bases,
): PaResolution | null {
  switch (p.kind) {
    case "in_play": {
      // Malformed payload — the UI is responsible for picking a result
      // during the drill-down before posting an in_play pitch.
      if (!p.result) return null;
      return {
        result: p.result,
        rbi: p.rbi,
        spray_x: p.spray_x,
        spray_y: p.spray_y,
        fielder_position: p.fielder_position,
        runner_advances: p.runner_advances,
      };
    }
    case "hbp": {
      const advances = defaultAdvances(prevBases, p.batter_id, "HBP");
      return {
        result: "HBP",
        rbi: countRuns(advances),
        spray_x: null,
        spray_y: null,
        fielder_position: null,
        runner_advances: advances,
      };
    }
    case "intentional_walk": {
      const advances = defaultAdvances(prevBases, p.batter_id, "IBB");
      return {
        result: "IBB",
        rbi: countRuns(advances),
        spray_x: null,
        spray_y: null,
        fielder_position: null,
        runner_advances: advances,
      };
    }
    case "foul_tip_out":
      // Caught foul tip with two strikes — batter out, charged a strikeout.
      return {
        result: "K_swinging",
        rbi: 0,
        spray_x: null,
        spray_y: null,
        fielder_position: null,
        runner_advances: [],
      };
    case "catcher_interference":
      // Batter awarded 1B, no AB charge. Until we model ROE separately,
      // record as "E" with batter on 1B; rollup excludes E from AB count.
      return {
        result: "E",
        rbi: 0,
        spray_x: null,
        spray_y: null,
        fielder_position: "C",
        runner_advances: [{ from: "batter", to: "first", player_id: p.batter_id }],
      };
    case "dropped_third_strike":
      // V1: treat as a strikeout. The GameChanger drill-down (safe at 1st /
      // out at 1st / error) lights up later as a follow-up sub-menu.
      return {
        result: "K_swinging",
        rbi: 0,
        spray_x: null,
        spray_y: null,
        fielder_position: null,
        runner_advances: [],
      };
  }

  // Count-driven resolution for plain pitches.
  if (balls >= 4) {
    const advances = defaultAdvances(prevBases, p.batter_id, "BB");
    return {
      result: "BB",
      rbi: countRuns(advances),
      spray_x: null,
      spray_y: null,
      fielder_position: null,
      runner_advances: advances,
    };
  }
  if (strikes >= 3) {
    // K_looking only if the terminating pitch was actually called; otherwise
    // a foul couldn't have made it the third strike (capped at 2), so the
    // remaining culprit is a swinging strike.
    const result: AtBatResult = p.kind === "called_strike" ? "K_looking" : "K_swinging";
    return {
      result,
      rbi: 0,
      spray_x: null,
      spray_y: null,
      fielder_position: null,
      runner_advances: [],
    };
  }
  return null;
}

function countRuns(advances: RunnerAdvance[]): number {
  let runs = 0;
  for (const a of advances) if (a.to === "home") runs += 1;
  return runs;
}

export { INITIAL_STATE } from "./types";
