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

// Accepts any of the project's Supabase clients (server/SSR/admin) without
// pinning to a specific generic instantiation, which varies between
// @supabase/ssr and @supabase/supabase-js.
type AnyClient = any;

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

  // 1. Compute state before the new event so chain derivation matches the
  //    pre-pitch view.
  const eventsRes = await admin
    .from("game_events")
    .select("*")
    .eq("game_id", gameId)
    .order("sequence_number", { ascending: true });
  if (eventsRes.error) {
    throw new Error(`game_events fetch failed: ${eventsRes.error.message}`);
  }
  const existing = (eventsRes.data ?? []) as unknown as GameEventRecord[];
  const stateBefore = replay(existing);
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
  if (
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

  if (rpcRes.error) {
    const code = (rpcRes.error as { code?: string }).code;
    const msg = rpcRes.error.message ?? "unknown";
    // SECURITY DEFINER RAISE with 42501 surfaces here on auth failure.
    // The API route maps this to a 403.
    if (code === "42501" || /forbidden|permission denied|row-level security/i.test(msg)) {
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

  // 4. Single rederive pass over the now-canonical event log.
  const chainTypes = chain.map((e) => e.event_type);
  const state = await rederive(gameId, { chainTypes });

  return { events, state, duplicate };
}

interface RederiveOptions {
  /** Event types persisted in this request — used to decide whether to
   *  touch stat_snapshots when the game isn't final (un-finalize case). */
  chainTypes?: GameEventType[];
}

/**
 * Re-replay every event for a game and write the canonical at_bats +
 * game_live_state. Exposed so admin "rebuild derived state" tooling can
 * call it directly.
 */
export async function rederive(
  gameId: string,
  opts: RederiveOptions = {},
): Promise<ReplayState> {
  const admin = adminClient();

  const eventsRes = await admin
    .from("game_events")
    .select("*")
    .eq("game_id", gameId)
    .order("sequence_number", { ascending: true });

  if (eventsRes.error) {
    throw new Error(`game_events fetch failed: ${eventsRes.error.message}`);
  }
  const events = (eventsRes.data ?? []) as unknown as GameEventRecord[];
  const state = replay(events);

  // Upsert live state (one row per game; PK is game_id).
  // runner_first/second/third are FK'd to players(id), so only emit them when
  // our team is batting. When the opposing team is batting, the player_ids on
  // base are either opponent_players UUIDs or synthesized per-PA strings —
  // both would break the FK / UUID column. inning_end clears bases, so the
  // invariant "runners on base belong to the team batting this half" holds.
  const weAreBatting =
    state.we_are_home ? state.half === "bottom" : state.half === "top";
  const liveUpsert = await admin.from("game_live_state").upsert({
    game_id: gameId,
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
  });
  if (liveUpsert.error) {
    throw new Error(`game_live_state upsert failed: ${liveUpsert.error.message}`);
  }

  // Insert any at_bats we don't yet have. UNIQUE(event_id) makes this idempotent.
  if (state.at_bats.length > 0) {
    const rows = state.at_bats.map((ab) => ({
      game_id: gameId,
      event_id: ab.event_id,
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
    }));
    const abUpsert = await admin
      .from("at_bats")
      .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true });
    if (abUpsert.error) {
      throw new Error(`at_bats upsert failed: ${abUpsert.error.message}`);
    }
  }

  // Reflect the game lifecycle on `games.status` so the existing /scores
  // query (and future LIVE-tile filter) sees the right state. When the
  // game is finalized via tablet, also write the score and result back
  // so /scores can read everything from the games table (it falls back
  // to game_live_state only for in-progress tiles).
  if (state.status !== "draft") {
    const update: {
      status: typeof state.status;
      team_score?: number;
      opponent_score?: number;
      result?: "W" | "L" | "T";
    } = { status: state.status };
    if (state.status === "final") {
      update.team_score = state.team_score;
      update.opponent_score = state.opponent_score;
      update.result =
        state.team_score > state.opponent_score ? "W"
        : state.team_score < state.opponent_score ? "L"
        : "T";
    }
    const statusUpdate = await admin.from("games").update(update).eq("id", gameId);
    if (statusUpdate.error) {
      throw new Error(`games update failed: ${statusUpdate.error.message}`);
    }
  }

  // Tablet stat rollup. Gated to final-status writes (and corrections /
  // game_finalized events, which can transition into or out of final) so
  // in-progress pitches/ABs stop churning stat_snapshots — a hot-path win
  // since this table is large and the DELETE was running on every event.
  const chainTypes = opts.chainTypes ?? [];
  const touchSnapshots =
    state.status === "final" ||
    chainTypes.includes("correction") ||
    chainTypes.includes("game_finalized");

  if (touchSnapshots) {
    const del = await admin
      .from("stat_snapshots")
      .delete()
      .eq("game_id", gameId)
      .eq("source", "tablet");
    if (del.error) {
      throw new Error(`stat_snapshots tablet delete failed: ${del.error.message}`);
    }

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
      const team_id = gameRow.data.team_id as string;
      const game_date = gameRow.data.game_date as string;

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

      if (playerIds.size > 0) {
        const rows = [...playerIds].map((player_id) => ({
          team_id,
          player_id,
          upload_date: game_date,
          game_id: gameId,
          source: "tablet" as const,
          upload_id: null,
          stats: {
            batting: batting.get(player_id) ?? {},
            pitching: pitching.get(player_id) ?? {},
            fielding: fielding.get(player_id) ?? {},
          },
        }));
        const ins = await admin.from("stat_snapshots").insert(rows as never[]);
        if (ins.error) {
          throw new Error(`stat_snapshots tablet insert failed: ${ins.error.message}`);
        }
      }
    }
  }

  return state;
}
