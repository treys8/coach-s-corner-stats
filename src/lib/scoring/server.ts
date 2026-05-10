// Server-side glue around the pure replay engine. Persists an incoming
// event, replays the whole game, and writes the canonical at_bats +
// game_live_state. Runs from API routes only.
//
// The user-scoped supabase client gates the event insert through RLS
// (team_members of the game's team are allowed; everyone else gets denied).
// Derived tables (at_bats, game_live_state) have no client write policy
// and are written by the admin client.

import { adminClient } from "@/lib/supabase/admin";
import { replay } from "./replay";
import { computeWLS, rollupBatting, rollupPitching } from "./rollup";
import type { GameEventPayload, GameEventRecord, ReplayState } from "./types";
import type { GameEventType } from "@/integrations/supabase/types";

// Accepts any of the project's Supabase clients (server/SSR/admin) without
// pinning to a specific generic instantiation, which varies between
// @supabase/ssr and @supabase/supabase-js.
type AnyClient = any;

export interface IncomingEvent {
  client_event_id: string;
  sequence_number: number;
  event_type: GameEventType;
  payload: GameEventPayload;
  supersedes_event_id?: string | null;
}

export interface ApplyEventResult {
  event: GameEventRecord;
  live_state: ReplayState;
  /** True if the event was already persisted (idempotent retry). */
  duplicate: boolean;
}

const UNIQUE_VIOLATION = "23505";

/**
 * Persist an event, run replay, and write derived state.
 *
 * @param userClient  request-scoped supabase client; RLS gates the event insert
 * @param gameId      game the event belongs to
 * @param incoming    event payload from the tablet
 */
export async function applyEvent(
  userClient: AnyClient,
  gameId: string,
  incoming: IncomingEvent,
): Promise<ApplyEventResult> {
  const insert = await userClient
    .from("game_events")
    .insert({
      game_id: gameId,
      client_event_id: incoming.client_event_id,
      sequence_number: incoming.sequence_number,
      event_type: incoming.event_type,
      payload: incoming.payload as never,
      supersedes_event_id: incoming.supersedes_event_id ?? null,
    })
    .select("*")
    .single();

  let duplicate = false;
  let inserted = insert.data;

  if (insert.error) {
    if (insert.error.code !== UNIQUE_VIOLATION) {
      throw new Error(`game_events insert failed: ${insert.error.message}`);
    }
    // Idempotency: fetch the prior event with the same client_event_id and
    // continue. Re-replaying is safe and ensures derived state is current.
    duplicate = true;
    const prior = await userClient
      .from("game_events")
      .select("*")
      .eq("game_id", gameId)
      .eq("client_event_id", incoming.client_event_id)
      .single();
    if (prior.error || !prior.data) {
      throw new Error(`game_events conflict but no prior row: ${prior.error?.message ?? "missing"}`);
    }
    inserted = prior.data;
  }

  if (!inserted) throw new Error("game_events insert returned no row");

  const live_state = await rederive(gameId);

  return {
    event: inserted as unknown as GameEventRecord,
    live_state,
    duplicate,
  };
}

/**
 * Re-replay every event for a game and write the canonical at_bats +
 * game_live_state. Exposed so admin "rebuild derived state" tooling can
 * call it directly.
 */
export async function rederive(gameId: string): Promise<ReplayState> {
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
  const liveUpsert = await admin.from("game_live_state").upsert({
    game_id: gameId,
    inning: state.inning,
    half: state.half,
    outs: state.outs,
    runner_first: state.bases.first?.player_id ?? null,
    runner_second: state.bases.second?.player_id ?? null,
    runner_third: state.bases.third?.player_id ?? null,
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

  // Tablet stat rollup. Idempotent: clear any prior tablet rows for this game,
  // then write fresh rows iff the game is final. Handles re-replay, late
  // corrections, and (eventually) un-finalize without duplicates.
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
    const season_year = new Date(game_date).getFullYear();

    const batting = rollupBatting(state.at_bats);
    const pitching = rollupPitching(state.at_bats, state.non_pa_runs);
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
    const playerIds = new Set<string>([...batting.keys(), ...pitching.keys()]);

    if (playerIds.size > 0) {
      const rows = [...playerIds].map((player_id) => ({
        team_id,
        player_id,
        season_year,
        upload_date: game_date,
        game_id: gameId,
        source: "tablet" as const,
        upload_id: null,
        stats: {
          batting: batting.get(player_id) ?? {},
          pitching: pitching.get(player_id) ?? {},
          fielding: {},
        },
      }));
      const ins = await admin.from("stat_snapshots").insert(rows as never[]);
      if (ins.error) {
        throw new Error(`stat_snapshots tablet insert failed: ${ins.error.message}`);
      }
    }
  }

  return state;
}
