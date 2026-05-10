import { describe, expect, it } from "vitest";
import { computePitcherWorkload } from "./workload";
import { restDaysFor, DEFAULT_HIGH_SCHOOL_LIMITS } from "./pitch-limits";

describe("restDaysFor", () => {
  it("0 days for ≤25 pitches", () => {
    expect(restDaysFor(20)).toBe(0);
    expect(restDaysFor(25)).toBe(0);
  });
  it("1 day for 26-40", () => {
    expect(restDaysFor(26)).toBe(1);
    expect(restDaysFor(40)).toBe(1);
  });
  it("2 days for 41-55", () => {
    expect(restDaysFor(50)).toBe(2);
  });
  it("3 days for 56-70", () => {
    expect(restDaysFor(70)).toBe(3);
  });
  it("4 days for 71+", () => {
    expect(restDaysFor(80)).toBe(4);
    expect(restDaysFor(110)).toBe(4);
  });
});

describe("computePitcherWorkload", () => {
  it("no prior outings → no rest violation", () => {
    const result = computePitcherWorkload([], "2026-05-10");
    expect(result.rest_violation).toBe(false);
    expect(result.last_outing_date).toBeNull();
    expect(result.required_rest_days).toBe(0);
  });

  it("threw 80 pitches yesterday → 4 days rest required, only 1 elapsed → violation", () => {
    const result = computePitcherWorkload(
      [{ game_date: "2026-05-09", pitches: 80 }],
      "2026-05-10",
    );
    expect(result.last_outing_pitches).toBe(80);
    expect(result.required_rest_days).toBe(4);
    expect(result.elapsed_days).toBe(1);
    expect(result.rest_violation).toBe(true);
  });

  it("threw 30 pitches 2 days ago (1 day rest required, 2 elapsed) → no violation", () => {
    const result = computePitcherWorkload(
      [{ game_date: "2026-05-08", pitches: 30 }],
      "2026-05-10",
    );
    expect(result.required_rest_days).toBe(1);
    expect(result.elapsed_days).toBe(2);
    expect(result.rest_violation).toBe(false);
  });

  it("pitches today are reported separately from prior-outing rest", () => {
    const result = computePitcherWorkload(
      [
        { game_date: "2026-05-10", pitches: 45 },
        { game_date: "2026-05-08", pitches: 20 },
      ],
      "2026-05-10",
    );
    expect(result.pitches_today).toBe(45);
    expect(result.last_outing_pitches).toBe(20);
    expect(result.required_rest_days).toBe(0);
    expect(result.pitches_remaining_today).toBe(DEFAULT_HIGH_SCHOOL_LIMITS.max_pitches_per_day - 45);
  });
});
