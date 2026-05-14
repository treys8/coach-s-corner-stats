import { describe, expect, it } from "vitest";
import {
  NFHS_DEFAULTS,
  mergeWithDefaults,
  resolveLeagueRules,
  type LeagueRulesRow,
} from "./league-defaults";

describe("mergeWithDefaults", () => {
  it("returns NFHS defaults for null/undefined input", () => {
    expect(mergeWithDefaults(null)).toEqual(NFHS_DEFAULTS);
    expect(mergeWithDefaults(undefined)).toEqual(NFHS_DEFAULTS);
  });

  it("fills missing fields from NFHS defaults", () => {
    const partial: Partial<LeagueRulesRow> = {
      mercy_threshold_runs: 15,
      mercy_threshold_inning: 3,
    };
    const merged = mergeWithDefaults(partial);
    expect(merged.mercy_threshold_runs).toBe(15);
    expect(merged.mercy_threshold_inning).toBe(3);
    expect(merged.pitch_count_max).toBe(NFHS_DEFAULTS.pitch_count_max);
    expect(merged.courtesy_runner_allowed).toBe(NFHS_DEFAULTS.courtesy_runner_allowed);
  });

  it("preserves alt thresholds as null (they're intentionally nullable)", () => {
    const merged = mergeWithDefaults({
      mercy_threshold_runs_alt: 15,
      mercy_threshold_inning_alt: 3,
    });
    expect(merged.mercy_threshold_runs_alt).toBe(15);
    expect(merged.mercy_threshold_inning_alt).toBe(3);
  });
});

describe("resolveLeagueRules lookup chain", () => {
  const seasonRow: Partial<LeagueRulesRow> = {
    season_year: 2026,
    mercy_threshold_runs: 12,
    pitch_count_max: 95,
  };
  const defaultRow: Partial<LeagueRulesRow> = {
    season_year: null,
    mercy_threshold_runs: 10,
    pitch_count_max: 100,
  };

  it("prefers season-specific row over default row", () => {
    const rules = resolveLeagueRules({ seasonRow, defaultRow });
    expect(rules.mercy_threshold_runs).toBe(12);
    expect(rules.pitch_count_max).toBe(95);
  });

  it("falls back to school default row when no season row", () => {
    const rules = resolveLeagueRules({ seasonRow: null, defaultRow });
    expect(rules.mercy_threshold_runs).toBe(10);
    expect(rules.pitch_count_max).toBe(100);
  });

  it("falls back to NFHS defaults when nothing matches", () => {
    const rules = resolveLeagueRules({ seasonRow: null, defaultRow: null });
    expect(rules).toEqual(NFHS_DEFAULTS);
  });

  it("uses NFHS defaults for fields the matched row leaves null", () => {
    const sparse: Partial<LeagueRulesRow> = {
      season_year: 2026,
      mercy_threshold_runs: 15,
    };
    const rules = resolveLeagueRules({ seasonRow: sparse, defaultRow: null });
    expect(rules.mercy_threshold_runs).toBe(15);
    expect(rules.pitch_count_max).toBe(NFHS_DEFAULTS.pitch_count_max);
    expect(rules.courtesy_runner_allowed).toBe(NFHS_DEFAULTS.courtesy_runner_allowed);
  });
});
