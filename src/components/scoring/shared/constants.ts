import type { AtBatResult } from "@/lib/scoring/types";

// Non-contact outcomes are one-tap. In-play outcomes arm drag mode on the
// defensive diamond — the user drags the fielder who made the play to the
// ball location, and the drop captures spray (x, y) + fielder_position.
export const NON_CONTACT: AtBatResult[] = ["K_swinging", "K_looking", "BB", "HBP"];
export const HITS: AtBatResult[] = ["1B", "2B", "3B", "HR"];
export const OUTS_IN_PLAY: AtBatResult[] = ["FO", "GO", "LO", "PO"];
export const IN_PLAY: AtBatResult[] = [...HITS, ...OUTS_IN_PLAY];
export const isInPlay = (r: AtBatResult) => (IN_PLAY as AtBatResult[]).includes(r);

export const RESULT_LABEL: Record<AtBatResult, string> = {
  K_swinging: "K↘", K_looking: "Kᴸ",
  BB: "BB", IBB: "IBB", HBP: "HBP",
  "1B": "1B", "2B": "2B", "3B": "3B", HR: "HR",
  FO: "Fly out", GO: "Ground out", LO: "Line out", PO: "Popout", IF: "Infield fly",
  FC: "FC", SAC: "SAC", SF: "SF", E: "Error", DP: "DP", TP: "TP",
};

export const RESULT_DESC: Partial<Record<AtBatResult, string>> = {
  K_swinging: "Strikeout swinging",
  K_looking: "Strikeout looking",
  BB: "Walk", IBB: "Intentional walk", HBP: "Hit by pitch",
  "1B": "Single", "2B": "Double", "3B": "Triple", HR: "Home run",
  FO: "Flyout", GO: "Groundout", LO: "Lineout", PO: "Popout",
};

export const SUB_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"] as const;

export const EDIT_RESULTS: AtBatResult[] = [
  ...NON_CONTACT,
  ...HITS,
  ...OUTS_IN_PLAY,
];
