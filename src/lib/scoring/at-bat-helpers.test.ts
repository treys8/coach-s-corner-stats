import { describe, expect, it } from "vitest";
import { canRecord, chainNotation, defaultBattedBallType } from "./at-bat-helpers";
import { INITIAL_STATE } from "./types";
import type { BaseRunner, FielderTouch, ReplayState } from "./types";

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

describe("chainNotation", () => {
  const t = (position: string, action: FielderTouch["action"], target?: FielderTouch["target"]): FielderTouch =>
    target ? { position, action, target } : { position, action };

  it("returns null on empty/undefined chain", () => {
    expect(chainNotation(undefined, "GO", null, false)).toBeNull();
    expect(chainNotation([], "GO", null, false)).toBeNull();
  });

  it("single-step caught fly renders as F<digit>", () => {
    expect(chainNotation([t("CF", "caught")], "FO", null, false)).toBe("F8");
    expect(chainNotation([t("LF", "caught")], "FO", null, false)).toBe("F7");
  });

  it("single-step pop out renders as P<digit>", () => {
    expect(chainNotation([t("2B", "caught")], "PO", null, false)).toBe("P4");
  });

  it("foul pop renders with (f) suffix on PO", () => {
    expect(chainNotation([t("C", "caught")], "PO", null, true)).toBe("F2(f)");
  });

  it("single-step line out renders as L<digit>", () => {
    expect(chainNotation([t("SS", "caught")], "LO", null, false)).toBe("L6");
  });

  it("multi-step grounder renders dash-separated digits", () => {
    const chain = [
      t("SS", "fielded"),
      t("1B", "received", "first"),
    ];
    expect(chainNotation(chain, "GO", null, false)).toBe("6-3");
  });

  it("6-4-3 double play renders correctly", () => {
    const chain = [
      t("SS", "fielded"),
      t("2B", "received", "second"),
      t("1B", "received", "first"),
    ];
    expect(chainNotation(chain, "DP", null, false)).toBe("6-4-3");
  });

  it("error on first step renders E<digit> with tail when present", () => {
    expect(chainNotation([t("SS", "fielded")], "E", 0, false)).toBe("E6");
    expect(
      chainNotation(
        [t("SS", "fielded"), t("1B", "received", "first")],
        "1B",
        0,
        false,
      ),
    ).toBe("E6-3");
  });

  it("error on a throw renders as <head> E<digit>", () => {
    const chain = [
      t("SS", "fielded"),
      t("2B", "received"),
    ];
    expect(chainNotation(chain, "1B", 1, false)).toBe("6 E4");
  });

  it("SF single-step renders as SF<digit>", () => {
    expect(chainNotation([t("RF", "caught")], "SF", null, false)).toBe("SF9");
  });
});

describe("defaultBattedBallType", () => {
  it("maps result to implied batted-ball type", () => {
    expect(defaultBattedBallType("FO")).toBe("fly");
    expect(defaultBattedBallType("SF")).toBe("fly");
    expect(defaultBattedBallType("IF")).toBe("fly");
    expect(defaultBattedBallType("LO")).toBe("line");
    expect(defaultBattedBallType("PO")).toBe("pop");
    expect(defaultBattedBallType("GO")).toBe("ground");
    expect(defaultBattedBallType("SAC")).toBe("bunt");
  });

  it("returns null for outcomes without an implied type", () => {
    expect(defaultBattedBallType("1B")).toBeNull();
    expect(defaultBattedBallType("HR")).toBeNull();
    expect(defaultBattedBallType("BB")).toBeNull();
    expect(defaultBattedBallType("E")).toBeNull();
    expect(defaultBattedBallType("FC")).toBeNull();
  });
});
