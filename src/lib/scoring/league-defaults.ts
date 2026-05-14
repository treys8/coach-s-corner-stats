// NFHS default league rules and the game-time lookup chain.
//
// Stage 6a moves rule configuration off hardcoded constants and onto a per-
// (school, season_year) `league_rules` row. The lookup walks:
//
//   1. league_rules where (school_id, season_year) matches
//   2. league_rules where (school_id, season_year IS NULL)  — school default
//   3. NFHS defaults from this file                          — baseline
//
// teams.league_type / nfhs_state / pitch_limits stay as a per-team override
// layer for edge cases (varsity vs JV mercy variance, etc.) and continue to
// be consulted separately by the workload engine. See
// /docs/live-scoring/schema-deltas-v2.md §5.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PitchCountRestTier {
  /** Inclusive lower bound — pitches thrown that day to land in this tier. */
  pitches: number;
  /** Calendar days of rest required before next outing. */
  rest_days: number;
}

export interface LeagueRules {
  // Mercy
  mercy_threshold_runs: number;
  mercy_threshold_inning: number;
  mercy_threshold_runs_alt: number | null;
  mercy_threshold_inning_alt: number | null;

  // Pitch counts
  pitch_count_max: number;
  pitch_count_rest_tiers: PitchCountRestTier[];
  mid_batter_finish: boolean;

  // Substitutions
  courtesy_runner_allowed: boolean;
  reentry_starters_only: boolean;
  reentry_once_per_starter: boolean;

  // Field
  double_first_base: boolean;

  extras: Record<string, unknown>;
}

/** NFHS baseline that ships with a brand-new school. Mercy 10-run rule after
 *  5 innings is the federal standard; state associations layer their own
 *  alt thresholds (e.g., 15 after 3) on top. */
export const NFHS_DEFAULTS: LeagueRules = {
  mercy_threshold_runs: 10,
  mercy_threshold_inning: 5,
  mercy_threshold_runs_alt: null,
  mercy_threshold_inning_alt: null,

  pitch_count_max: 105,
  pitch_count_rest_tiers: [
    { pitches: 1,  rest_days: 0 },
    { pitches: 26, rest_days: 1 },
    { pitches: 36, rest_days: 2 },
    { pitches: 51, rest_days: 3 },
    { pitches: 76, rest_days: 4 },
  ],
  mid_batter_finish: true,

  courtesy_runner_allowed: true,
  reentry_starters_only: true,
  reentry_once_per_starter: true,

  double_first_base: false,

  extras: {},
};

/** Shape of a league_rules row as returned by Supabase. Columns we don't
 *  rely on in the lookup (id, school_id, season_year, timestamps) are
 *  intentionally omitted here. */
export type LeagueRulesRow = LeagueRules & {
  id: string;
  school_id: string;
  season_year: number | null;
};

/** Merge a DB row into the NFHS defaults. Any column that came back null on
 *  the row falls through to the default. The two alt-threshold columns are
 *  nullable by design and propagate as-is. */
export function mergeWithDefaults(
  row: Partial<LeagueRulesRow> | null | undefined,
): LeagueRules {
  if (!row) return { ...NFHS_DEFAULTS };
  return {
    mercy_threshold_runs: row.mercy_threshold_runs ?? NFHS_DEFAULTS.mercy_threshold_runs,
    mercy_threshold_inning: row.mercy_threshold_inning ?? NFHS_DEFAULTS.mercy_threshold_inning,
    mercy_threshold_runs_alt: row.mercy_threshold_runs_alt ?? null,
    mercy_threshold_inning_alt: row.mercy_threshold_inning_alt ?? null,

    pitch_count_max: row.pitch_count_max ?? NFHS_DEFAULTS.pitch_count_max,
    pitch_count_rest_tiers: row.pitch_count_rest_tiers ?? NFHS_DEFAULTS.pitch_count_rest_tiers,
    mid_batter_finish: row.mid_batter_finish ?? NFHS_DEFAULTS.mid_batter_finish,

    courtesy_runner_allowed: row.courtesy_runner_allowed ?? NFHS_DEFAULTS.courtesy_runner_allowed,
    reentry_starters_only: row.reentry_starters_only ?? NFHS_DEFAULTS.reentry_starters_only,
    reentry_once_per_starter: row.reentry_once_per_starter ?? NFHS_DEFAULTS.reentry_once_per_starter,

    double_first_base: row.double_first_base ?? NFHS_DEFAULTS.double_first_base,

    extras: row.extras ?? {},
  };
}

/** Game-time lookup. Picks the best matching row given (school_id, season).
 *  Caller passes both candidate rows (typically fetched together in one
 *  query) so this stays a pure function and is easy to unit test. */
export function resolveLeagueRules({
  seasonRow,
  defaultRow,
}: {
  seasonRow?: Partial<LeagueRulesRow> | null;
  defaultRow?: Partial<LeagueRulesRow> | null;
}): LeagueRules {
  if (seasonRow) return mergeWithDefaults(seasonRow);
  if (defaultRow) return mergeWithDefaults(defaultRow);
  return { ...NFHS_DEFAULTS };
}

/** Fetch and resolve league rules for (school_id, season_year). Reads both
 *  the season-specific row and the school's default row in one query and
 *  applies the lookup chain. Falls through to NFHS_DEFAULTS when no rows
 *  exist — a brand-new school is usable on day one without writing anything.
 *
 *  Note: callers in client components should pass the client from
 *  @/integrations/supabase/client; server components should pass the server
 *  client from @/lib/supabase/server. The shape is the same. */
export async function fetchLeagueRules(
  supabase: SupabaseClient,
  schoolId: string,
  seasonYear: number | null,
): Promise<LeagueRules> {
  const { data, error } = await supabase
    .from("league_rules")
    .select("*")
    .eq("school_id", schoolId)
    .or(
      seasonYear == null
        ? "season_year.is.null"
        : `season_year.eq.${seasonYear},season_year.is.null`,
    );

  if (error || !data) return { ...NFHS_DEFAULTS };

  const rows = data as Partial<LeagueRulesRow>[];
  const seasonRow = seasonYear == null
    ? null
    : rows.find((r) => r.season_year === seasonYear) ?? null;
  const defaultRow = rows.find((r) => r.season_year == null) ?? null;

  return resolveLeagueRules({ seasonRow, defaultRow });
}
