// Pure replay engine. Reduces a sequence of game_events into a canonical
// ReplayState (live state + derived at_bats). Same module is imported by:
//   - the tablet, which folds events into the local UI state
//   - the server, which writes the result to at_bats / game_live_state
//
// Determinism: the engine never reads the wall clock. Every effect is a
// function of the input event sequence. `last_event_at` mirrors the event's
// `created_at`.
//
// Phase 1 handles: game_started, at_bat, substitution (regular only),
// pitching_change, inning_end, game_finalized, correction. Edge-case event
// types from the design (stolen_base, courtesy runners, etc.) light up in
// Phase 3 by extending `applyEvent`.

import type {
  AtBatPayload,
  AtBatResult,
  Base,
  BaseRunner,
  Bases,
  CaughtStealingPayload,
  CorrectionPayload,
  DefensiveConferencePayload,
  DerivedAtBat,
  GameEventRecord,
  GameStartedPayload,
  InningEndPayload,
  NonPaRunSource,
  OpposingLineupEditPayload,
  PickoffPayload,
  PitchPayload,
  PitchingChangePayload,
  ReplayState,
  RunnerAdvance,
  RunnerMovePayload,
  StolenBasePayload,
  SubstitutionPayload,
} from "./types";
import { EMPTY_BASES, INITIAL_STATE } from "./types";

// Pre-Phase-4 placeholder prefix for opposing-batter ids when the opposing
// lineup was empty. New games can't emit these (the pre-game gate requires
// an opposing lineup), but in-flight legacy games may still surface them
// in persisted runner_advances. Detected at read time and rewritten on the
// derived view; the persisted payload is left untouched.
const OPP_SYNTHETIC_PREFIX = "opp-pa-";

function translateSyntheticAdvances(advances: RunnerAdvance[]): RunnerAdvance[] {
  let mutated = false;
  const out = advances.map((a) => {
    if (a.player_id && a.player_id.startsWith(OPP_SYNTHETIC_PREFIX)) {
      mutated = true;
      return { from: a.from, to: a.to, player_id: null, opponent_synthetic: true };
    }
    return a;
  });
  return mutated ? out : advances;
}

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

  let state: ReplayState = {
    ...INITIAL_STATE,
    bases: { ...EMPTY_BASES },
    our_lineup: [],
    at_bats: [],
    current_pa_pitches: [],
    non_pa_runs: [],
    passed_balls: [],
    defensive_innings_outs: {},
  };

  for (const e of sorted) {
    if (superseded.has(e.id)) continue;
    state = applyEvent(state, e);
  }

  return state;
}

// ---- Reducer ---------------------------------------------------------------

