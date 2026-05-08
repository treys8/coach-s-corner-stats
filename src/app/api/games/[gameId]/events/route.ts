// POST /api/games/[gameId]/events
//
// Tablet endpoint: persists one game event, runs the server-side replay,
// and writes derived at_bats + game_live_state. Returns the resulting
// live state so the tablet (and any client) can reconcile its view.
//
// Auth: the user-scoped supabase client gates the event insert through
// RLS. Anonymous or non-team-member callers get 403. Service role is only
// used for derived-table writes inside the replay helper.

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
];

const eventSchema = z.object({
  client_event_id: z.string().min(1).max(128),
  sequence_number: z.number().int().nonnegative(),
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

  const userClient = await createClient();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const result = await applyEvent(userClient, gameId, {
      client_event_id: parsed.data.client_event_id,
      sequence_number: parsed.data.sequence_number,
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
    if (/permission denied|row-level security|42501/i.test(message)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "internal", detail: message }, { status: 500 });
  }
}
