"use client";

import { Card } from "@/components/ui/card";
import type { LeagueRules } from "@/lib/scoring/league-defaults";
import type { ReplayState } from "@/lib/scoring/types";

interface Props {
  state: ReplayState;
  rules: LeagueRules;
}

/** Locked spec: banner only, no action button. Coach taps Finalize explicitly
 *  per the game-lifecycle table in [[live_scoring_v2_ux_direction]]. Two
 *  thresholds are evaluated (primary 10@5 and optional alt like 15@3); the
 *  banner shows the FIRST matching threshold so the early "15-after-3"
 *  variant takes precedence over the later 10@5 once both are met. */
export function MercyBanner({ state, rules }: Props) {
  const lead = Math.abs(state.team_score - state.opponent_score);

  // Check alt threshold first (earlier inning, larger lead is the typical
  // shape — e.g., 15@3 vs 10@5).
  const altInning = rules.mercy_threshold_inning_alt;
  const altRuns = rules.mercy_threshold_runs_alt;
  const altMatch =
    altInning != null && altRuns != null
      ? state.inning >= altInning && lead >= altRuns
      : false;

  const primaryMatch =
    state.inning >= rules.mercy_threshold_inning &&
    lead >= rules.mercy_threshold_runs;

  if (!altMatch && !primaryMatch) return null;
  if (state.status !== "in_progress" && state.status !== "suspended") return null;

  const runs = altMatch ? altRuns! : rules.mercy_threshold_runs;
  const inning = altMatch ? altInning! : rules.mercy_threshold_inning;

  return (
    <Card className="border-sa-orange bg-amber-50 p-3" role="status" aria-live="polite">
      <div className="text-xs uppercase tracking-wider font-display text-sa-orange">
        Mercy threshold reached
      </div>
      <p className="mt-1 text-sm text-amber-900">
        {`${runs}-run lead after inning ${inning}. Coach: finalize the game from the manage menu.`}
      </p>
    </Card>
  );
}
