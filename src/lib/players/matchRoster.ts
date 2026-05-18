// Classifies an incoming uploaded player name against the existing school
// roster: exact normalized match → "existing"; within Levenshtein 2 → "similar"
// (with a did-you-mean suggestion); else "new". Used by the stats-upload review
// step to catch typos like "Smtih" vs "Smith" before a duplicate player record
// is created.
//
// The normalization mirrors the SQL normalize_player_name() function used by
// the players unique index, so the "existing" verdict is reliable: the RPC
// would actually map both surface forms onto the same player id.

import { normalizePlayerName } from "@/lib/csvParser";
import { levenshtein } from "@/lib/strings/levenshtein";

export interface RosterPlayer {
  id: string;
  first_name: string;
  last_name: string;
}

export interface IncomingName {
  first: string;
  last: string;
}

export type MatchResult =
  | { kind: "existing"; player: RosterPlayer }
  | { kind: "similar"; suggestion: RosterPlayer; distance: number }
  | { kind: "new" };

const fullKey = (first: string, last: string): string =>
  `${normalizePlayerName(first)} ${normalizePlayerName(last)}`;

export function matchAgainstRoster(
  incoming: IncomingName,
  roster: RosterPlayer[],
  maxDistance = 2,
): MatchResult {
  const incomingKey = fullKey(incoming.first, incoming.last);

  // Two-pass: prefer exact matches, then fall back to nearest within threshold.
  // Done as a single sweep tracking both states.
  let best: { player: RosterPlayer; distance: number } | null = null;
  for (const r of roster) {
    const rosterKey = fullKey(r.first_name, r.last_name);
    if (rosterKey === incomingKey) {
      return { kind: "existing", player: r };
    }
    const d = levenshtein(incomingKey, rosterKey);
    if (d <= maxDistance && (best === null || d < best.distance)) {
      best = { player: r, distance: d };
    }
  }
  if (best) return { kind: "similar", suggestion: best.player, distance: best.distance };
  return { kind: "new" };
}
