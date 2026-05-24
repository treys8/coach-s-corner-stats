import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Smell test for the at_bats correction-upsert fix (audit item #8).
//
// The write_derived_state RPC originally used `ON CONFLICT (event_id) DO
// NOTHING` for the at_bats insert, which silently swallowed corrections:
// re-deriving after a supersedes event left the existing at_bats row
// stale. The 20260524140000 migration switches that clause to
// `DO UPDATE SET ...` so the latest replay always wins.
//
// A full regression test would need a live Postgres + RLS context that
// isn't practical in the unit suite. Instead we pin the migration text
// itself: if a future change reverts the clause to DO NOTHING, or drops
// any of the projected columns from the SET list, this test fails. The
// real verification path is code review plus manual edit-last-play.

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260524140000_at_bats_upsert_do_update.sql",
);

const PROJECTED_COLUMNS = [
  "inning",
  "half",
  "batting_order",
  "batter_id",
  "opponent_batter_id",
  "pitcher_id",
  "opponent_pitcher_id",
  "result",
  "rbi",
  "pitch_count",
  "balls",
  "strikes",
  "spray_x",
  "spray_y",
  "fielder_position",
  "runs_scored_on_play",
  "outs_recorded",
  "description",
] as const;

describe("at_bats correction upsert migration", () => {
  const rawSql = readFileSync(MIGRATION_PATH, "utf8");
  // Strip SQL line comments before matching — the comment header
  // intentionally quotes both the old (DO NOTHING) and new (DO UPDATE)
  // clauses, which would otherwise satisfy / poison the regexes below.
  const sql = rawSql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  it("uses ON CONFLICT (event_id) DO UPDATE for at_bats", () => {
    expect(sql).toMatch(/ON CONFLICT \(event_id\) DO UPDATE SET/);
    expect(sql).not.toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
  });

  it("overwrites every projected column on conflict", () => {
    const match = sql.match(
      /ON CONFLICT \(event_id\) DO UPDATE SET([\s\S]*?);/,
    );
    expect(match, "at_bats DO UPDATE SET clause not found").not.toBeNull();
    const setClause = match![1];
    for (const col of PROJECTED_COLUMNS) {
      expect(setClause).toMatch(
        new RegExp(`\\b${col}\\b\\s*=\\s*EXCLUDED\\.${col}\\b`),
      );
    }
  });

  it("preserves the concurrency guard and GRANT", () => {
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/p_expected_last_seq/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.write_derived_state\(UUID, JSONB, INTEGER\) TO authenticated/,
    );
  });
});
