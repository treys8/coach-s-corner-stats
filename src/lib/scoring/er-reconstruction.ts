// OSR 9.16 "reconstruct the inning" for earned-run accounting.
//
// The pre-Stage-6b system used per-runner taint only: a runner who reached
// on an error / passed ball / dropped K3-on-E or -PB was flagged
// `reached_on_error`, and any run they later scored was unearned. That
// catches most cases but misses the canonical OSR 9.16 example: a runner
// who reached cleanly scores AFTER the team has already committed enough
// errors that the half-inning would have ended in a reconstruction. Those
// runs are unearned even though the runner himself wasn't error-tainted.
//
// Stage 6b adds the missing piece: walk each half-inning's events in
// chronological order, count "would-have-been outs" (actual outs +
// errors that should have produced an out), and mark the events at-or-after
// the cumulative count reaching 3 as `after_phantom_third_out`. The rollup
// then treats any run scored on those events as unearned, on top of the
// existing taint logic and the existing earned/unearned non-PA source split.
//
// Heuristic for phantom outs per PA:
//   - `result === 'E'` and outs_recorded === 0  →  +1 phantom out
//       (the play was an error; the batter would have been out)
//   - `error_step_index !== null` and the result is a hit/FC/safe-shaped
//     outcome with outs_recorded < ${expected actual outs assuming the throw
//     succeeded}  →  +1 phantom out (the bad throw would have produced
//     an out)
//   - K3-dropped on E or PB  →  no extra phantom out (the K already
//     records the actual out; the existing reached_on_error taint
//     handles the unearned run if the batter scores)
//   - All other PAs  →  phantom_outs = 0
//
// Non-PA running events (WP / PB / balk / error_advance / stolen_base)
// contribute no phantom outs — errors there move runners but don't
// substitute for a defensive out.

import type {
  AtBatResult,
  DerivedAtBat,
  InningHalf,
  NonPaRun,
} from "./types";

/** Results where the play itself is a defensive failure that allowed the
 *  batter to reach. result === 'E' on its own only marks the batter as
 *  reached-on-error; the play would have been an out in reconstruction. */
const HIT_RESULTS: ReadonlySet<AtBatResult> = new Set(["1B", "2B", "3B", "HR"]);

/** Compute the phantom-out delta for a single at_bat. */
export function phantomOutsForAtBat(ab: DerivedAtBat): number {
  // 'E' is the canonical "would-have-been out" play.
  if (ab.result === "E" && ab.outs_recorded === 0) return 1;

  // A hit (1B/2B/3B) with an error_step_index on the throw chain — the
  // hit lands cleanly, but a fielder's throw error let a runner advance
  // OR the batter take an extra base. In reconstruction the throw succeeds
  // and would have produced an out (commonly: batter thrown out trying to
  // stretch). Only count it when the play didn't already record an out
  // for that would-be retire.
  if (
    ab.error_step_index !== null &&
    ab.error_step_index !== undefined &&
    HIT_RESULTS.has(ab.result) &&
    ab.outs_recorded === 0
  ) {
    return 1;
  }

  return 0;
}

/** An item in the chronological timeline of a single half-inning. */
type TimelineItem =
  | { kind: "at_bat"; entry: DerivedAtBat; sequence: number }
  | { kind: "non_pa_run"; entry: NonPaRun; sequence: number };

/** Build the chronological timeline of (inning, half), interleaving
 *  at_bats and non_pa_runs by sequence. Items missing a sequence are
 *  treated as `+Infinity` so legacy entries sort to the end of the half
 *  — they don't disrupt earlier entries' reconstruction, which is the
 *  conservative choice. */
function buildTimeline(
  atBats: DerivedAtBat[],
  nonPaRuns: NonPaRun[],
  inning: number,
  half: InningHalf,
): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  for (const ab of atBats) {
    if (ab.inning !== inning || ab.half !== half) continue;
    timeline.push({
      kind: "at_bat",
      entry: ab,
      sequence: ab.sequence ?? Number.POSITIVE_INFINITY,
    });
  }
  for (const npr of nonPaRuns) {
    if (npr.inning !== inning || npr.half !== half) continue;
    timeline.push({
      kind: "non_pa_run",
      entry: npr,
      sequence: npr.sequence ?? Number.POSITIVE_INFINITY,
    });
  }
  timeline.sort((a, b) => a.sequence - b.sequence);
  return timeline;
}

/** Apply OSR 9.16 reconstruction to one half-inning's events. Returns
 *  fresh `atBats` / `nonPaRuns` arrays where entries in (inning, half)
 *  have `after_phantom_third_out` populated; entries from other halves
 *  are returned as-is (same identity).
 *
 *  The reconstruction walks the half in chronological order and tracks
 *  cumulative reconstructed outs (actual outs + phantom outs). The first
 *  event whose cumulative reconstructed outs reach ≥ 3 is the boundary —
 *  that event AND every subsequent event in the half are flagged
 *  `after_phantom_third_out`.
 *
 *  Edge case — boundary mid-PA: if a PA's own phantom outs push the
 *  cumulative count from <3 to ≥3, the PA itself is the would-have-been
 *  3rd out. Runs scoring on this PA are flagged unearned (the
 *  reconstruction would have ended the inning here, before the runs
 *  scored). If the PA's reconstructed outs are all actual outs (no
 *  phantom), the PA legitimately ends the half even in reconstruction —
 *  any run scored on this PA stays earned (subject to taint) but
 *  anything downstream is unearned.
 */
export function applyErReconstructionToHalf(
  atBats: DerivedAtBat[],
  nonPaRuns: NonPaRun[],
  inning: number,
  half: InningHalf,
): { atBats: DerivedAtBat[]; nonPaRuns: NonPaRun[] } {
  const timeline = buildTimeline(atBats, nonPaRuns, inning, half);

  // Build a map event_id → flag. We then walk both arrays once at the end
  // to produce fresh entries for the (inning, half) slice.
  const flagByEventId = new Map<string, boolean>();

  let reconstructedOuts = 0;
  let phantomThirdOutCrossed = false;

  for (const item of timeline) {
    const reconstructedOutsForEvent =
      item.kind === "at_bat"
        ? item.entry.outs_recorded + phantomOutsForAtBat(item.entry)
        : 0;

    if (phantomThirdOutCrossed) {
      flagByEventId.set(item.entry.event_id, true);
      continue;
    }

    const before = reconstructedOuts;
    reconstructedOuts += reconstructedOutsForEvent;

    if (before >= 3) {
      flagByEventId.set(item.entry.event_id, true);
      phantomThirdOutCrossed = true;
      continue;
    }

    if (reconstructedOuts >= 3) {
      const hasPhantom =
        item.kind === "at_bat" &&
        phantomOutsForAtBat(item.entry) > 0;
      if (hasPhantom) {
        flagByEventId.set(item.entry.event_id, true);
      }
      phantomThirdOutCrossed = true;
    }
  }

  if (flagByEventId.size === 0) {
    return { atBats, nonPaRuns };
  }

  const nextAtBats = atBats.map((ab) =>
    flagByEventId.get(ab.event_id)
      ? { ...ab, after_phantom_third_out: true }
      : ab,
  );
  const nextNonPaRuns = nonPaRuns.map((npr) =>
    flagByEventId.get(npr.event_id)
      ? { ...npr, after_phantom_third_out: true }
      : npr,
  );
  return { atBats: nextAtBats, nonPaRuns: nextNonPaRuns };
}
