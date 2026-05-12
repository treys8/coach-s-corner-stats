import type {
  AtBatPayload,
  AtBatResult,
  Bases,
  GameEventRecord,
  OpposingLineupSlot,
  PitchPayload,
  PitchType,
  PitchingChangePayload,
  ReplayState,
  RunnerAdvance,
  StolenBasePayload,
  SubstitutionPayload,
} from "./types";

// Non-contact outcomes are one-tap. In-play outcomes arm drag mode on the
// defensive diamond — the user drags the fielder who made the play to the
// ball location, and the drop captures spray (x, y) + fielder_position.
export const NON_CONTACT: AtBatResult[] = ["K_swinging", "K_looking", "BB", "HBP"];
// Rarely-tapped outcomes hidden behind a "More" button so the primary row
// stays uncluttered. Coaches who reach for IBB or CI know to expand.
export const RARE_OUTCOMES: AtBatResult[] = ["IBB", "CI"];
export const HITS: AtBatResult[] = ["1B", "2B", "3B", "HR"];
export const OUTS_IN_PLAY: AtBatResult[] = ["FO", "GO", "LO", "PO"];
// FC and E are in-play with a fielder location; the rest are productive outs
// or multi-out plays that don't need spray.
export const OTHER_IN_PLAY: AtBatResult[] = ["FC", "E"];
export const PRODUCTIVE: AtBatResult[] = ["SAC", "SF", "DP", "TP"];
export const IN_PLAY: AtBatResult[] = [...HITS, ...OUTS_IN_PLAY, ...OTHER_IN_PLAY];

export const isInPlay = (r: AtBatResult): boolean => IN_PLAY.includes(r);

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

export const RESULT_LABEL: Record<AtBatResult, string> = {
  K_swinging: "K↘", K_looking: "Kᴸ",
  BB: "BB", IBB: "IBB", HBP: "HBP",
  "1B": "1B", "2B": "2B", "3B": "3B", HR: "HR",
  FO: "Fly out", GO: "Ground out", LO: "Line out", PO: "Popout", IF: "Infield fly",
  FC: "FC", SAC: "SAC", SF: "SF", E: "Error", DP: "DP", TP: "TP",
  CI: "CI",
};

export const RESULT_DESC: Partial<Record<AtBatResult, string>> = {
  K_swinging: "Strikeout swinging",
  K_looking: "Strikeout looking",
  BB: "Walk", IBB: "Intentional walk", HBP: "Hit by pitch",
  "1B": "Single", "2B": "Double", "3B": "Triple", HR: "Home run",
  FO: "Flyout", GO: "Ground out", LO: "Lineout", PO: "Popout", IF: "Infield fly",
  FC: "Fielder's choice", E: "Reached on error",
  SAC: "Sacrifice bunt", SF: "Sacrifice fly",
  DP: "Double play", TP: "Triple play",
  CI: "Catcher's interference",
};

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

// Used by the undo toast: a one-liner describing what an event was, before
// we void it. Kept loose — coaches don't need legal-grade event descriptions,
// just enough to recognize what's being reverted.
export function describeEvent(event: GameEventRecord, names: Map<string, string>): string {
  switch (event.event_type) {
    case "at_bat": {
      const p = event.payload as AtBatPayload;
      if (p.description) return p.description;
      const result = RESULT_DESC[p.result] ?? p.result;
      const who = p.batter_id ? names.get(p.batter_id) ?? "batter" : "opp";
      return `${result} (${who})`;
    }
    case "pitch": {
      const p = event.payload as PitchPayload;
      const labels: Record<PitchType, string> = {
        ball: "ball",
        called_strike: "called strike",
        swinging_strike: "swinging strike",
        foul: "foul",
        in_play: "in-play",
        hbp: "hit by pitch",
        foul_tip_caught: "foul tip caught",
        pitchout: "pitchout",
        intentional_ball: "intentional ball",
      };
      return labels[p.pitch_type] ?? p.pitch_type;
    }
    case "stolen_base": {
      const p = event.payload as StolenBasePayload;
      return `stolen base (${p.from} → ${p.to})`;
    }
    case "caught_stealing": return "caught stealing";
    case "pickoff": return "pickoff";
    case "wild_pitch": return "wild pitch";
    case "passed_ball": return "passed ball";
    case "balk": return "balk";
    case "error_advance": return "error advance";
    case "inning_end": return "end of ½ inning";
    case "substitution": {
      const p = event.payload as SubstitutionPayload;
      const inName = names.get(p.in_player_id) ?? "sub";
      return `sub (${inName} → slot ${p.batting_order})`;
    }
    case "pitching_change": {
      const p = event.payload as PitchingChangePayload;
      const inName = p.in_pitcher_id ? names.get(p.in_pitcher_id) ?? "new pitcher" : "new pitcher";
      return `pitching change (${inName})`;
    }
    case "defensive_conference": return "mound visit";
    case "position_change": return "position change";
    case "game_started": return "game start";
    case "game_finalized": return "finalize";
    case "correction": return "edit";
    default: return event.event_type;
  }
}