// Exported so callers can fold an authoritative event onto an existing state
// (e.g. consuming the live_state + new event returned from the events API)
// without rebuilding from the full log. `replay()` is `events.reduce(applyEvent,
// INITIAL_STATE)` modulo the supersession filter — see fold-equivalence test
// in replay.test.ts.
export function applyEvent(state: ReplayState, event: GameEventRecord): ReplayState {
  const next: ReplayState = {
    ...state,
    bases: { ...state.bases },
    our_lineup: state.our_lineup.map((s) => ({ ...s })),
    at_bats: state.at_bats,
    current_pa_pitches: state.current_pa_pitches,
    non_pa_runs: state.non_pa_runs,
    stolen_bases: state.stolen_bases,
    caught_stealing: state.caught_stealing,
    pickoffs: state.pickoffs,
    passed_balls: state.passed_balls,
    defensive_innings_outs: state.defensive_innings_outs,
    last_event_at: event.created_at,
  };

  switch (event.event_type) {
    case "game_started":
      return applyGameStarted(next, event.payload as GameStartedPayload);
    case "at_bat":
      return applyAtBat(next, event.id, event.payload as AtBatPayload);
    case "substitution":
      return applySubstitution(next, event.payload as SubstitutionPayload);
    case "pitching_change":
      return applyPitchingChange(next, event.payload as PitchingChangePayload);
    case "inning_end":
      return applyInningEnd(next, event.payload as InningEndPayload);
    case "game_finalized":
      return { ...next, status: "final" };
    case "stolen_base":
      return applyStolenBase(next, event.id, event.payload as StolenBasePayload);
    case "caught_stealing":
      return applyCaughtStealing(next, event.id, event.payload as CaughtStealingPayload);
    case "pickoff":
      return applyPickoff(next, event.id, event.payload as PickoffPayload);
    case "wild_pitch":
      return applyRunnerMove(next, event.id, "wild_pitch", event.payload as RunnerMovePayload);
    case "passed_ball":
      return applyRunnerMove(next, event.id, "passed_ball", event.payload as RunnerMovePayload);
    case "balk":
      return applyRunnerMove(next, event.id, "balk", event.payload as RunnerMovePayload);
    case "error_advance":
      return applyRunnerMove(next, event.id, "error_advance", event.payload as RunnerMovePayload);
    case "pitch":
      return applyPitch(next, event.payload as PitchPayload);
    case "defensive_conference":
      return applyDefensiveConference(next, event.payload as DefensiveConferencePayload);
    case "opposing_lineup_edit":
      return applyOpposingLineupEdit(next, event.payload as OpposingLineupEditPayload);
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
  //
  // Stamps each starting slot with is_starter=true and pins
  // original_player_id so re-entry validation (NFHS 3-1-3) can verify
  // a returning starter goes back to their own slot.
  return {
    ...state,
    status: "in_progress",
    we_are_home: p.we_are_home,
    use_dh: p.use_dh,
    league_type: p.league_type ?? "mlb",
    nfhs_state: p.nfhs_state ?? null,
    our_lineup: p.starting_lineup.map((s) => ({
      ...s,
      is_starter: true,
      re_entered: false,
      original_player_id: s.player_id,
    })),
    current_pitcher_id: p.starting_pitcher_id,
    current_opponent_pitcher_id: p.opponent_starting_pitcher_id,
    current_batter_slot: 1,
    opposing_lineup: p.opposing_lineup ?? [],
    opponent_use_dh: p.opponent_use_dh ?? false,
    current_opp_batter_slot: (p.opposing_lineup?.length ?? 0) > 0 ? 1 : null,
    inning: 1,
    half: "top",
    outs: 0,
    bases: { ...EMPTY_BASES },
    team_score: 0,
    opponent_score: 0,
  };
}

/** Mid-game replacement of the opposing batting order. No validation —
 *  opposing-side identity is much looser than ours (we never promise
 *  complete stats for them). Resets `current_opp_batter_slot` to 1 only
 *  when the lineup was previously empty; otherwise keeps the existing slot
 *  pointer so a typo-fix mid-PA doesn't reset who's batting. */
function applyOpposingLineupEdit(
  state: ReplayState,
  p: OpposingLineupEditPayload,
): ReplayState {
  const wasEmpty = state.opposing_lineup.length === 0;
  return {
    ...state,
    opposing_lineup: p.opposing_lineup,
    opponent_use_dh: p.opponent_use_dh ?? state.opponent_use_dh,
    current_opp_batter_slot:
      wasEmpty && p.opposing_lineup.length > 0
        ? 1
        : state.current_opp_batter_slot,
  };
}

function applyAtBat(state: ReplayState, eventId: string, p: AtBatPayload): ReplayState {
  const weAreBatting = isOurHalf(state.we_are_home, p.half);
  const pitcherOfRecord = weAreBatting
    ? state.current_opponent_pitcher_id
    : state.current_pitcher_id;
  const basesBefore: Bases = { ...state.bases };
  const { bases, runsScored, outsAdded } = resolveRunnerAdvances(state.bases, p, pitcherOfRecord);

  // Fielder + catcher snapshots: only meaningful when we were fielding.
  // When we batted, the fielder/catcher in play are the opponent's.
  const fielderPlayerId =
    !weAreBatting && p.fielder_position
      ? resolveFielderPlayerId(state, p.fielder_position)
      : null;
  const catcherPlayerId = weAreBatting ? null : resolveFielderPlayerId(state, "C");

  // Defensive-innings ledger: accrue outs to each player currently in our
  // defensive lineup. Only when we were fielding (outs we recorded against
  // the opposing batter).
  let defensive_innings_outs = state.defensive_innings_outs;
  if (!weAreBatting && outsAdded > 0) {
    defensive_innings_outs = { ...state.defensive_innings_outs };
    for (const { player_id, position } of defensivePositionsAtMoment(state)) {
      const existing = defensive_innings_outs[player_id] ?? {};
      defensive_innings_outs[player_id] = {
        ...existing,
        [position]: (existing[position] ?? 0) + outsAdded,
      };
    }
  }

  const team_score = weAreBatting ? state.team_score + runsScored : state.team_score;
  const opponent_score = weAreBatting ? state.opponent_score : state.opponent_score + runsScored;

  // Advance the batter slot only when our team batted. Wrap 9 → 1.
  const lineupSize = state.our_lineup.length || 9;
  const next_batter_slot =
    weAreBatting && state.current_batter_slot !== null
      ? (state.current_batter_slot % lineupSize) + 1
      : state.current_batter_slot;

  // Advance the opposing batter slot only when WE fielded (they batted).
  const oppLineupSize = state.opposing_lineup.length || 9;
  const next_opp_batter_slot =
    !weAreBatting && state.current_opp_batter_slot !== null
      ? (state.current_opp_batter_slot % oppLineupSize) + 1
      : state.current_opp_batter_slot;

  // Pitch trail: when present, derive count from it; otherwise fall back
  // to the payload values for backward compatibility.
  const trail = state.current_pa_pitches;
  const trailCount = countFromPitches(trail);
  const usingTrail = trail.length > 0;
  const derived: DerivedAtBat = {
    event_id: eventId,
    inning: p.inning,
    half: p.half,
    batting_order: p.batting_order,
    batter_id: p.batter_id,
    opponent_batter_id: p.opponent_batter_id ?? null,
    pitcher_id: p.pitcher_id,
    opponent_pitcher_id: p.opponent_pitcher_id,
    result: p.result,
    rbi: p.rbi,
    pitch_count: usingTrail ? trail.length : p.pitch_count,
    balls: usingTrail ? trailCount.balls : (p.balls ?? 0),
    strikes: usingTrail ? trailCount.strikes : (p.strikes ?? 0),
    spray_x: p.spray_x,
    spray_y: p.spray_y,
    fielder_position: p.fielder_position,
    runs_scored_on_play: runsScored,
    outs_recorded: outsAdded,
    runner_advances: translateSyntheticAdvances(p.runner_advances),
    pitcher_of_record_id: pitcherOfRecord,
    bases_before: basesBefore,
    description: p.description,
    pitches: trail.slice(),
    batter_reached_on_k3: p.batter_reached_on_k3,
    fielder_player_id: fielderPlayerId,
    catcher_player_id: catcherPlayerId,
  };

  return {
    ...state,
    status: state.status === "draft" ? "in_progress" : state.status,
    bases,
    outs: state.outs + outsAdded,
    team_score,
    opponent_score,
    current_batter_slot: next_batter_slot,
    current_opp_batter_slot: next_opp_batter_slot,
    last_play_text: p.description,
    at_bats: [...state.at_bats, derived],
    current_balls: 0,
    current_strikes: 0,
    current_pa_pitches: [],
    defensive_innings_outs,
  };
}

function countFromPitches(trail: PitchPayload[]): { balls: number; strikes: number } {
  let balls = 0;
  let strikes = 0;
  for (const p of trail) {
    if (p.pitch_type === "ball" || p.pitch_type === "pitchout" || p.pitch_type === "intentional_ball") {
      balls += 1;
    } else if (
      p.pitch_type === "called_strike"
      || p.pitch_type === "swinging_strike"
      || p.pitch_type === "foul_tip_caught"
    ) {
      strikes += 1;
    } else if (p.pitch_type === "foul") {
      if (strikes < 2) strikes += 1;
    }
  }
  return { balls: Math.min(4, balls), strikes: Math.min(3, strikes) };
}

function applySubstitution(state: ReplayState, p: SubstitutionPayload): ReplayState {
  switch (p.sub_type) {
    case "regular":
    case "pinch_hit": {
      // Both swap the lineup slot. pinch_hit explicitly marks the incoming
      // player as a non-starter (for re-entry tracking).
      const our_lineup = state.our_lineup.map((slot) =>
        slot.batting_order === p.batting_order
          ? {
              ...slot,
              player_id: p.in_player_id,
              position: p.position ?? slot.position,
              is_starter: p.sub_type === "regular" ? slot.is_starter && slot.player_id === p.in_player_id : false,
            }
          : slot,
      );
      return { ...state, our_lineup };
    }
    case "pinch_run": {
      // Replace the baserunner in place AND swap the lineup slot. Preserves
      // pitcher_of_record and reached_on_error on the BaseRunner so
      // inherited-runner ER attribution stays correct.
      const base = p.original_base;
      const bases: Bases = { ...state.bases };
      if (base && bases[base]) {
        bases[base] = { ...bases[base], player_id: p.in_player_id };
      }
      const our_lineup = state.our_lineup.map((slot) =>
        slot.batting_order === p.batting_order
          ? { ...slot, player_id: p.in_player_id, is_starter: false }
          : slot,
      );
      return { ...state, bases, our_lineup };
    }
    case "courtesy_run": {
      // NFHS only — reject for MLB rule sets. Courtesy runner replaces
      // the runner on a base *temporarily*; the original player (pitcher
      // or catcher) stays in the lineup and bats next time their slot
      // comes up. So we mutate bases but NOT our_lineup. Track usage.
      if (state.league_type !== "nfhs") return state;
      const base = p.original_base;
      const bases: Bases = { ...state.bases };
      if (base && bases[base]) {
        bases[base] = { ...bases[base], player_id: p.in_player_id };
      }
      // Determine role: was the player at this base the pitcher or catcher?
      // Inferred from out_player_id matching current_pitcher_id, else catcher.
      // (UI is responsible for only emitting this for legal cases.)
      const role: "pitcher" | "catcher" =
        p.out_player_id === state.current_pitcher_id ? "pitcher" : "catcher";
      return {
        ...state,
        bases,
        courtesy_runners_used: [
          ...state.courtesy_runners_used,
          { runner_player_id: p.in_player_id, role, inning: state.inning },
        ],
      };
    }
    case "re_entry": {
      // Starter returning to their original slot. The engine accepts the
      // event; the UI should validate eligibility before emitting (a
      // non-eligible re_entry that slips through here will still fold —
      // we don't reject — but the lineup state will reflect the swap).
      // Restores is_starter only when the incoming player matches the
      // slot's original_player_id (PDF/NFHS 3-1-3); otherwise the sub
      // remains a non-starter even though re_entered is set.
      const our_lineup = state.our_lineup.map((slot) =>
        slot.batting_order === p.batting_order
          ? {
              ...slot,
              player_id: p.in_player_id,
              position: p.position ?? slot.position,
              re_entered: true,
              is_starter: slot.original_player_id === p.in_player_id,
            }
          : slot,
      );
      return { ...state, our_lineup };
    }
    default:
      return state;
  }
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
    current_balls: 0,
    current_strikes: 0,
    current_pa_pitches: [],
  };
}

