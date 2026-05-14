// POST /api/games/[gameId]/events
//
// Tablet endpoint: persists one tablet-emitted game event plus any
// server-derived chained events (closing at_bat after a count-closing
// pitch; auto inning_end when outs hit 3) atomically, runs the
// server-side replay, and writes derived at_bats + game_live_state.
// Returns the canonical state + the list of events actually persisted so
// the tablet can fold them into local state without a refetch.
//
// Auth: the apply_game_events SECURITY DEFINER RPC re-enforces team
// membership via auth.uid(). Anonymous or non-team-member callers surface
// here as 403. Service role is only used for derived-table writes inside
// the replay helper.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { applyEvent } from "@/lib/scoring/server";
import type { GameEventPayload } from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";

const EVENT_TYPES: GameEventType[] = [
  "at_bat", "stolen_base", "caught_stealing", "pickoff",
  "wild_pitch", "passed_ball", "balk", "error_advance",
  "substitution", "pitching_change", "position_change",
  "game_started", "inning_end", "game_finalized", "correction",
  "pitch", "defensive_conference", "opposing_lineup_edit",
  "umpire_call", "game_suspended",
];

const eventSchema = z.object({
  client_event_id: z.string().min(1).max(128),
  event_type: z.enum(EVENT_TYPES as [GameEventType, ...GameEventType[]]),
  // Payload is validated structurally inside the replay engine; the route
  // just makes sure it's an object.
  payload: z.record(z.unknown()),
  supersedes_event_id: z.string().uuid().nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Defense in depth: every at_bat must identify a batter on at least one
  // side. The CHECK constraint on the table allows both nulls (legacy data),
  // so the live tablet could otherwise post a null/null PA if the opposing
  // lineup is empty. The pre-game hard gate prevents that, but reject here too.
  if (parsed.data.event_type === "at_bat") {
    const p = parsed.data.payload as { batter_id?: unknown; opponent_batter_id?: unknown };
    const noBatter = (p.batter_id ?? null) === null;
    const noOppBatter = (p.opponent_batter_id ?? null) === null;
    if (noBatter && noOppBatter) {
      return NextResponse.json(
        { error: "at_bat requires either batter_id or opponent_batter_id" },
        { status: 400 },
      );
    }
  }

  const userClient = await createClient();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const result = await applyEvent(userClient, gameId, {
      client_event_id: parsed.data.client_event_id,
      event_type: parsed.data.event_type,
      payload: parsed.data.payload as GameEventPayload,
      supersedes_event_id: parsed.data.supersedes_event_id ?? null,
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    // RLS denials surface as a missing row + a generic insert error from
    // PostgREST; treat the obvious permission shapes as 403, everything
    // else as 500 with the message for debuggability.
    if (/^forbidden|permission denied|row-level security|42501/i.test(message)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "internal", detail: message }, { status: 500 });
  }
}
