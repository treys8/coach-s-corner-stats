// Server-side glue around the pure replay engine. Persists one or more
// game events in a single transaction, replays the whole game, and writes
// canonical at_bats + game_live_state. Runs from API routes only.
//
// One tablet tap may emit up to three events in one call:
//   - a pitch
//   - + a closing at_bat (if the pitch closes the PA: 3-ball, 2-strike
//     decisive, HBP)
//   - + an inning_end (if the closing PA brings outs to 3)
//
// All inserts go through the `apply_game_events` SECURITY DEFINER RPC,
// which gates on team membership and runs the batch as a single Postgres
// transaction. The user-scoped client is passed so auth.uid() inside the
// function matches the calling coach.
//
// Derived tables (at_bats, game_live_state) have no client write policy
// and are written by the admin client inside `rederive`.
//
// stat_snapshots writes are gated to status === "final" (and to
// un-finalize via a correction touching game_finalized) so in-progress
// pitches and at-bats no longer churn that table.
//
// `applyEvent` is the public entry point — the API route calls it with
// the single primary event the tablet sent; we derive the rest.

import { adminClient } from "@/lib/supabase/admin";
import { startSpan } from "@/lib/perf/log";
import { defaultAdvances } from "./advances";
import { autoRBI, describePlay, finalCount } from "./at-bat-helpers";
import { applyEvent as foldEvent, replay } from "./replay";
import { computeWLS, rollupBatting, rollupFielding, rollupPitching } from "./rollup";
import type {
  AtBatPayload,
  AtBatResult,
  GameEventPayload,
  GameEventRecord,
  InningEndPayload,
  PitchPayload,
  PitchType,
  ReplayState,
} from "./types";
import type { GameEventType } from "@/integrations/supabase/types";
import { isForbiddenError } from "@/lib/api/errors";

// Accepts any of the project's Supabase clients (server/SSR/admin) without
// pinning to a specific generic instantiation, which varies between
// @supabase/ssr and @supabase/supabase-js.
type AnyClient = any;

// Columns the replay reducer + at_bats upsert actually read. Used by both
// the applyEvent pre-state fetch and the rederive fallback path so neither
// pulls `created_by` (and any future ancillary columns) that aren't on the
// hot path. The persisted rows returned by `apply_game_events` still carry
// `created_by` since the RPC selects it for downstream API responses.
const EVENT_COLUMNS =
  "id, game_id, client_event_id, sequence_number, event_type, payload, supersedes_event_id, created_at";

export interface IncomingEvent {
  client_event_id: string;
  event_type: GameEventType;
  payload: GameEventPayload;
  supersedes_event_id?: string | null;
}

export interface ApplyEventResult {
  /** Events persisted by this call. The primary event plus any
   *  server-derived chain (closing at_bat, auto inning_end). */
  events: GameEventRecord[];
  /** Replay state after all events were applied. */
  state: ReplayState;
  /** True if any event in the chain was already persisted (idempotent retry). */
  duplicate: boolean;
}

// Row shape returned by apply_game_events. Mirrors game_events with an
// extra was_duplicate flag.
interface AppliedRow {
  id: string;
  game_id: string;
  client_event_id: string;
  sequence_number: number;
  event_type: GameEventType;
  payload: GameEventPayload;
  supersedes_event_id: string | null;
  created_by: string | null;
  created_at: string;
  was_duplicate: boolean;
}

// ---- Chain derivation ------------------------------------------------------

// Mirrors the former client-side closingResultForPitch from
// use-live-scoring.ts. Decided from the PRE-pitch state so the closing
// outcome reflects what the pitch transitioned into, not the post-fold view.
function closingResultForPitch(
  pitchType: PitchType,
  prev: ReplayState,
): AtBatResult | null {
  if (pitchType === "ball" && prev.current_balls === 3) return "BB";
  if (pitchType === "pitchout" && prev.current_balls === 3) return "BB";
  if (pitchType === "intentional_ball" && prev.current_balls === 3) return "IBB";
  if (pitchType === "called_strike" && prev.current_strikes === 2) return "K_looking";
  if (pitchType === "swinging_strike" && prev.current_strikes === 2) return "K_swinging";
  if (pitchType === "foul_tip_caught" && prev.current_strikes === 2) return "K_swinging";
  if (pitchType === "hbp") return "HBP";
  return null;
}