function applyPitch(state: ReplayState, p: PitchPayload): ReplayState {
  let balls = state.current_balls;
  let strikes = state.current_strikes;
  if (p.pitch_type === "ball" || p.pitch_type === "pitchout" || p.pitch_type === "intentional_ball") {
    balls = Math.min(4, balls + 1);
  } else if (
    p.pitch_type === "called_strike"
    || p.pitch_type === "swinging_strike"
    || p.pitch_type === "foul_tip_caught"
  ) {
    strikes = Math.min(3, strikes + 1);
  } else if (p.pitch_type === "foul") {
    if (strikes < 2) strikes += 1;
  }
  // in_play and hbp don't change the count display; the at_bat event resolves it.
  return {
    ...state,
    current_balls: balls,
    current_strikes: strikes,
    current_pa_pitches: [...state.current_pa_pitches, p],
  };
}

function applyDefensiveConference(
  state: ReplayState,
  p: DefensiveConferencePayload,
): ReplayState {
  return {
    ...state,
    defensive_conferences: [
      ...state.defensive_conferences,
      { pitcher_id: p.pitcher_id, inning: p.inning },
    ],
  };
}

// ---- Mid-PA running events -------------------------------------------------

function applyStolenBase(state: ReplayState, eventId: string, p: StolenBasePayload): ReplayState {
  const sourceRunner = state.bases[p.from];
  const runnerId = sourceRunner?.player_id ?? p.runner_id ?? null;
  const catcherId = ourCatcherIfFielding(state);
  const bases: Bases = { ...state.bases };
  bases[p.from] = null;
  let runsScored = 0;
  if (p.to === "home") {
    runsScored = 1;
  } else {
    bases[p.to] = sourceRunner
      ? sourceRunner
      : makeBaseRunner(p.runner_id ?? "", pitcherOfRecordFor(state), false);
  }
  const credited = creditRunningEvent(state, eventId, "stolen_base", bases, runsScored, 0);
  return {
    ...credited,
    stolen_bases: [
      ...state.stolen_bases,
      { runner_id: runnerId, event_id: eventId, catcher_id: catcherId },
    ],
  };
}

