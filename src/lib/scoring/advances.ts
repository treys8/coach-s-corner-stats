// Runner-advancement defaults given an outcome. The tablet's outcome
// buttons feed these in unless the coach overrides on the diamond
// (Phase 3). Conservative defaults: hits push every existing runner the
// same number of bases as the batter; runners on 2nd or further always
// score on a triple/HR; we don't auto-score from 2nd on a single
// (coaches frequently want that to be a manual override).

import type { AtBatResult, Bases, RunnerAdvance } from "./types";

export function defaultAdvances(
  prev: Bases,
  batterId: string | null,
  result: AtBatResult,
): RunnerAdvance[] {
  switch (result) {
    case "1B":   return hitAdvance(prev, batterId, 1);
    case "2B":   return hitAdvance(prev, batterId, 2);
    case "3B":   return hitAdvance(prev, batterId, 3);
    case "HR":   return hitAdvance(prev, batterId, 4);
    case "BB":
    case "IBB":
    case "HBP":
    case "CI":   return forcedWalk(prev, batterId);
    // FC and E don't get auto-advances — they almost always involve a
    // judgment call about who's safe and who's out. Coach overrides via
    // the edit-last-play dialog.
    case "FC":
    case "E":    return [];
    case "SF":   return sacFly(prev, batterId);
    case "SAC":  return sacBunt(prev, batterId);
    // K, FO, GO, LO, PO, IF, FC, E, DP, TP — no auto-advances. The replay
    // engine charges DEFAULT_OUTS_FOR when runner_advances is empty;
    // FC/E with runners is a coach override scenario.
    default:     return [];
  }
}

function hitAdvance(prev: Bases, batterId: string | null, bases: number): RunnerAdvance[] {
  const advances: RunnerAdvance[] = [];

  // Existing runners advance `bases` bases. Anyone reaching home scores.
  if (prev.third) advances.push(toBase("third", 3 + bases, prev.third.player_id));
  if (prev.second) advances.push(toBase("second", 2 + bases, prev.second.player_id));
  if (prev.first) advances.push(toBase("first", 1 + bases, prev.first.player_id));

  // Batter goes to `bases` (4 = home for HR).
  advances.push(toBase("batter", bases, batterId));

  return advances;
}

function forcedWalk(prev: Bases, batterId: string | null): RunnerAdvance[] {
  const advances: RunnerAdvance[] = [];

  // Push only as far as forced. If 1st is empty, batter walks; nothing else moves.
  if (prev.first === null) {
    advances.push({ from: "batter", to: "first", player_id: batterId });
    return advances;
  }
  // 1st occupied: runner from 1st pushed to 2nd; check chain.
  if (prev.second === null) {
    advances.push({ from: "first", to: "second", player_id: prev.first.player_id });
    advances.push({ from: "batter", to: "first", player_id: batterId });
    return advances;
  }
  if (prev.third === null) {
    advances.push({ from: "second", to: "third", player_id: prev.second.player_id });
    advances.push({ from: "first", to: "second", player_id: prev.first.player_id });
    advances.push({ from: "batter", to: "first", player_id: batterId });
    return advances;
  }
  // Bases loaded — runner from 3rd is forced home.
  advances.push({ from: "third", to: "home", player_id: prev.third.player_id });
  advances.push({ from: "second", to: "third", player_id: prev.second.player_id });
  advances.push({ from: "first", to: "second", player_id: prev.first.player_id });
  advances.push({ from: "batter", to: "first", player_id: batterId });
  return advances;
}

function sacFly(prev: Bases, batterId: string | null): RunnerAdvance[] {
  // Out for the batter; runner from 3rd scores; others hold.
  const advances: RunnerAdvance[] = [{ from: "batter", to: "out", player_id: batterId }];
  if (prev.third) advances.push({ from: "third", to: "home", player_id: prev.third.player_id });
  return advances;
}

function sacBunt(prev: Bases, batterId: string | null): RunnerAdvance[] {
  const advances: RunnerAdvance[] = [{ from: "batter", to: "out", player_id: batterId }];
  if (prev.third) advances.push({ from: "third", to: "home", player_id: prev.third.player_id });
  if (prev.second) advances.push({ from: "second", to: "third", player_id: prev.second.player_id });
  if (prev.first) advances.push({ from: "first", to: "second", player_id: prev.first.player_id });
  return advances;
}

// Normalize the destination integer (1=first, 2=second, 3=third, 4=home).
function toBase(
  from: RunnerAdvance["from"],
  baseIndex: number,
  playerId: string | null,
): RunnerAdvance {
  if (baseIndex >= 4) return { from, to: "home", player_id: playerId };
  if (baseIndex === 3) return { from, to: "third", player_id: playerId };
  if (baseIndex === 2) return { from, to: "second", player_id: playerId };
  return { from, to: "first", player_id: playerId };
}
