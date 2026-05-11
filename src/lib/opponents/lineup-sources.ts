// Pre-game opposing lineup loaders. Three sources for filling out the 9-slot
// opposing batting order:
//
//  - pullFromStatly  : opposing school is a Statly tenant with a public
//                      roster — copy their roster_entries via the
//                      get_public_roster SECURITY DEFINER RPC.
//  - loadPriorLineup : you've played this opponent before — reuse the
//                      opposing_lineup from the most recent game_started
//                      event you've recorded against them.
//  - buildEmpty      : fresh 9 blank slots, coach types in identity ad hoc.

import { createClient } from "@/lib/supabase/client";
import type { OpposingLineupSlot, GameStartedPayload } from "@/lib/scoring/types";

const supabase = createClient();

const EMPTY_SLOTS = 9;

export function buildEmpty(): OpposingSlotDraft[] {
  return Array.from({ length: EMPTY_SLOTS }, (_, i) => ({
    batting_order: i + 1,
    opponent_player_id: null,
    external_player_id: null,
    opponent_team_id: null,
    jersey_number: null,
    first_name: null,
    last_name: null,
    position: null,
    is_dh: false,
  }));
}

/** Local working shape for the opposing lineup picker — superset of
 *  OpposingLineupSlot so we can carry source-of-truth ids (external_player_id,
 *  opponent_team_id) until the upsert resolves them into opponent_player_ids. */
export interface OpposingSlotDraft {
  batting_order: number;
  opponent_player_id: string | null;
  /** Set when this slot was pulled from another Statly tenant's roster. */
  external_player_id: string | null;
  /** Set when this slot is associated with a Statly tenant team. */
  opponent_team_id: string | null;
  jersey_number: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  is_dh: boolean;
}

/** A slot has minimum identity when at least one of jersey_number or
 *  last_name is set (hard-gate validation). */
export function slotHasIdentity(s: OpposingSlotDraft): boolean {
  return (
    (s.jersey_number?.trim().length ?? 0) > 0 ||
    (s.last_name?.trim().length ?? 0) > 0
  );
}

export async function pullFromStatly(
  opponentTeamId: string,
  seasonYear: number,
): Promise<OpposingSlotDraft[]> {
  const { data, error } = await supabase.rpc("get_public_roster", {
    p_team_id: opponentTeamId,
    p_season_year: seasonYear,
  });
  if (error) {
    throw new Error(`get_public_roster failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    external_player_id: string;
    first_name: string | null;
    last_name: string | null;
    jersey_number: string | null;
    position: string | null;
    grad_year: number | null;
  }>;
  // Take the first 9 by the roster's natural ordering (the RPC already sorts
  // by jersey numerically, then last/first name). Coach can edit/reorder.
  return rows.slice(0, EMPTY_SLOTS).map((r, i) => ({
    batting_order: i + 1,
    opponent_player_id: null,
    external_player_id: r.external_player_id,
    opponent_team_id: opponentTeamId,
    jersey_number: r.jersey_number,
    first_name: r.first_name,
    last_name: r.last_name,
    position: r.position,
    is_dh: false,
  }));
}

/** Loads the most recent opposing_lineup from a prior game_started event
 *  against the same opponent. We match on opponent_team_id when both games
 *  have one (the strict, recognized-opponent case), otherwise on text
 *  opponent name (best-effort match for ad-hoc games). Returns null if no
 *  prior game found. */
export async function loadPriorLineup(args: {
  myTeamId: string;
  opponentTeamId: string | null;
  opponentName: string;
  excludeGameId: string;
}): Promise<OpposingSlotDraft[] | null> {
  const base = supabase
    .from("games")
    .select("id, opponent, opponent_team_id, game_date")
    .eq("team_id", args.myTeamId)
    .neq("id", args.excludeGameId)
    .order("game_date", { ascending: false })
    .limit(10);

  const games =
    args.opponentTeamId !== null
      ? await base.eq("opponent_team_id", args.opponentTeamId)
      : await base.eq("opponent", args.opponentName).is("opponent_team_id", null);

  if (games.error || !games.data || games.data.length === 0) return null;

  // Walk most-recent first, finding the first one whose game_started has an
  // opposing_lineup. Older games (before phase 1) will not.
  for (const g of games.data) {
    const gs = await supabase
      .from("game_events")
      .select("payload")
      .eq("game_id", g.id)
      .eq("event_type", "game_started")
      .order("sequence_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (gs.error || !gs.data) continue;
    const payload = gs.data.payload as unknown as GameStartedPayload;
    const prior = payload?.opposing_lineup;
    if (!prior || prior.length === 0) continue;

    return prior.map<OpposingSlotDraft>((s) => ({
      batting_order: s.batting_order,
      opponent_player_id: s.opponent_player_id,
      external_player_id: null,
      opponent_team_id: args.opponentTeamId,
      jersey_number: s.jersey_number,
      first_name: null,
      last_name: s.last_name,
      position: s.position,
      is_dh: s.is_dh,
    }));
  }
  return null;
}

/** Reduce a draft to the wire-format OpposingLineupSlot the replay engine
 *  ingests. Used after upsert_opponent_players has filled in the ids. */
export function toLineupSlot(draft: OpposingSlotDraft): OpposingLineupSlot {
  return {
    batting_order: draft.batting_order,
    opponent_player_id: draft.opponent_player_id,
    jersey_number: draft.jersey_number,
    last_name: draft.last_name,
    position: draft.position,
    is_dh: draft.is_dh,
  };
}
