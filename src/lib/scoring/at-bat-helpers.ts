// At-bat UI groupings + barrel re-exports.
//
// The display helpers (RESULT_LABEL/RESULT_DESC/describePlay/chainNotation/
// describeEvent) live in `at-bat-display.ts`; the engine helpers (canRecord/
// autoRBI/isOurHalf/formatOpposingSlotLabel/allUpAdvances/finalCount/
// buildChainAdvances/defaultBattedBallType) live in `at-bat-engine.ts`.
// This file re-exports both so existing import sites keep working.

import type { AtBatResult } from "./types";
import { HIT_RESULTS } from "./at-bat-classifications";

// Non-contact outcomes are one-tap. In-play outcomes arm drag mode on the
// defensive diamond — the user drags the fielder who made the play to the
// ball location, and the drop captures spray (x, y) + fielder_position.
export const NON_CONTACT: AtBatResult[] = ["K_swinging", "K_looking", "BB", "HBP"];
// Rarely-tapped outcomes hidden behind a "More" button so the primary row
// stays uncluttered. Coaches who reach for IBB or CI know to expand.
export const RARE_OUTCOMES: AtBatResult[] = ["IBB", "CI"];
// UI ordering of the four hit outcomes. Matches HIT_RESULTS (the engine SoT)
// in membership; the array form here lets the picker spread it into IN_PLAY.
export const HITS: AtBatResult[] = Array.from(HIT_RESULTS) as AtBatResult[];
export const OUTS_IN_PLAY: AtBatResult[] = ["FO", "GO", "LO", "PO"];
// FC and E are in-play with a fielder location.
export const OTHER_IN_PLAY: AtBatResult[] = ["FC", "E"];
// Productive outs and multi-out plays — bat-on-ball, so they ALSO need a
// fielder drag. SAC bunt, sac fly, double play, triple play.
export const PRODUCTIVE: AtBatResult[] = ["SAC", "SF", "DP", "TP"];
// Every batted-ball outcome — the coach must drag the fielder to the ball
// location to record spray + first-touch. IF (infield fly rule) included
// because the umpire's call lands on a high fly the fielder still catches.
export const IN_PLAY: AtBatResult[] = [
  ...HITS,
  ...OUTS_IN_PLAY,
  ...OTHER_IN_PLAY,
  ...PRODUCTIVE,
  "IF",
];

export const isInPlay = (r: AtBatResult): boolean => IN_PLAY.includes(r);

export {
  RESULT_LABEL,
  RESULT_DESC,
  describePlay,
  chainNotation,
  describeEvent,
} from "./at-bat-display";

export {
  canRecord,
  autoRBI,
  isOurHalf,
  formatOpposingSlotLabel,
  allUpAdvances,
  finalCount,
  buildChainAdvances,
  defaultBattedBallType,
} from "./at-bat-engine";
