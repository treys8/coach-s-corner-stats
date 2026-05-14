"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { postEvent } from "@/lib/scoring/events-client";
import type {
  AtBatPayload,
  AtBatResult,
  CorrectionPayload,
  DerivedAtBat,
  ReplayState,
  RunnerAdvance,
} from "@/lib/scoring/types";
import { autoRBI } from "@/lib/scoring/at-bat-helpers";
import type { UseGameEventsResult } from "./useGameEvents";

interface UseTimingPlayPromptArgs {
  gameId: string;
  state: ReplayState;
  names: Map<string, string>;
  submitting: boolean;
  setSubmitting: UseGameEventsResult["setSubmitting"];
  applyPostResult: UseGameEventsResult["applyPostResult"];
}

export interface PendingTimingPlay {
  atBat: DerivedAtBat;
  runnerLabel: string | null;
}

export interface UseTimingPlayPromptResult {
  pendingTimingPlay: PendingTimingPlay | null;
  resolveTimingPlay: (counted: boolean) => Promise<void>;
}

// Results we never prompt on. K outcomes always end the inning on force-
// side outs that can't include a non-force 3rd out scoring R3. DP/TP are
// multi-out plays with embedded force outs; coach can correct via Edit
// Last Play if a timing nuance applies. Walks, HBP, HR, etc. can't be
// 3rd-out-scenarios in this way.
const SKIP_RESULTS = new Set<AtBatResult>([
  "K_swinging",
  "K_looking",
  "BB",
  "IBB",
  "HBP",
  "HR",
  "DP",
  "TP",
  "CI",
]);

/** Watches state.at_bats for the trigger: an at_bat that completed the
 *  3rd out AND included a runner crossing home AND wasn't a force-heavy
 *  multi-out compound. On match, exposes a `pendingTimingPlay` for the
 *  caller to surface; `resolveTimingPlay(counted)` either confirms (no
 *  engine change) or nullifies the run via a correction event. */
export function useTimingPlayPrompt({
  gameId,
  state,
  names,
  submitting,
  setSubmitting,
  applyPostResult,
}: UseTimingPlayPromptArgs): UseTimingPlayPromptResult {
  const [pending, setPending] = useState<PendingTimingPlay | null>(null);
  // event_ids we've already shown the prompt for, so a re-render or a
  // resolve doesn't re-open the dialog.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const lastAB = state.at_bats[state.at_bats.length - 1];
    if (!lastAB) return;
    if (seen.current.has(lastAB.event_id)) return;
    // Did this PA close the half? The live state's inning/half advances
    // when the auto-emitted inning_end fires (server chains it after a
    // 3rd-out at_bat); comparing to the AB's inning/half tells us. The
    // game-finalized case ALSO advances state.status, but inning/half
    // stay the same in the final tick — we still want to prompt then,
    // since a walk-off can hinge on timing-play judgment.
    const inningEnded =
      state.inning !== lastAB.inning || state.half !== lastAB.half;
    if (!inningEnded) return;

    if (SKIP_RESULTS.has(lastAB.result)) return;
    if (lastAB.runs_scored_on_play === 0) return;
    if (lastAB.outs_recorded === 0) return;

    // Identify the (first) scoring runner who wasn't the batter — that's
    // the one whose timing the umpire judged.
    const scoringAdvance = lastAB.runner_advances.find(
      (a) => a.to === "home" && a.from !== "batter",
    );
    if (!scoringAdvance) return; // batter-only HR-ish, force-heavy

    const runnerLabel = labelForRunner(scoringAdvance, names);
    seen.current.add(lastAB.event_id);
    setPending({ atBat: lastAB, runnerLabel });
  }, [state.at_bats, state.inning, state.half, names]);

  const resolveTimingPlay = async (counted: boolean): Promise<void> => {
    if (!pending) return;
    if (counted) {
      // Default behavior: run already counted. Nothing to do.
      setPending(null);
      return;
    }
    // Nullify: post a correction that rewrites the home-bound advance
    // to a returned-to-third (or "out" if no return is reasonable). For
    // a tag-out-at-the-plate timing play, the runner is OUT; tightest
    // representation is `to: out` with rbi recomputed and an extra out
    // added. The inning_end already fired with the original out count,
    // but the corrected payload's outs are still ≥ original, so the
    // half doesn't reopen.
    setSubmitting(true);
    const corrected = nullifyScoringRunner(pending.atBat);
    const correctionPayload: CorrectionPayload = {
      superseded_event_id: pending.atBat.event_id,
      corrected_event_type: "at_bat",
      corrected_payload: corrected,
    };
    const result = await postEvent(gameId, {
      client_event_id: `tp-${pending.atBat.event_id}`,
      event_type: "correction",
      payload: correctionPayload,
    });
    setSubmitting(false);
    if (!result.ok) {
      setPending(null);
      return;
    }
    toast.success("Run nullified — timing play");
    applyPostResult(result);
    setPending(null);
  };

  return { pendingTimingPlay: pending, resolveTimingPlay };
}

function labelForRunner(adv: RunnerAdvance, names: Map<string, string>): string | null {
  if (adv.player_id) {
    const full = names.get(adv.player_id);
    if (full) {
      const m = full.match(/^#\S+\s+(.*)$/);
      return m ? m[1] : full;
    }
  }
  // Opposing or missing — fall back to a base name ("Runner from third").
  const base = adv.from === "third" ? "third" : adv.from === "second" ? "second" : "first";
  return `Runner from ${base}`;
}

/** Build the corrected AtBatPayload for the "No" branch of the timing
 *  prompt: rewrite the first non-batter home-bound advance to `to: out`,
 *  recompute rbi against the modified plan. Other fields pass through. */
function nullifyScoringRunner(ab: DerivedAtBat): AtBatPayload {
  let mutated = false;
  const runner_advances: RunnerAdvance[] = ab.runner_advances.map((a) => {
    if (!mutated && a.from !== "batter" && a.to === "home") {
      mutated = true;
      return { from: a.from, to: "out", player_id: a.player_id };
    }
    return a;
  });
  const rbi = autoRBI(runner_advances, ab.result, ab.bases_before);
  return {
    inning: ab.inning,
    half: ab.half,
    batter_id: ab.batter_id,
    opponent_batter_id: ab.opponent_batter_id,
    pitcher_id: ab.pitcher_id,
    opponent_pitcher_id: ab.opponent_pitcher_id,
    batting_order: ab.batting_order,
    result: ab.result,
    rbi,
    pitch_count: ab.pitch_count,
    balls: ab.balls,
    strikes: ab.strikes,
    spray_x: ab.spray_x,
    spray_y: ab.spray_y,
    fielder_position: ab.fielder_position,
    runner_advances,
    description: ab.description,
    batter_reached_on_k3: ab.batter_reached_on_k3,
    fielder_chain: ab.fielder_chain,
    batted_ball_type: ab.batted_ball_type,
    error_step_index: ab.error_step_index ?? null,
  };
}