function applyCaughtStealing(state: ReplayState, eventId: string, p: CaughtStealingPayload): ReplayState {
  const sourceRunner = state.bases[p.from];
  const runnerId = sourceRunner?.player_id ?? p.runner_id ?? null;
  const catcherId = ourCatcherIfFielding(state);
  const bases: Bases = { ...state.bases };
  bases[p.from] = null;
  const credited = creditRunningEvent(state, eventId, "stolen_base", bases, 0, 1);
  return {
    ...credited,
    caught_stealing: [
      ...state.caught_stealing,
      { runner_id: runnerId, event_id: eventId, catcher_id: catcherId },
    ],
  };
}

function applyPickoff(state: ReplayState, eventId: string, p: PickoffPayload): ReplayState {
  const sourceRunner = state.bases[p.from];
  const runnerId = sourceRunner?.player_id ?? p.runner_id ?? null;
  const catcherId = ourCatcherIfFielding(state);
  const bases: Bases = { ...state.bases };
  bases[p.from] = null;
  const credited = creditRunningEvent(state, eventId, "stolen_base", bases, 0, 1);
  return {
    ...credited,
    pickoffs: [
      ...state.pickoffs,
      { runner_id: runnerId, event_id: eventId, catcher_id: catcherId },
    ],
  };
}

