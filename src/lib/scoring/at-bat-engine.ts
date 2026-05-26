// Engine-side helpers for at-bats: rule-of-the-game validation, runner-
// advance construction, count math, batted-ball typing. No display strings,
// no React dependencies.

import type {
  AtBatResult,
  Bases,
  BattedBallType,
  FielderTouch,
  OpposingLineupSlot,
  ReplayState,
  RunnerAdvance,
} from "./types";

// Whether an outcome is recordable given the current game state. Used by
// the OutcomeGrid to dim buttons that don't make sense right now (no
// runners on for a SAC, third out via DP, etc.). Kept conservative —
// we only flag the cases that violate the rule definition, not the
// judgment-call edges (e.g., SAC with 1B-only is allowed even though
// it's rare). Coaches still see the dimmed button; the disable is purely
// visual nudge.
export function canRecord(result: AtBatResult, state: ReplayState): boolean {
  const { outs, bases } = state;
  const onFirst = bases.first !== null;
  const onSecond = bases.second !== null;
  const onThird = bases.third !== null;
  const runnerCount = (onFirst ? 1 : 0) + (onSecond ? 1 : 0) + (onThird ? 1 : 0);
  switch (result) {
    case "SAC":
      // Sacrifice bunt: at least one runner to advance, less than 2 outs
      // (the sac-out can't be the third out — that's just a bunt out).
      return runnerCount > 0 && outs < 2;
    case "SF":
      // Sacrifice fly (MLB rule 9.08): batter flies out, runner scores
      // from third, fewer than two outs. We only require runner-on-third
      // since that's the rule's defining condition.
      return onThird && outs < 2;
    case "DP":
      // Double play: two outs on one play. Need at least one runner to
      // double up and outs < 2 (else the play stops at one out).
      return runnerCount > 0 && outs < 2;
    case "TP":
      // Triple play: three outs on one play. Need 2+ runners and 0 outs.
      return runnerCount >= 2 && outs === 0;
    default:
      return true;
  }
}

// Auto-RBI from a runner-advance plan, applying PDF §7 exclusions:
// no RBI on errors or GIDP, and no RBI for a run scoring from a base
// where the runner reached on an error (or PB advancement).
export function autoRBI(
  advances: RunnerAdvance[],
  result: AtBatResult,
  basesBefore: Bases,
): number {
  if (result === "E" || result === "DP") return 0;
  let count = 0;
  for (const adv of advances) {
    if (adv.to !== "home") continue;
    if (adv.from === "batter") {
      // Batter himself reached and circled (HR or chained advances).
      // PDF: HR always RBI. Other batter-to-home cases inherit the
      // result's RBI eligibility (E/DP already excluded above).
      count += 1;
    } else {
      const src = basesBefore[adv.from];
      if (src && !src.reached_on_error) count += 1;
    }
  }
  return count;
}

export function isOurHalf(weAreHome: boolean, half: "top" | "bottom"): boolean {
  return weAreHome ? half === "bottom" : half === "top";
}

export function formatOpposingSlotLabel(slot: OpposingLineupSlot): string {
  const num = slot.jersey_number ? `#${slot.jersey_number} ` : "";
  const name = slot.last_name ?? "";
  const pos = slot.position ? ` · ${slot.position}` : "";
  return `${num}${name}${pos}`.trim() || `Slot ${slot.batting_order}`;
}