function isOurHalfOf(weAreHome: boolean, half: "top" | "bottom"): boolean {
  return weAreHome ? half === "bottom" : half === "top";
}

// One-shot lookup for the current batter's display name. Only needed when
// our team is batting on a closing pitch — opp gets the "(opp)" fallback
// in describePlay. Returns null if the player can't be resolved; the
// description will read "by us" which is the same fallback the client
// already produces for missing roster entries.
//
// Phase 4 perf note: this fires once per closing pitch (~3-4 per game in
// our half), bounded by O(at_bats) — not a true N+1. Cleanest fix
// (state-cached lineup names) requires growing the wire format on
// game_started + substitution to carry display names, which we deferred
// rather than couple to this performance pass. Phase 1 instrumentation
// (rpc_apply_ms) will surface whether this fetch is a real cost; revisit
// if so.
async function fetchOurBatterName(
  admin: AnyClient,
  playerId: string | null,
): Promise<string | null> {
  if (!playerId) return null;
  const { data } = await admin
    .from("players")
    .select("first_name, last_name, jersey_number")
    .eq("id", playerId)
    .single();
  if (!data) return null;
  const num = data.jersey_number ? `#${data.jersey_number} ` : "";
  return `${num}${data.first_name} ${data.last_name}`;
}

async function buildClosingAtBat(
  admin: AnyClient,
  prev: ReplayState,
  closing: AtBatResult,
  newSeq: number,
): Promise<IncomingEvent> {
  const weAreBatting = isOurHalfOf(prev.we_are_home, prev.half);
  const currentSlot =
    prev.our_lineup.find((s) => s.batting_order === prev.current_batter_slot) ?? null;
  const currentOppSlot =
    prev.opposing_lineup.find((s) => s.batting_order === prev.current_opp_batter_slot) ?? null;
  const ourBatterId = weAreBatting ? currentSlot?.player_id ?? null : null;
  const oppBatterId = !weAreBatting ? currentOppSlot?.opponent_player_id ?? null : null;

  // Synthesize a non-null reachId when the opposing team bats without a
  // populated lineup, so a closing BB/HBP still lights the base. Phase 4
  // eliminates these at the source via a symmetric pre-game lineup gate.
  const reachId = weAreBatting
    ? ourBatterId
    : oppBatterId ?? `opp-pa-${prev.inning}-${prev.half}-${newSeq}`;

  const advances = defaultAdvances(prev.bases, reachId, closing);
  const runs = advances.filter((a) => a.to === "home").length;
  const rbi = autoRBI(advances, closing, prev.bases);
  const fallback = finalCount(closing, prev.current_balls, prev.current_strikes);

  // Description: only resolve our-batter name. Opp batter takes the
  // "(opp)" branch in describePlay without a names map entry.
  const namesMap = new Map<string, string>();
  if (weAreBatting && ourBatterId) {
    const ourName = await fetchOurBatterName(admin, ourBatterId);
    if (ourName) namesMap.set(ourBatterId, ourName);
  }

  const payload: AtBatPayload = {
    inning: prev.inning,
    half: prev.half,
    batter_id: ourBatterId,
    opponent_batter_id: oppBatterId,
    pitcher_id: weAreBatting ? null : prev.current_pitcher_id,
    opponent_pitcher_id: weAreBatting ? prev.current_opponent_pitcher_id : null,
    batting_order: weAreBatting ? prev.current_batter_slot : prev.current_opp_batter_slot,
    result: closing,
    rbi,
    pitch_count: fallback.balls + fallback.strikes,
    balls: fallback.balls,
    strikes: fallback.strikes,
    spray_x: null,
    spray_y: null,
    fielder_position: null,
    runner_advances: advances,
    description: describePlay(closing, runs, ourBatterId, namesMap),
  };

  return {
    client_event_id: `ab-auto-${prev.inning}-${prev.half}-${newSeq}`,
    event_type: "at_bat",
    payload,
  };
}