function applyRunnerMove(
  state: ReplayState,
  eventId: string,
  source: NonPaRunSource,
  p: RunnerMovePayload,
): ReplayState {
  // PB and error_advance taint the runner so a downstream score is
  // unearned (PDF §17, criteria 1 & 2). WP/balk runs are earned, so they
  // do NOT taint the runner.
  const taint = source === "passed_ball" || source === "error_advance";
  const catcherId = source === "passed_ball" ? ourCatcherIfFielding(state) : null;
  const { bases, runsScored, outsAdded } = applyAdvances(
    state.bases,
    p.advances,
    pitcherOfRecordFor(state),
    taint,
  );
  const credited = creditRunningEvent(state, eventId, source, bases, runsScored, outsAdded);
  if (source === "passed_ball") {
    return {
      ...credited,
      passed_balls: [
        ...state.passed_balls,
        { event_id: eventId, catcher_id: catcherId },
      ],
    };
  }
  return credited;
}

// Shared bookkeeping for non-PA events: route runs to whichever team is
// batting in the current half, accumulate outs. When the opposing team
// scores on the play, attribute the run(s) to our pitcher of record so
// the rollup can credit pitcher R.
function creditRunningEvent(
  state: ReplayState,
  eventId: string,
  source: NonPaRunSource,
  bases: Bases,
  runsScored: number,
  outsAdded: number,
): ReplayState {
  const weAreBatting = isOurHalf(state.we_are_home, state.half);
  const next: ReplayState = {
    ...state,
    bases,
    outs: state.outs + outsAdded,
    team_score: weAreBatting ? state.team_score + runsScored : state.team_score,
    opponent_score: weAreBatting ? state.opponent_score : state.opponent_score + runsScored,
  };
  // Pitcher R only matters when our pitcher is on the mound — i.e., the
  // opposing team is batting (we're fielding). Eventid empty → SB/CS/PO,
  // which we still attribute (eventId surfaced from caller for traceability).
  if (!weAreBatting && runsScored > 0 && state.current_pitcher_id) {
    next.non_pa_runs = [
      ...state.non_pa_runs,
      { event_id: eventId, pitcher_id: state.current_pitcher_id, runs: runsScored, source },
    ];
  }
  return next;
}

