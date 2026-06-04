// Display helpers for at-bat outcomes. Pure rendering — no engine logic,
// no game-state dependencies. UI components and toast messages live here.

import type {
  AtBatPayload,
  AtBatResult,
  FielderTouch,
  GameEventRecord,
  PitchPayload,
  PitchType,
  PitchingChangePayload,
  StolenBasePayload,
  SubstitutionPayload,
} from "./types";

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

// Map a fielder position abbreviation to its 1..9 scorebook digit. Returns
// the original token for unknown values so notation degrades gracefully if
// a coach somehow gets an off-roster string in there.
const POSITION_DIGIT: Record<string, string> = {
  P: "1", C: "2",
  "1B": "3", "2B": "4", "3B": "5", SS: "6",
  LF: "7", CF: "8", RF: "9",
};

/** Scorebook notation for a fielder chain. Examples:
 *  - `[{P:6,A:fielded}, {P:3,A:received,target:first}]`           → "6-3"
 *  - `[{P:8,A:caught}]`                                           → "F8"
 *  - `[{P:4,A:fielded}, {P:6,A:received,target:second}, {P:3,...}]` → "4-6-3"
 *  - with `errorStepIndex=1` (the throw)                          → "6 E4"
 *
 *  Result-aware prefixes: FO/LO/PO render as "F8" / "L6" / "P3" when the
 *  chain has a single step. SF gets an "SF" prefix on single-step chains.
 *  Two+ step chains always render as digit-dash digits. Foul indicator
 *  appends "(f)" when `foulOut=true`. */
export function chainNotation(
  chain: FielderTouch[] | undefined,
  result: AtBatResult,
  errorStepIndex: number | null | undefined,
  foulOut: boolean | undefined,
): string | null {
  if (!chain || chain.length === 0) return null;
  const digits = chain.map((t) => POSITION_DIGIT[t.position] ?? t.position);
  const errIdx = errorStepIndex ?? null;

  // Single-step + outfielder caught fly → F8 / L6 / P3 by result type.
  if (chain.length === 1 && errIdx === null) {
    const d = digits[0];
    if (result === "FO" || result === "IF") return foulOut ? `F${d}(f)` : `F${d}`;
    if (result === "LO") return `L${d}`;
    if (result === "PO") return foulOut ? `F${d}(f)` : `P${d}`;
    if (result === "SF") return `SF${d}`;
  }

  // Error somewhere in the chain → render non-error portion as digit-dash
  // and tag the error step. Two patterns covered:
  //   - error on first touch (mishandled grounder): "E6"
  //   - error on a throw: "6 E4"
  if (errIdx !== null && errIdx >= 0 && errIdx < digits.length) {
    if (errIdx === 0) {
      const tail = digits.slice(1).join("-");
      return tail ? `E${digits[0]}-${tail}` : `E${digits[0]}`;
    }
    const head = digits.slice(0, errIdx).join("-");
    return `${head} E${digits[errIdx]}`;
  }

  return digits.join("-");
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
    case "advance_on_throw": return "advanced on the throw";
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