function buildInningEnd(prev: ReplayState, newSeq: number): IncomingEvent {
  return {
    client_event_id: `ie-auto-${prev.inning}-${prev.half}-${newSeq}`,
    event_type: "inning_end",
    payload: { inning: prev.inning, half: prev.half } as InningEndPayload,
  };
}

// Synthetic GameEventRecord for in-memory folding during chain projection.
// applyEvent (replay reducer) only reads event_type, payload, id, created_at
// — sequence_number is informational. We use a placeholder for unpersisted
// chain entries so the projected state is correct before we hit the DB.
function syntheticRecord(e: IncomingEvent, seq: number, gameId: string): GameEventRecord {
  return {
    id: `synthetic-${e.client_event_id}`,
    game_id: gameId,
    client_event_id: e.client_event_id,
    sequence_number: seq,
    event_type: e.event_type,
    payload: e.payload,
    supersedes_event_id: e.supersedes_event_id ?? null,
    created_by: null,
    created_at: new Date().toISOString(),
  } as unknown as GameEventRecord;
}

// Build the JSONB payload write_derived_state consumes. The at_bats list is
// keyed by the originating event's client_event_id (rather than event_id)
// because state may have been computed pre-RPC with synthetic ids; the SQL
// function resolves to real event_id via game_events. Each at_bat must
// correspond to exactly one event in `events`.
function buildDerivedPayload(
  state: ReplayState,
  events: GameEventRecord[],
): Record<string, unknown> {
  const idToClientId = new Map<string, string>(
    events.map((e) => [e.id, e.client_event_id]),
  );

  // runner_first/second/third are FK'd to players(id), so only emit them when
  // our team is batting. When the opposing team is batting, the player_ids on
  // base are either opponent_players UUIDs or synthesized per-PA strings —
  // both would break the FK / UUID column. inning_end clears bases, so the
  // invariant "runners on base belong to the team batting this half" holds.
  const weAreBatting =
    state.we_are_home ? state.half === "bottom" : state.half === "top";

  const live = {
    inning: state.inning,
    half: state.half,
    outs: state.outs,
    runner_first: weAreBatting ? state.bases.first?.player_id ?? null : null,
    runner_second: weAreBatting ? state.bases.second?.player_id ?? null : null,
    runner_third: weAreBatting ? state.bases.third?.player_id ?? null : null,
    team_score: state.team_score,
    opponent_score: state.opponent_score,
    last_play_text: state.last_play_text,
    last_event_at: state.last_event_at,
  };

  const at_bats = state.at_bats.map((ab) => {
    let clientEventId: string | undefined;
    if (ab.event_id.startsWith("synthetic-")) {
      clientEventId = ab.event_id.slice("synthetic-".length);
    } else {
      clientEventId = idToClientId.get(ab.event_id);
    }
    if (!clientEventId) {
      throw new Error(`buildDerivedPayload: cannot resolve client_event_id for at_bat event_id=${ab.event_id}`);
    }
    return {
      client_event_id: clientEventId,
      inning: ab.inning,
      half: ab.half,
      batting_order: ab.batting_order,
      batter_id: ab.batter_id,
      opponent_batter_id: ab.opponent_batter_id,
      pitcher_id: ab.pitcher_id,
      opponent_pitcher_id: ab.opponent_pitcher_id,
      result: ab.result,
      rbi: ab.rbi,
      pitch_count: ab.pitch_count,
      balls: ab.balls,
      strikes: ab.strikes,
      spray_x: ab.spray_x,
      spray_y: ab.spray_y,
      fielder_position: ab.fielder_position,
      runs_scored_on_play: ab.runs_scored_on_play,
      outs_recorded: ab.outs_recorded,
      description: ab.description,
    };
  });

  // Reflect the game lifecycle on `games.status` so the existing /scores
  // query (and future LIVE-tile filter) sees the right state. When the
  // game is finalized via tablet, also write the score and result back
  // so /scores can read everything from the games table (it falls back
  // to game_live_state only for in-progress tiles). Null while still draft.
  let game_update:
    | {
        status: typeof state.status;
        team_score?: number;
        opponent_score?: number;
        result?: "W" | "L" | "T";
      }
    | null = null;
  if (state.status !== "draft") {
    game_update = { status: state.status };
    if (state.status === "final") {
      game_update.team_score = state.team_score;
      game_update.opponent_score = state.opponent_score;
      game_update.result =
        state.team_score > state.opponent_score ? "W"
        : state.team_score < state.opponent_score ? "L"
        : "T";
    }
  }

  return { live, at_bats, game_update };
}

