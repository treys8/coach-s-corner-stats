// Opponent auto-recognition. Given a freeform opponent name from a schedule
// row, find the matching Statly tenant (school + sport-and-level-specific
// team) so games.opponent_team_id can be set automatically.
//
// V1: exact case-insensitive match against schools.name + schools.short_name
// via the recognize_opponent_team SECURITY DEFINER RPC. Multiple matches →
// ambiguous; caller surfaces a picker. No fuzzy matching yet.

import { createClient } from "@/lib/supabase/client";

export interface RecognitionMatch {
  team_id: string;
  school_id: string;
  school_name: string;
  short_name: string | null;
}

export type RecognitionResult =
  | { kind: "match"; match: RecognitionMatch }
  | { kind: "ambiguous"; candidates: RecognitionMatch[] }
  | { kind: "none" };

const supabase = createClient();

export async function recognizeOpponentTeam(
  myTeamId: string,
  opponentText: string,
): Promise<RecognitionResult> {
  const needle = opponentText.trim();
  if (!needle) return { kind: "none" };

  const { data, error } = await supabase.rpc("recognize_opponent_team", {
    p_my_team_id: myTeamId,
    p_opponent_text: needle,
  });

  if (error) {
    // Soft-fail: recognition is a UX nicety; never block schedule entry.
    return { kind: "none" };
  }

  const rows = (data ?? []) as RecognitionMatch[];
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "match", match: rows[0] };
  return { kind: "ambiguous", candidates: rows };
}
