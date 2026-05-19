import { describe, expect, it } from "vitest";
import {
  HIT_RESULTS,
  NON_AB_RESULTS,
  STRIKEOUT_RESULTS,
  WALK_RESULTS,
} from "../at-bat-classifications";

describe("at-bat classifications", () => {
  it("HIT_RESULTS covers the four hit outcomes", () => {
    expect(HIT_RESULTS.has("1B")).toBe(true);
    expect(HIT_RESULTS.has("2B")).toBe(true);
    expect(HIT_RESULTS.has("3B")).toBe(true);
    expect(HIT_RESULTS.has("HR")).toBe(true);
    expect(HIT_RESULTS.has("BB")).toBe(false);
    expect(HIT_RESULTS.has("E")).toBe(false);
    expect(HIT_RESULTS.size).toBe(4);
  });

  it("WALK_RESULTS covers BB and IBB only", () => {
    expect(WALK_RESULTS.has("BB")).toBe(true);
    expect(WALK_RESULTS.has("IBB")).toBe(true);
    expect(WALK_RESULTS.has("HBP")).toBe(false);
    expect(WALK_RESULTS.size).toBe(2);
  });

  it("STRIKEOUT_RESULTS covers swinging and looking only", () => {
    expect(STRIKEOUT_RESULTS.has("K_swinging")).toBe(true);
    expect(STRIKEOUT_RESULTS.has("K_looking")).toBe(true);
    // K-L is the BOX-SCORE column (looking-K count), NOT an AtBatResult.
    // It must not appear in the classifier.
    expect(STRIKEOUT_RESULTS.has("K-L")).toBe(false);
    expect(STRIKEOUT_RESULTS.size).toBe(2);
  });

  it("NON_AB_RESULTS includes all PA-not-AB outcomes", () => {
    // Per PDF §3: BB, IBB, HBP, SAC, SF, CI are all PA but not AB.
    expect(NON_AB_RESULTS.has("BB")).toBe(true);
    expect(NON_AB_RESULTS.has("IBB")).toBe(true);
    expect(NON_AB_RESULTS.has("HBP")).toBe(true);
    expect(NON_AB_RESULTS.has("SAC")).toBe(true);
    expect(NON_AB_RESULTS.has("SF")).toBe(true);
    expect(NON_AB_RESULTS.has("CI")).toBe(true);
    // DP / TP DO count as AB (PG-style scoring) and must NOT be here.
    expect(NON_AB_RESULTS.has("DP")).toBe(false);
    expect(NON_AB_RESULTS.has("TP")).toBe(false);
    // E reaches base but is still an AB.
    expect(NON_AB_RESULTS.has("E")).toBe(false);
    expect(NON_AB_RESULTS.size).toBe(6);
  });
});