// ---- Public entry point ----------------------------------------------------

/**
 * Persist an event (plus any server-derived chained events), run replay,
 * and write derived state.
 *
 * @param userClient  request-scoped supabase client; the RPC's auth.uid()
 *                    sees this caller and gates on team membership.
 * @param gameId      game the event belongs to.
 * @param incoming    primary event payload from the tablet.
 */
export async function applyEvent(
  userClient: AnyClient,
  gameId: string,
  incoming: IncomingEvent,
): Promise<ApplyEventResult> {
  const admin = adminClient();
  const perf = startSpan("scoring.applyEvent", {
    game_id: gameId,
    event_type: incoming.event_type,
  });

  try {
    // 1. Compute state before the new event so chain derivation matches the
    //    pre-pitch view.
    const eventsRes = await admin
      .from("game_events")
      .select(EVENT_COLUMNS)
      .eq("game_id", gameId)
      .order("sequence_number", { ascending: true });
    if (eventsRes.error) {
      throw new Error(`game_events fetch failed: ${eventsRes.error.message}`);
    }
    perf.mark("events_fetch");
    const existing = (eventsRes.data ?? []) as unknown as GameEventRecord[];
    const stateBefore = replay(existing);
    perf.mark("replay_pre");
    const baseSeq = existing.reduce((m, e) => Math.max(m, e.sequence_number), 0);

    // 2. Build the chain. Start with the primary event; append the closing
    //    at_bat if the pitch closes the PA; append auto inning_end if the
    //    projected outs hit 3 and we're still in_progress.
    const chain: IncomingEvent[] = [incoming];
    let projectedSeq = baseSeq + 1;
    let projected: ReplayState = foldEvent(
      stateBefore,
      syntheticRecord(incoming, projectedSeq, gameId),
    );

    if (incoming.event_type === "pitch") {
      const pitchPayload = incoming.payload as PitchPayload;
      const closing = closingResultForPitch(pitchPayload.pitch_type, stateBefore);
      if (closing) {
        projectedSeq += 1;
        const abEvent = await buildClosingAtBat(admin, stateBefore, closing, projectedSeq);
        chain.push(abEvent);
        projected = foldEvent(projected, syntheticRecord(abEvent, projectedSeq, gameId));
      }
    }

    const lastInChain = chain[chain.length - 1];
    // Skip auto-end-half for corrections: the reducer re-applies a non-void
    // correction's payload on top of state that already includes the
    // original event (replay()'s supersession filter doesn't run in the
    // single-event fold), so projected.outs can be wrong. Matches the
    // pre-Phase-2 client behavior — editLastPlay/submitUndo never triggered
    // maybeAutoEndHalf. Coach can tap End ½ manually after an edit if needed.
    if (
      incoming.event_type !== "correction" &&
      stateBefore.outs < 3 &&
      projected.outs >= 3 &&
      projected.status === "in_progress" &&
      lastInChain.event_type !== "inning_end"
    ) {
      projectedSeq += 1;
      const ieEvent = buildInningEnd(projected, projectedSeq);
      chain.push(ieEvent);
    }

    // 3. Atomic batched insert via SECURITY DEFINER RPC. The function
    //    re-enforces team-membership using auth.uid() and runs all inserts
    //    in one transaction — partial failure rolls back the whole chain.
    const rpcRes = await userClient.rpc("apply_game_events", {
      p_game_id: gameId,
      p_events: chain.map((e) => ({
        client_event_id: e.client_event_id,
        event_type: e.event_type,
        payload: e.payload,
        supersedes_event_id: e.supersedes_event_id ?? null,
      })),
    });
    perf.mark("rpc_apply");

    if (rpcRes.error) {
      const msg = rpcRes.error.message ?? "unknown";
      // SECURITY DEFINER RAISE with 42501 surfaces here on auth failure.
      // The API route maps this to a 403 via apiErrorFromException.
      if (isForbiddenError(rpcRes.error)) {
        throw new Error(`forbidden: ${msg}`);
      }
      throw new Error(`apply_game_events RPC failed: ${msg}`);
    }

    const rows = (rpcRes.data ?? []) as AppliedRow[];
    if (rows.length === 0) {
      throw new Error("apply_game_events returned no rows");
    }

    const events: GameEventRecord[] = rows.map((r) => ({
      id: r.id,
      game_id: r.game_id,
      client_event_id: r.client_event_id,
      sequence_number: r.sequence_number,
      event_type: r.event_type,
      payload: r.payload,
      supersedes_event_id: r.supersedes_event_id,
      created_by: r.created_by,
      created_at: r.created_at,
    })) as unknown as GameEventRecord[];
    const duplicate = rows.some((r) => r.was_duplicate);

    // 4. Fast path: fold the persisted rows onto stateBefore to get the
    //    canonical post-chain state without re-fetching every event and
    //    running replay() a second time. The persisted rows carry their
    //    real ids / sequence_numbers / created_at from the RPC, so the
    //    resulting at_bats reference correct event_ids for upsert.
    //
    //    Slow path is required when supersession matters:
    //    - Correction events re-apply a non-void payload that already exists
    //      in the prior state; replay()'s supersession filter compensates.
    //    - Any event with supersedes_event_id set (defensive — corrections
    //      are the only producer today, but the column allows it elsewhere).
    //    - Idempotent retries: when the RPC reports a duplicate, the
    //      "new" event was already counted in stateBefore, so folding it
    //      again would double-apply.
    const canSkipReplay =
      !duplicate &&
      incoming.event_type !== "correction" &&
      (incoming.supersedes_event_id ?? null) === null;

    const projectedState = canSkipReplay
      ? events.reduce<ReplayState>(foldEvent, stateBefore)
      : undefined;

    const chainTypes = chain.map((e) => e.event_type);
    const state = await rederive(gameId, {
      chainTypes,
      state: projectedState,
      events: projectedState ? [...existing, ...events] : undefined,
      userClient,
    });
    perf.mark("rederive");

    perf.finish({
      event_count: existing.length,
      chain_len: chain.length,
      duplicate,
      status: state.status,
      fast_path: canSkipReplay,
    });
    return { events, state, duplicate };
  } catch (err) {
    // finish() is idempotent, so the success path's call (above) wins when
    // we don't reach this branch. On any thrown error, emit a final span
    // so failed taps still show up in Vercel logs with the partial timing.
    perf.finish({
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * The gate that decides whether rederive() touches stat_snapshots.
 *
 * Rebuild always when the game is currently final — every event in a final
 * game must rebuild snapshots so corrections to a finalized game stay in
 * sync. Also delete (but don't rebuild) when a correction or game_finalized
 * appears in the chain on a non-final game, since either can un-finalize
 * and we don't want stale tablet rows hanging around in that case.
 */
export function shouldTouchTabletSnapshots(
  status: ReplayState["status"],
  chainTypes: GameEventType[],
): boolean {
  return (
    status === "final" ||
    chainTypes.includes("correction") ||
    chainTypes.includes("game_finalized")
  );
}

interface RederiveOptions {
  /** Event types persisted in this request — used to decide whether to
   *  touch stat_snapshots when the game isn't final (un-finalize case). */
  chainTypes?: GameEventType[];
  /** Pre-computed canonical post-chain state. When provided, rederive
   *  skips the second game_events fetch + replay and writes derived state
   *  directly from this snapshot — saves a full table scan + a full
   *  reducer fold on the hot tap path. Callers must guarantee this state
   *  reflects every persisted event with correct event_ids; corrections
   *  and duplicate-replay retries must omit it and take the slow path. */
  state?: ReplayState;
  /** Required when `state` is provided. The persisted events (existing +
   *  this chain) used to build the state, needed to resolve each at_bat
   *  row's originating client_event_id for the write_derived_state RPC. */
  events?: GameEventRecord[];
  /** Request-scoped supabase client used to call write_derived_state. The
   *  RPC is SECURITY DEFINER and re-checks team membership via auth.uid(),
   *  so a user-scoped client is required. */
  userClient: AnyClient;
}

/**
 * Re-replay every event for a game and write the canonical at_bats +
 * game_live_state via the atomic write_derived_state RPC. Called from
 * applyEvent on every tap.
 */
export async function rederive(
  gameId: string,
  opts: RederiveOptions,
): Promise<ReplayState> {
  const admin = adminClient();

  let state: ReplayState;
  let events: GameEventRecord[];
  if (opts.state) {
    if (!opts.events) {
      throw new Error("rederive: events required when state is provided");
    }
    state = opts.state;
    events = opts.events;
  } else {
    const eventsRes = await admin
      .from("game_events")
      .select(EVENT_COLUMNS)
      .eq("game_id", gameId)
      .order("sequence_number", { ascending: true });

    if (eventsRes.error) {
      throw new Error(`game_events fetch failed: ${eventsRes.error.message}`);
    }
    events = (eventsRes.data ?? []) as unknown as GameEventRecord[];
    state = replay(events);
  }

  // Build the derived payload and write all three tables in one Postgres
  // transaction via write_derived_state. Before this RPC, the three writes
  // fired concurrently via Promise.all and a CHECK/FK violation on one
  // table could leave the public scoreboard inconsistent across the other
  // two. Now: either all three commit or none do.
  const derived = buildDerivedPayload(state, events);

  const writeRes = await opts.userClient.rpc("write_derived_state", {
    p_game_id: gameId,
    p_derived: derived,
  });
  if (writeRes.error) {
    if (isForbiddenError(writeRes.error)) {
      throw new Error(`forbidden: ${writeRes.error.message ?? "unknown"}`);
    }
    throw new Error(`write_derived_state failed: ${writeRes.error.message}`);
  }

  // Tablet stat rollup. Gated to final-status writes (and corrections /
  // game_finalized events, which can transition into or out of final) so
  // in-progress pitches/ABs stop churning stat_snapshots — a hot-path win
  // since this table is large and the DELETE was running on every event.
  const chainTypes = opts.chainTypes ?? [];
  const touchSnapshots = shouldTouchTabletSnapshots(state.status, chainTypes);

  if (touchSnapshots) {
    await replaceTabletSnapshots(admin, gameId, state);
  }

  return state;
}

/**
 * DELETE-then-INSERT atomic replace for tablet stat_snapshots. Exported so
 * the regression test can mock the supabase client and pin the contract
 * without driving the whole rederive() pipeline.
 *
 * Behavior:
 *   - state.status === "final": fetch team_id + game_date, build per-player
 *     rollup rows, and pass everything to the RPC.
 *   - state.status !== "final": pass `p_rows = []`. The RPC still deletes any
 *     stale tablet rows (un-finalize case) but skips the insert.
 *
 * Atomicity: the RPC wraps DELETE + INSERT in one Postgres transaction. A
 * failure on the insert side leaves the prior rows intact instead of wiping
 * the final box score.
 */
export async function replaceTabletSnapshots(
  admin: AnyClient,
  gameId: string,
  state: ReplayState,
): Promise<void> {
  let teamId: string | null = null;
  let gameDate: string | null = null;
  let rows: TabletSnapshotRow[] = [];

  if (state.status === "final") {
    const gameRow = await admin
      .from("games")
      .select("team_id, game_date")
      .eq("id", gameId)
      .single();
    if (gameRow.error || !gameRow.data) {
      throw new Error(
        `games fetch for rollup failed: ${gameRow.error?.message ?? "missing"}`,
      );
    }
    teamId = gameRow.data.team_id as string;
    gameDate = gameRow.data.game_date as string;
    rows = buildTabletSnapshotRows(state);
  }

  const res = await admin.rpc("replace_tablet_stat_snapshots", {
    p_game_id: gameId,
    p_team_id: teamId,
    p_upload_date: gameDate,
    p_rows: rows,
  });
  if (res.error) {
    throw new Error(`replace_tablet_stat_snapshots failed: ${res.error.message}`);
  }
}

/** One per-player tablet snapshot row, post-rollup. The RPC adds game_id,
 *  source='tablet', upload_id=null, plus team_id/upload_date (shared across
 *  all rows for a game), so this shape only carries the per-player parts. */
export interface TabletSnapshotRow {
  player_id: string;
  stats: {
    batting: Record<string, unknown>;
    pitching: Record<string, unknown>;
    fielding: Record<string, unknown>;
  };
}

/**
 * Pure helper: turn a finalized ReplayState into the per-player rollup rows
 * the tablet snapshot replace RPC consumes. Split out from rederive() so a
 * regression test can pin the rollup shape without mocking the whole supabase
 * call chain.
 */
export function buildTabletSnapshotRows(state: ReplayState): TabletSnapshotRow[] {
  const batting = rollupBatting(state.at_bats, {
    stolen_bases: state.stolen_bases,
    caught_stealing: state.caught_stealing,
    pickoffs: state.pickoffs,
  });
  const pitching = rollupPitching(state.at_bats, state.non_pa_runs);
  const fielding = rollupFielding(state.at_bats, state.defensive_innings_outs, {
    stolen_bases: state.stolen_bases,
    caught_stealing: state.caught_stealing,
    pickoffs: state.pickoffs,
    passed_balls: state.passed_balls,
    error_advance_fielders: state.error_advance_fielders,
  });
  const wls = computeWLS(
    state.at_bats,
    state.non_pa_runs,
    state.we_are_home,
    state.team_score,
    state.opponent_score,
    state.league_type,
  );
  if (wls.W) { const line = pitching.get(wls.W); if (line) line.W = 1; }
  if (wls.L) { const line = pitching.get(wls.L); if (line) line.L = 1; }
  if (wls.SV) { const line = pitching.get(wls.SV); if (line) line.SV = 1; }
  const playerIds = new Set<string>([
    ...batting.keys(),
    ...pitching.keys(),
    ...fielding.keys(),
  ]);
  return [...playerIds].map((player_id) => ({
    player_id,
    stats: {
      batting: (batting.get(player_id) ?? {}) as Record<string, unknown>,
      pitching: (pitching.get(player_id) ?? {}) as Record<string, unknown>,
      fielding: (fielding.get(player_id) ?? {}) as Record<string, unknown>,
    },
  }));
}
