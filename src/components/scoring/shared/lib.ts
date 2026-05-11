import { toast } from "sonner";
import type { AtBatResult, GameEventRecord, ReplayState } from "@/lib/scoring/types";
import { RESULT_DESC } from "./constants";

export interface RosterDisplay {
  id: string;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
}

export function nameById(roster: RosterDisplay[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of roster) {
    const num = p.jersey_number ? `#${p.jersey_number} ` : "";
    m.set(p.id, `${num}${p.first_name} ${p.last_name}`);
  }
  return m;
}

export function isOurHalf(weAreHome: boolean, half: "top" | "bottom"): boolean {
  // Visiting team bats in the top, home in the bottom.
  return weAreHome ? half === "bottom" : half === "top";
}

// Auto-fill the count to match the outcome. Walks must be 4 balls; strikeouts
// must be 3 strikes. For balls put in play (hits, in-play outs, FC, E,
// sacs, DP/TP), the contact pitch counts as a strike — bump the strike
// count by one if there's room. HBP is treated as neither.
export function finalCount(
  result: AtBatResult,
  balls: number,
  strikes: number,
): { balls: number; strikes: number } {
  if (result === "BB" || result === "IBB") return { balls: 4, strikes };
  if (result === "K_swinging" || result === "K_looking") return { balls, strikes: 3 };
  if (result === "HBP") return { balls, strikes };
  // Hits + in-play outs + FC + E + sacs + DP/TP — the in-play pitch is a strike.
  return { balls, strikes: Math.min(3, strikes + 1) };
}

export function describePlay(
  result: AtBatResult,
  runs: number,
  batterId: string | null,
  names: Map<string, string>,
): string {
  const base = RESULT_DESC[result] ?? result;
  const who = batterId
    ? ` by ${names.get(batterId) ?? "us"}`
    : " (opp)";
  if (runs === 0) return `${base}${who}`;
  return `${base}${who} — ${runs} run${runs === 1 ? "" : "s"}`;
}

export interface PostBody {
  client_event_id: string;
  event_type: string;
  payload: unknown;
}

export interface ApplyEventResult {
  event: GameEventRecord;
  live_state: ReplayState;
  duplicate: boolean;
}

export async function postEvent(gameId: string, body: PostBody): Promise<ApplyEventResult | null> {
  const res = await fetch(`/api/games/${gameId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    toast.error(`Couldn't save event: ${detail.error ?? res.statusText}`);
    return null;
  }
  return (await res.json()) as ApplyEventResult;
}
