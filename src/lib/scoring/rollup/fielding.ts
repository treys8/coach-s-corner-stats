// Per-fielder stat rollup.
//
// Phase A captured PO/E/DP/TP against the primary `fielder_position`.
// Stage 3 (v2 live scoring) adds drag-chain capture: when `fielder_chain`
// is present on the at_bat, the rollup credits A on every non-terminal
// step and PO on the terminal step (PO collapses to A when the play
// didn't retire anyone). `error_step_index` pulls a single step out of
// the A/PO line and credits it as E. Legacy events without a chain still
// flow through the `fielder_position` path.

import type { DerivedAtBat, FielderTouch } from "../types";
import {
  PUTOUT_FIELDER_RESULTS,
  STRIKEOUT_RESULTS,
} from "../at-bat-classifications";

export interface FieldingLine {
  TC: number;
  A: number;
  PO: number;
  E: number;
  DP: number;
  TP: number;
  PB: number;
  SB: number;
  SBATT: number;
  CS: number;
  PIK: number;
  CI: number;
  /** Per-position innings (decimal, sum-friendly: outs / 3). Cleanly
   *  additive across games unlike baseball-thirds notation. */
  P: number;
  C: number;
  "1B": number;
  "2B": number;
  "3B": number;
  SS: number;
  LF: number;
  CF: number;
  RF: number;
  Total: number;
  FPCT: number;
  "CS%": number;
}

export interface CatcherEventLog {
  stolen_bases: { catcher_id: string | null }[];
  /** caught_stealing entries may carry a `fielder_chain_player_ids`
   *  snapshot — when present rollupFielding credits A on every non-terminal
   *  step and PO on the terminal step. Catcher CS credit is independent
   *  and lands via `catcher_id`. */
  caught_stealing: {
    catcher_id: string | null;
    fielder_chain_player_ids?: (string | null)[];
  }[];
  pickoffs: {
    catcher_id: string | null;
    fielder_chain_player_ids?: (string | null)[];
  }[];
  passed_balls: { catcher_id: string | null }[];
  /** Between-PA error_advance events with the fielder credited for the
   *  error already resolved. Each entry adds +1 E to the named fielder. */
  error_advance_fielders?: { fielder_player_id: string }[];
}

const FIELDING_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

function emptyFielding(): FieldingLine {
  return {
    TC: 0, A: 0, PO: 0, E: 0, DP: 0, TP: 0,
    PB: 0, SB: 0, SBATT: 0, CS: 0, PIK: 0, CI: 0,
    P: 0, C: 0, "1B": 0, "2B": 0, "3B": 0,
    SS: 0, LF: 0, CF: 0, RF: 0,
    Total: 0,
    FPCT: 0, "CS%": 0,
  };
}

// Walk a fielder chain and credit A/PO/E per step.
//
// Default behavior (CS/PO running events): A on every non-terminal step,
// PO on the terminal step. CS and PO always produce an out so the terminal
// step is always a putout — no chain-ends-without-out branch.
//
// At-bat chains pass extra context:
//   - `errorStepIndex` swaps PO/A on that step for E.
//   - `terminalIsOut === false` collapses the terminal step to A (or skips
//     it entirely if it's a solo chain) — used when the chain ends without
//     retiring anyone (hit, FC, error).
//   - `isDpOrTp` + `chain` enables the non-terminal-receiver bonus: on
//     DP/TP a non-terminal `received` step on a base is itself a force-out,
//     so the fielder gets both PO (retire) and A (throw to next).
function creditFielderChain(
  chainIds: (string | null)[] | undefined,
  ensure: (id: string) => FieldingLine,
  opts: {
    chain?: FielderTouch[];
    errorStepIndex?: number | null;
    terminalIsOut?: boolean;
    isDpOrTp?: boolean;
  } = {},
): void {
  if (!chainIds || chainIds.length === 0) return;
  const {
    chain,
    errorStepIndex = null,
    terminalIsOut = true,
    isDpOrTp = false,
  } = opts;
  const lastIdx = chainIds.length - 1;
  for (let i = 0; i < chainIds.length; i++) {
    const pid = chainIds[i];
    if (!pid) continue;
    if (errorStepIndex === i) {
      ensure(pid).E += 1;
    } else if (i === lastIdx) {
      if (terminalIsOut) {
        ensure(pid).PO += 1;
      } else if (lastIdx > 0) {
        ensure(pid).A += 1;
      }
    } else {
      ensure(pid).A += 1;
      if (
        isDpOrTp &&
        chain &&
        chain[i].action === "received" &&
        chain[i].target
      ) {
        ensure(pid).PO += 1;
      }
    }
  }
}

/**
 * Compute per-player fielding lines from the replay state.
 *
 * Credits (Stage 3):
 *   - K_swinging/K_looking → catcher PO (unless batter reached on K3).
 *   - CI → catcher CI.
 *   - With `fielder_chain` present: A on every non-terminal step, PO on
 *     terminal step (collapses to A when no out was recorded); the step at
 *     `error_step_index` swaps PO/A for E. DP/TP overlay still credits
 *     primary fielder for the column count.
 *   - Without `fielder_chain` (legacy): PO on primary for FO/GO/LO/PO/IF,
 *     E on primary for result === "E", DP/TP on primary for those results.
 *   - PB / SB / CS / PIK: catcher recorded at event time.
 *   - SBATT = SB + CS. TC = PO + A + E. FPCT = (PO + A) / TC.
 *   - CS% = CS / (SB + CS). Per-position innings: outs / 3.
 */
