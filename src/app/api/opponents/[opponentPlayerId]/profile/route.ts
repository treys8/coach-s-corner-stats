// GET /api/opponents/[opponentPlayerId]/profile
//
// Returns the requesting user's school's complete record of at_bats vs the
// given opponent_player, collapsed into a batting line + spray points.
// Powers the live-game side panel and the per-opponent-player page.
//
// Auth: user-scoped supabase client; RLS gates `opponent_players` to
// members of that school. `at_bats` is read via team-member RLS, which is
// what we want — only at_bats from games owned by teams in this school
// (where the user has membership) are visible.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  deriveOpposingBatterProfile,
  type RawOpposingAtBat,
} from "@/lib/opponents/profile";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ opponentPlayerId: string }> },
) {
  const { opponentPlayerId } = await params;

  const client = await createClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Identity row — RLS ensures the caller has school access.
  const idRes = await client
    .from("opponent_players")
    .select("id, first_name, last_name, jersey_number")
    .eq("id", opponentPlayerId)
    .maybeSingle();
  if (idRes.error || !idRes.data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const id = idRes.data as unknown as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    jersey_number: string | null;
  };

  // All at_bats this opponent has had in games owned by teams the caller
  // can see. The join through games (RLS on games already restricts to
  // team-member visibility) gives us the date for each game.
  const abRes = await client
    .from("at_bats")
    .select("result, rbi, spray_x, spray_y, game_id, games!inner(game_date)")
    .eq("opponent_batter_id", opponentPlayerId);
  if (abRes.error) {
    return NextResponse.json({ error: abRes.error.message }, { status: 500 });
  }

  const rows = (abRes.data ?? []) as unknown as Array<{
    result: string;
    rbi: number;
    spray_x: number | null;
    spray_y: number | null;
    game_id: string;
    games: { game_date: string };
  }>;

  const raw: RawOpposingAtBat[] = rows.map((r) => ({
    game_id: r.game_id,
    game_date: r.games.game_date,
    result: r.result,
    rbi: r.rbi,
    spray_x: r.spray_x,
    spray_y: r.spray_y,
  }));

  const profile = deriveOpposingBatterProfile(
    raw,
    {
      first_name: id.first_name,
      last_name: id.last_name,
      jersey_number: id.jersey_number,
    },
    id.id,
  );

  return NextResponse.json(profile);
}
