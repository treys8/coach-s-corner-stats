// Derives an opposing-batter profile (batting line + spray points) from
// raw at_bats rows. Pure function — no DB access. The API route at
// /api/opponents/[id]/profile fetches the rows, this collapses them.
//
// Parallel to rollupBatting but specialised for opposing PAs: every input
// row is attributed to the same player, so we skip the per-player map and
// emit a flat batting line. Defensive fields (LOB, RISP, etc.) aren't
// derivable from our perspective without their full base-runner context,
// so the line surfaces just the core box-score numbers.

import { deriveBattingRates } from "@/lib/stats/derived";
import {
  HIT_RESULTS,
  NON_AB_RESULTS,
  STRIKEOUT_RESULTS,
  WALK_RESULTS,
} from "@/lib/scoring/at-bat-classifications";

export interface OpposingBatterProfile {
  player_id: string;
  identity: {
    first_name: string | null;
    last_name: string | null;
    jersey_number: string | null;
  };
  line: BattingLine;
  sprayPoints: SprayPoint[];
  games: { game_id: string; game_date: string }[];
}

export interface BattingLine {
  PA: number;
  AB: number;
  H: number;
  HR: number;
  "2B": number;
  "3B": number;
  BB: number;
  SO: number;
  HBP: number;
  RBI: number;
  AVG: number; // H / AB (0 when AB=0)
  OBP: number; // (H + BB + HBP) / (AB + BB + HBP + SF)
  SLG: number; // total bases / AB
}

export interface SprayPoint {
  x: number;
  y: number;
  result: string;
  game_id: string;
}

export interface RawOpposingAtBat {
  game_id: string;
  game_date: string;
  result: string;
  rbi: number;
  spray_x: number | null;
  spray_y: number | null;
}

export function deriveOpposingBatterProfile(
  rows: RawOpposingAtBat[],
  identity: OpposingBatterProfile["identity"],
  playerId: string,
): OpposingBatterProfile {
  const line: BattingLine = {
    PA: 0, AB: 0, H: 0, HR: 0, "2B": 0, "3B": 0,
    BB: 0, SO: 0, HBP: 0, RBI: 0,
    AVG: 0, OBP: 0, SLG: 0,
  };
  const spray: SprayPoint[] = [];
  const games = new Map<string, string>();

  let sf = 0;
  let totalBases = 0;

  for (const ab of rows) {
    games.set(ab.game_id, ab.game_date);
    line.PA += 1;
    if (!NON_AB_RESULTS.has(ab.result)) line.AB += 1;
    if (HIT_RESULTS.has(ab.result)) {
      line.H += 1;
      if (ab.result === "2B") { line["2B"] += 1; totalBases += 2; }
      else if (ab.result === "3B") { line["3B"] += 1; totalBases += 3; }
      else if (ab.result === "HR") { line.HR += 1; totalBases += 4; }
      else totalBases += 1; // 1B
    } else if (WALK_RESULTS.has(ab.result)) {
      line.BB += 1;
    } else if (STRIKEOUT_RESULTS.has(ab.result)) {
      line.SO += 1;
    } else if (ab.result === "HBP") {
      line.HBP += 1;
    } else if (ab.result === "SF") {
      sf += 1;
    }
    line.RBI += ab.rbi;

    if (ab.spray_x !== null && ab.spray_y !== null) {
      spray.push({ x: ab.spray_x, y: ab.spray_y, result: ab.result, game_id: ab.game_id });
    }
  }

  const rates = deriveBattingRates({
    AB: line.AB,
    H: line.H,
    HR: line.HR,
    SO: line.SO,
    BB: line.BB,
    HBP: line.HBP,
    SF: sf,
    TB: totalBases,
  });
  line.AVG = rates.AVG;
  line.OBP = rates.OBP;
  line.SLG = rates.SLG;

  const gameList = Array.from(games.entries())
    .map(([game_id, game_date]) => ({ game_id, game_date }))
    .sort((a, b) => (a.game_date < b.game_date ? 1 : -1));

  return {
    player_id: playerId,
    identity,
    line,
    sprayPoints: spray,
    games: gameList,
  };
}
