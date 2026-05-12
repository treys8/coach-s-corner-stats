import { describe, expect, it } from "vitest";
import { canRecord } from "./at-bat-helpers";
import { INITIAL_STATE } from "./types";
import type { BaseRunner, ReplayState } from "./types";

const runner = (id: string): BaseRunner => ({
  player_id: id,
  pitcher_of_record_id: null,
  reached_on_error: false,
});

function state(overrides: {
  outs?: number;
  first?: BaseRunner | null;
  second?: BaseRunner | null;
  third?: BaseRunner | null;
}): ReplayState {
  return {
    ...INITIAL_STATE,
    outs: overrides.outs ?? 0,
    bases: {
      first: overrides.first ?? null,
      second: overrides.second ?? null,
      third: overrides.third ?? null,
    },
  };
}

describe("canRecord", () => {
  it("non-PRODUCTIVE outcomes are always recordable", () => {
    expect(canRecord("1B", state({}))).toBe(true);
    expect(canRecord("K_swinging", state({ outs: 2 }))).toBe(true);
    expect(canRecord("BB", state({}))).toBe(true);
    expect(canRecord("HR", state({ outs: 2 }))).toBe(true);
    expect(canRecord("E", state({}))).toBe(true);
  });

  it("SAC requires at least one runner and <2 outs", () => {
    expect(canRecord("SAC", state({}))).toBe(false); // empty
    expect(canRecord("SAC", state({ first: runner("a") }))).toBe(true);
    expect(canRecord("SAC", state({ first: runner("a"), outs: 2 }))).toBe(false);
  });

  it("SF requires runner on third and <2 outs", () => {
    expect(canRecord("SF", state({}))).toBe(false);
    expect(canRecord("SF", state({ first: runner("a") }))).toBe(false);
    expect(canRecord("SF", state({ third: runner("c") }))).toBe(true);
    expect(canRecord("SF", state({ third: runner("c"), outs: 2 }))).toBe(false);
  });

  it("DP requires a runner and <2 outs", () => {
    expect(canRecord("DP", state({}))).toBe(false);
    expect(canRecord("DP", state({ first: runner("a") }))).toBe(true);
    expect(canRecord("DP", state({ first: runner("a"), outs: 2 }))).toBe(false);
  });

  it("TP requires 2+ runners and 0 outs", () => {
    expect(canRecord("TP", state({}))).toBe(false);
    expect(canRecord("TP", state({ first: runner("a") }))).toBe(false);
    expect(canRecord("TP", state({ first: runner("a"), second: runner("b") }))).toBe(true);
    expect(
      canRecord("TP", state({ first: runner("a"), second: runner("b"), outs: 1 })),
    ).toBe(false);
  });
});