// Apply a list of runner advances (with `from` always a base name —
// `batter` is not valid here since these events run between PAs).
// `defaultPitcherId` is used only as a fallback if the source base is
// unexpectedly empty; normally the runner's pitcher_of_record carries
// over. `taint` marks destinations as `reached_on_error` (used for PB
// and error_advance).
function applyAdvances(
  prev: Bases,
  advances: RunnerAdvance[],
  defaultPitcherId: string | null,
  taint: boolean,
): { bases: Bases; runsScored: number; outsAdded: number } {
  const next: Bases = { ...prev };
  // Snapshot source bases before any clearing so we can preserve
  // pitcher_of_record_id and reached_on_error across the move.
  const snapshot: Record<Base, BaseRunner | null> = {
    first: prev.first,
    second: prev.second,
    third: prev.third,
  };
  let runsScored = 0;
  let outsAdded = 0;
  const cleared: Record<Base, boolean> = {
    first: false, second: false, third: false,
  };
  for (const adv of advances) {
    if (adv.from === "batter") continue; // not meaningful between PAs
    if (!cleared[adv.from]) {
      next[adv.from] = null;
      cleared[adv.from] = true;
    }
    if (adv.to === "home") {
      runsScored += 1;
    } else if (adv.to === "out") {
      outsAdded += 1;
    } else {
      const src = snapshot[adv.from];
      const playerId = adv.player_id ?? src?.player_id ?? null;
      if (playerId === null) continue;
      next[adv.to] = {
        player_id: playerId,
        pitcher_of_record_id: src?.pitcher_of_record_id ?? defaultPitcherId,
        reached_on_error: taint || (src?.reached_on_error ?? false),
      };
    }
  }
  return { bases: next, runsScored, outsAdded };
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
// `pitcherOfRecord` is the pitcher to credit when the BATTER reaches a
// base (since the batter is reaching for the first time). Existing
// runners moving from base to base preserve their own pitcher_of_record.
//
// If `runner_advances` is empty (e.g., a strikeout with no runners moved),
// we fall back to DEFAULT_OUTS_FOR to charge the standard outs for the
// outcome.
function resolveRunnerAdvances(
  prev: Bases,
  p: AtBatPayload,
  pitcherOfRecord: string | null,
): ResolvedAdvances {
  const next: Bases = { ...prev };
  // Snapshot source bases before any clearing so we can preserve each
  // existing runner's pitcher_of_record_id and reached_on_error across
  // the move.
  const snapshot: Record<Base, BaseRunner | null> = {
    first: prev.first,
    second: prev.second,
    third: prev.third,
  };
  // The batter reached due to an error in any of these cases:
  //   - result === "E"
  //   - K3-reach via dropped strike on PB or E (WP=earned, so not tainted)
  // PDF §17, criteria 1 and 2 (errors and passed balls).
  //
  // K3 with dropped strike on PB or E ALSO taints any other runners
  // who advance on the play — without the error/PB, the K3 would have
  // ended the play and they wouldn't have moved at all (PDF §17 #2/#4).
  // Regular result === "E" only taints the batter; other runners'
  // movement on a batted-ball E is judgment-call territory (PDF §17 #4).
  const k3DroppedTaint =
    p.batter_reached_on_k3 === "E" || p.batter_reached_on_k3 === "PB";
  const batterReachedOnError = p.result === "E" || k3DroppedTaint;
  let runsScored = 0;
  let outsAdded = 0;

  const cleared: Record<Base, boolean> = {
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
      if (adv.from === "batter") {
        if (adv.player_id === null) continue;
        next[adv.to] = makeBaseRunner(
          adv.player_id,
          pitcherOfRecord,
          batterReachedOnError,
        );
      } else {
        const src = snapshot[adv.from];
        const playerId = adv.player_id ?? src?.player_id ?? null;
        if (playerId === null) continue;
        next[adv.to] = {
          player_id: playerId,
          pitcher_of_record_id: src?.pitcher_of_record_id ?? pitcherOfRecord,
          reached_on_error: k3DroppedTaint || (src?.reached_on_error ?? false),
        };
      }
    }
  }

  // Implicit outs for outcomes the UI didn't enumerate (e.g., a clean K).
  if (p.runner_advances.length === 0) {
    outsAdded = DEFAULT_OUTS_FOR[p.result] ?? 0;
  }

  return { bases: next, runsScored, outsAdded };
}

