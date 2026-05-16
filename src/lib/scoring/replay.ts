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
  DefensivePosition,
  DefensiveSlot,
  DerivedAtBat,
  GameEventRecord,
  GameStartedPayload,
  InningEndPayload,
  LineupSlot,
  NonPaRunSource,
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

// Canonical defensive positions in slot order. DH is intentionally omitted
// (the DH doesn't field). Position strings coming off the field-position
// payloads can be loose ("1", "P", "1b") so we normalize them through
// `normalizeDefensivePosition` before keying into the lineup.
const DEFENSIVE_POSITIONS: readonly DefensivePosition[] = [
  "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF",
];

function normalizeDefensivePosition(raw: string | null | undefined): DefensivePosition | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  // Numeric scorebook shorthand: 1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF.
  switch (upper) {
    case "1": case "P": return "P";
    case "2": case "C": return "C";
    case "3": case "1B": return "1B";
    case "4": case "2B": return "2B";
    case "5": case "3B": return "3B";
    case "6": case "SS": return "SS";
    case "7": case "LF": return "LF";
    case "8": case "CF": return "CF";
    case "9": case "RF": return "RF";
    default: return null;
  }
}

function buildDefensiveLineup(lineup: LineupSlot[]): DefensiveSlot[] {
  // Initialize a slot for every position so the lineup is exhaustive even
  // when the input lineup omits a position (e.g., DH games where a player
  // doesn't field). Missing positions stay player_id: null and the rollup
  // will simply credit nobody for plays at that position.
  const byPos = new Map<DefensivePosition, string | null>();
  for (const pos of DEFENSIVE_POSITIONS) byPos.set(pos, null);
  for (const slot of lineup) {
    const norm = normalizeDefensivePosition(slot.position);
    if (!norm) continue;
    byPos.set(norm, slot.player_id);
  }
  return DEFENSIVE_POSITIONS.map((position) => ({
    position,
    player_id: byPos.get(position) ?? null,
  }));
}

function setDefensiveSlot(
  lineup: DefensiveSlot[],
  position: DefensivePosition,
  playerId: string | null,
): DefensiveSlot[] {
  // If the player is taking a new position, clear them from any other
  // position they were occupying (a single player can't field two spots).
  return lineup.map((slot) => {
    if (slot.position === position) {
      return { ...slot, player_id: playerId };
    }
    if (playerId !== null && slot.player_id === playerId) {
      return { ...slot, player_id: null };
    }
    return slot;
  });
}

