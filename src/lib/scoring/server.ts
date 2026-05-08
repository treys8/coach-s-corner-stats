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
    runner_first: state.bases.first,
    runner_second: state.bases.second,
    runner_third: state.bases.third,
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
  // query (and future LIVE-tile filter) sees the right state.
  if (state.status !== "draft") {
    const statusUpdate = await admin
      .from("games")
      .update({ status: state.status })
      .eq("id", gameId);
    if (statusUpdate.error) {
      throw new Error(`games.status update failed: ${statusUpdate.error.message}`);
    }
  }

  return state;
}