// Pitcher of record from the offense's perspective: the pitcher facing
// the batting team in the current half-inning.
function pitcherOfRecordFor(state: ReplayState): string | null {
  const weAreBatting = isOurHalf(state.we_are_home, state.half);
  return weAreBatting ? state.current_opponent_pitcher_id : state.current_pitcher_id;
}

function makeBaseRunner(
  playerId: string,
  pitcherOfRecordId: string | null,
  reachedOnError: boolean,
): BaseRunner {
  return { player_id: playerId, pitcher_of_record_id: pitcherOfRecordId, reached_on_error: reachedOnError };
}

// Returns our catcher (player_id at position 'C' in our_lineup) when the
// half is opponent's bat (we're fielding). Returns null when we're batting
// — the catcher in play is the opponent's and we don't track them.
function ourCatcherIfFielding(state: ReplayState): string | null {
  if (isOurHalf(state.we_are_home, state.half)) return null;
  for (const slot of state.our_lineup) {
    if (slot.position === "C" && slot.player_id) return slot.player_id;
  }
  return null;
}

// Returns the player_id occupying `fielderPosition` in our current
// defensive lineup. For 'P' we ALWAYS prefer current_pitcher_id over the
// lineup slot — pitching_change updates current_pitcher_id but doesn't
// touch the lineup, so a stale slot at 'P' would otherwise yield the
// outgoing pitcher.
function resolveFielderPlayerId(state: ReplayState, fielderPosition: string): string | null {
  if (fielderPosition === "P") return state.current_pitcher_id;
  for (const slot of state.our_lineup) {
    if (slot.position === fielderPosition && slot.player_id) return slot.player_id;
  }
  return null;
}

// Snapshot of every player currently fielding a position for us. The
// pitcher is always credited at 'P' via current_pitcher_id; lineup slots
// at 'P' are skipped to avoid double-counting after a pitching_change
// that left the slot stale (use_dh=false case).
function defensivePositionsAtMoment(
  state: ReplayState,
): Array<{ player_id: string; position: string }> {
  const out: Array<{ player_id: string; position: string }> = [];
  for (const slot of state.our_lineup) {
    if (slot.position && slot.player_id && slot.position !== "P") {
      out.push({ player_id: slot.player_id, position: slot.position });
    }
  }
  if (state.current_pitcher_id) {
    out.push({ player_id: state.current_pitcher_id, position: "P" });
  }
  return out;
}

export { INITIAL_STATE } from "./types";