// "Advance all" runner-move plan, used by WP/PB/Balk one-tap actions
// and the runner-action dialog's "send everyone" path.
export function allUpAdvances(bases: Bases): RunnerAdvance[] {
  const advances: RunnerAdvance[] = [];
  if (bases.third) advances.push({ from: "third", to: "home", player_id: bases.third.player_id });
  if (bases.second) advances.push({ from: "second", to: "third", player_id: bases.second.player_id });
  if (bases.first) advances.push({ from: "first", to: "second", player_id: bases.first.player_id });
  return advances;
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

/**
 * Derive `RunnerAdvance[]` from a captured DP/TP fielder chain.
 *
 * Two play-shape branches:
 *
 *  - **Caught** (chain[0].action === "caught"): the batter is out by the
 *    catch (rules-reference.md §1, §6: "A caught fly ball never creates a
 *    force"). Subsequent steps with a snapped `target` indicate trailing
 *    runners doubled off at that base (left early on the catch).
 *
 *  - **Ground ball** (chain[0].action === "fielded"): the batter is forced
 *    to 1st, which cascades a force on R1→2nd, R2→3rd, R3→home — but only
 *    while the bases behind are continuously occupied (rules-reference.md
 *    §6: "forced only when there is a runner on every base behind him").
 *    Each forced runner is retired when the chain has a `target` at their
 *    destination; otherwise they advance safely to that base.
 *
 * Mid-chain steps with `action: "tagged"` and no `target` attribute no out
 * — they record a tag attempt that didn't land or a touch without
 * retirement. The Commit gate (`canCommitChain` in useAtBatActions)
 * blocks submission when the chain doesn't enumerate enough outs for the
 * result, so the coach is nudged to drop fielders more accurately.
 *
 * Reverse-force DPs (e.g., 3-6: batter retired at 1st first, then R1 tag
 * at 2nd) emit the correct `RunnerAdvance` shape, but downstream
 * timing-play consumers that need force-vs-tag semantics must consult
 * chain order (the function does not encode reverse-force as a separate
 * marker). Acceptable for stat rollups; flagged for future timing work.
 *
 * `batter` advances always carry `player_id: null` — submitAtBat
 * re-stamps it to the reachId for the current half-inning.
 */
export function buildChainAdvances(
  chain: FielderTouch[],
  startBases: Bases,
): RunnerAdvance[] {
  if (chain.length < 2) return [];

  const isCatch = chain[0].action === "caught";
  const playBases = new Set<"first" | "second" | "third" | "home">();
  for (let i = 1; i < chain.length; i++) {
    const t = chain[i].target;
    if (t) playBases.add(t);
  }

  if (isCatch) {
    const advances: RunnerAdvance[] = [
      { from: "batter", to: "out", player_id: null },
    ];
    if (playBases.has("first") && startBases.first) {
      advances.push({ from: "first", to: "out", player_id: startBases.first.player_id });
    }
    if (playBases.has("second") && startBases.second) {
      advances.push({ from: "second", to: "out", player_id: startBases.second.player_id });
    }
    if (playBases.has("third") && startBases.third) {
      advances.push({ from: "third", to: "out", player_id: startBases.third.player_id });
    }
    return advances;
  }

  // Ground-ball cascade: batter forces R1 forces R2 forces R3. Breaks at
  // the first empty base behind the runner.
  type Step = { src: "batter" | "first" | "second" | "third"; dst: "first" | "second" | "third" | "home" };
  const cascade: Step[] = [{ src: "batter", dst: "first" }];
  if (startBases.first) {
    cascade.push({ src: "first", dst: "second" });
    if (startBases.second) {
      cascade.push({ src: "second", dst: "third" });
      if (startBases.third) {
        cascade.push({ src: "third", dst: "home" });
      }
    }
  }
  return cascade.map((c) => {
    const playerIdForSrc = (): string | null => {
      if (c.src === "batter") return null;
      const runner = startBases[c.src];
      return runner ? runner.player_id : null;
    };
    if (playBases.has(c.dst)) {
      return { from: c.src, to: "out", player_id: playerIdForSrc() };
    }
    return { from: c.src, to: c.dst, player_id: playerIdForSrc() };
  });
}

/** Smart-default batted_ball_type from result. The chip-prompt UI pre-
 *  selects this so the coach confirms with a tap rather than reading 5
 *  options. Returns null when the outcome doesn't imply a type. */
export function defaultBattedBallType(result: AtBatResult): BattedBallType | null {
  switch (result) {
    case "FO":
    case "SF":
    case "IF":
      return "fly";
    case "LO":
      return "line";
    case "PO":
      return "pop";
    case "GO":
      return "ground";
    case "SAC":
      return "bunt";
    default:
      return null;
  }
}