function countRunners(bases: Bases): number {
  return (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0);
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
    our_defensive_lineup: [],
    at_bats: [],
    current_pa_pitches: [],
    non_pa_runs: [],
  };

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
    our_defensive_lineup: state.our_defensive_lineup.map((s) => ({ ...s })),
    at_bats: state.at_bats,
    current_pa_pitches: state.current_pa_pitches,
    non_pa_runs: state.non_pa_runs,
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
      return applyStolenBase(next, event.payload as StolenBasePayload);
    case "caught_stealing":
      return applyCaughtStealing(next, event.payload as CaughtStealingPayload);
    case "pickoff":
      return applyPickoff(next, event.payload as PickoffPayload);
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
  // Seed the defensive lineup from the starting batting order's positions.
  // In a DH game the starting_pitcher_id may not appear in the batting
  // lineup, so layer the pitcher onto the "P" slot after to be safe.
  let defensiveLineup = buildDefensiveLineup(p.starting_lineup);
  if (p.starting_pitcher_id) {
    defensiveLineup = setDefensiveSlot(defensiveLineup, "P", p.starting_pitcher_id);
  }
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
    our_defensive_lineup: defensiveLineup,
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
  const pitcherOfRecord = weAreBatting
    ? state.current_opponent_pitcher_id
    : state.current_pitcher_id;
  const basesBefore: Bases = { ...state.bases };
  const { bases, runsScored, outsAdded } = resolveRunnerAdvances(state.bases, p, pitcherOfRecord);

  const team_score = weAreBatting ? state.team_score + runsScored : state.team_score;
  const opponent_score = weAreBatting ? state.opponent_score : state.opponent_score + runsScored;

  // Advance the batter slot only when our team batted. Wrap 9 → 1.
  const lineupSize = state.our_lineup.length || 9;
  const next_batter_slot =
    weAreBatting && state.current_batter_slot !== null
      ? (state.current_batter_slot % lineupSize) + 1
      : state.current_batter_slot;

  // Pitch trail: when present, derive count from it; otherwise fall back
  // to the payload values for backward compatibility.
  const trail = state.current_pa_pitches;
  const trailCount = countFromPitches(trail);
  const usingTrail = trail.length > 0;
  // LOB credit goes to the batter who made the third out. This play ends
  // the half when outs cross from <3 to ≥3; the stranded runners are those
  // still on `bases` (post-play) — runners who scored or were put out are
  // already off. Only credit when our pitcher is on the mound? No — LOB
  // is a batting stat for the batter who made the out, regardless of
  // which team is batting. The rollup filters by batter_id presence.
  const endsHalf = state.outs < 3 && state.outs + outsAdded >= 3;
  const lobOnPlay = endsHalf ? countRunners(bases) : 0;

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
    pitch_count: usingTrail ? trail.length : p.pitch_count,
    balls: usingTrail ? trailCount.balls : (p.balls ?? 0),
    strikes: usingTrail ? trailCount.strikes : (p.strikes ?? 0),
    spray_x: p.spray_x,
    spray_y: p.spray_y,
    fielder_position: p.fielder_position,
    runs_scored_on_play: runsScored,
    outs_recorded: outsAdded,
    runner_advances: p.runner_advances,
    pitcher_of_record_id: pitcherOfRecord,
    bases_before: basesBefore,
    description: p.description,
    pitches: trail.slice(),
    batter_reached_on_k3: p.batter_reached_on_k3,
    defensive_lineup_snapshot: state.our_defensive_lineup.map((s) => ({ ...s })),
    lob_on_play: lobOnPlay,
  };

  return {
    ...state,
    status: state.status === "draft" ? "in_progress" : state.status,
    bases,
    outs: state.outs + outsAdded,
    team_score,
    opponent_score,
    current_batter_slot: next_batter_slot,
    last_play_text: p.description,
    at_bats: [...state.at_bats, derived],
    current_balls: 0,
    current_strikes: 0,
    current_pa_pitches: [],
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
  // Defensive substitutions: any sub that carries a position string moves
  // the incoming player into that field slot (and clears them from any
  // previous one). Offensive-only subs (pinch_run, courtesy_run) skip this
  // step. pinch_hit usually has position=null; if a position IS provided
  // the PH is taking the field after batting, so honor it.
  const defensiveSubTypes: SubstitutionPayload["sub_type"][] = ["regular", "pinch_hit", "re_entry"];
  const normPos = defensiveSubTypes.includes(p.sub_type)
    ? normalizeDefensivePosition(p.position)
    : null;
  const updatedDefense = normPos
    ? setDefensiveSlot(state.our_defensive_lineup, normPos, p.in_player_id)
    : state.our_defensive_lineup;

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
      return { ...state, our_lineup, our_defensive_lineup: updatedDefense };
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
      return { ...state, our_lineup, our_defensive_lineup: updatedDefense };
    }
    default:
      return state;
  }
}

function applyPitchingChange(state: ReplayState, p: PitchingChangePayload): ReplayState {
  // Mirror the change on the defensive lineup so fielding stats credit
  // the right pitcher for plays at the mound after this point.
  const our_defensive_lineup = setDefensiveSlot(
    state.our_defensive_lineup,
    "P",
    p.in_pitcher_id,
  );
  return { ...state, current_pitcher_id: p.in_pitcher_id, our_defensive_lineup };
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

function applyStolenBase(state: ReplayState, p: StolenBasePayload): ReplayState {
  const sourceRunner = state.bases[p.from];
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
  return creditRunningEvent(state, "", "stolen_base", bases, runsScored, 0);
}

function applyCaughtStealing(state: ReplayState, p: CaughtStealingPayload): ReplayState {
  const bases: Bases = { ...state.bases };
  bases[p.from] = null;
  return creditRunningEvent(state, "", "stolen_base", bases, 0, 1);
}

function applyPickoff(state: ReplayState, p: PickoffPayload): ReplayState {
  const bases: Bases = { ...state.bases };
  bases[p.from] = null;
  return creditRunningEvent(state, "", "stolen_base", bases, 0, 1);
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
  const { bases, runsScored, outsAdded } = applyAdvances(
    state.bases,
    p.advances,
    pitcherOfRecordFor(state),
    taint,
  );
  return creditRunningEvent(state, eventId, source, bases, runsScored, outsAdded);
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

export { INITIAL_STATE } from "./types";