export function rollupFielding(
  atBats: DerivedAtBat[],
  innings: { [player_id: string]: { [position: string]: number } },
  catcherEvents: CatcherEventLog,
): Map<string, FieldingLine> {
  const out = new Map<string, FieldingLine>();
  const ensure = (id: string): FieldingLine => {
    let line = out.get(id);
    if (!line) {
      line = emptyFielding();
      out.set(id, line);
    }
    return line;
  };

  // Per-position innings + total from the outs ledger.
  for (const [playerId, byPos] of Object.entries(innings)) {
    const line = ensure(playerId);
    let total = 0;
    for (const pos of FIELDING_POSITIONS) {
      const outs = byPos[pos] ?? 0;
      if (outs > 0) {
        line[pos] = outs / 3;
        total += outs / 3;
      }
    }
    line.Total = total;
  }

  // PO / E / DP / TP / CI from at_bats. Snapshot fields on DerivedAtBat
  // (`fielder_player_id`, `catcher_player_id`) are populated by replay
  // only when we were fielding, so we don't credit a player we don't
  // roster. Strikeouts and catcher's interference credit the catcher;
  // batted-ball outs credit the primary fielder.
  for (const ab of atBats) {
    if (STRIKEOUT_RESULTS.has(ab.result)) {
      // Uncaught K3 (batter_reached_on_k3 set) means the catcher did NOT
      // catch the third strike — no PO credit, even though the pitcher
      // still gets the K. The fielder who eventually retired the runner
      // (if any) would land on the corresponding `error_advance` or a
      // follow-up play; we don't fabricate that credit here.
      if (ab.catcher_player_id && !ab.batter_reached_on_k3) {
        ensure(ab.catcher_player_id).PO += 1;
      }
      continue;
    }
    if (ab.result === "CI") {
      if (ab.catcher_player_id) ensure(ab.catcher_player_id).CI += 1;
      continue;
    }

    // Stage 3 path: when a fielder_chain is present, walk the chain via
    // the shared helper. Result-level overlays (DP/TP) still credit the
    // primary fielder for the existing column counts.
    const chain = ab.fielder_chain;
    const chainIds = ab.fielder_chain_player_ids;
    const isDpOrTp = ab.result === "DP" || ab.result === "TP";
    if (chain && chain.length > 0 && chainIds && chainIds.length === chain.length) {
      creditFielderChain(chainIds, ensure, {
        chain,
        errorStepIndex: ab.error_step_index ?? null,
        terminalIsOut: ab.outs_recorded > 0 && ab.result !== "E",
        isDpOrTp,
      });
      if (ab.fielder_player_id) {
        if (ab.result === "DP") ensure(ab.fielder_player_id).DP += 1;
        else if (ab.result === "TP") ensure(ab.fielder_player_id).TP += 1;
      }
      continue;
    }

    // Legacy / chain-absent path: credit the primary fielder via the
    // existing fielder_position snapshot.
    if (!ab.fielder_player_id) continue;

    if (PUTOUT_FIELDER_RESULTS.has(ab.result)) {
      ensure(ab.fielder_player_id).PO += 1;
    } else if (ab.result === "E") {
      ensure(ab.fielder_player_id).E += 1;
    } else if (ab.result === "DP") {
      ensure(ab.fielder_player_id).DP += 1;
    } else if (ab.result === "TP") {
      ensure(ab.fielder_player_id).TP += 1;
    }
  }

  // Catcher-credited events. catcher_id is null when we were batting (the
  // catcher in play is the opponent's), so those entries are skipped.
  for (const ev of catcherEvents.passed_balls) {
    if (ev.catcher_id) ensure(ev.catcher_id).PB += 1;
  }
  for (const ev of catcherEvents.stolen_bases) {
    if (ev.catcher_id) ensure(ev.catcher_id).SB += 1;
  }
  for (const ev of catcherEvents.caught_stealing) {
    if (ev.catcher_id) ensure(ev.catcher_id).CS += 1;
    creditFielderChain(ev.fielder_chain_player_ids, ensure);
  }
  for (const ev of catcherEvents.pickoffs) {
    if (ev.catcher_id) ensure(ev.catcher_id).PIK += 1;
    creditFielderChain(ev.fielder_chain_player_ids, ensure);
  }
  for (const ev of catcherEvents.error_advance_fielders ?? []) {
    ensure(ev.fielder_player_id).E += 1;
  }

  // Derive composite counts and rates.
  for (const line of out.values()) {
    line.SBATT = line.SB + line.CS;
    line.TC = line.PO + line.A + line.E;
    line.FPCT = line.TC > 0 ? (line.PO + line.A) / line.TC : 0;
    line["CS%"] = line.SBATT > 0 ? line.CS / line.SBATT : 0;
  }

  return out;
}
