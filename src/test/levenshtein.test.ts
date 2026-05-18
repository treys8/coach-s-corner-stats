import { describe, it, expect } from "vitest";
import { levenshtein } from "@/lib/strings/levenshtein";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("smith", "smith")).toBe(0);
  });

  it("returns length when one side is empty", () => {
    expect(levenshtein("", "smith")).toBe(5);
    expect(levenshtein("smith", "")).toBe(5);
  });

  it("counts a single substitution as 1", () => {
    expect(levenshtein("smith", "smyth")).toBe(1);
  });

  it("counts a single insertion as 1", () => {
    expect(levenshtein("smith", "smiths")).toBe(1);
    expect(levenshtein("smith", "smithh")).toBe(1);
  });

  it("counts a single deletion as 1", () => {
    expect(levenshtein("smith", "smit")).toBe(1);
    expect(levenshtein("smith", "smih")).toBe(1);
  });

  it("counts a transposition as 2 (Levenshtein, not Damerau)", () => {
    // "smtih" vs "smith" — swap of i/t — Levenshtein scores 2 (one sub + one
    // sub), Damerau-Levenshtein would score 1. We use plain Levenshtein, and
    // the threshold of 2 still catches single transpositions.
    expect(levenshtein("smtih", "smith")).toBe(2);
  });

  it("handles common typo cases <= 2", () => {
    expect(levenshtein("johnson", "jonson")).toBe(1);  // dropped letter
    expect(levenshtein("johnson", "johnsen")).toBe(1); // vowel sub
    expect(levenshtein("mcdonald", "macdonald")).toBe(1); // inserted letter
    expect(levenshtein("garcia", "garca")).toBe(1);    // dropped letter
  });

  it("scores genuinely different names well above 2", () => {
    expect(levenshtein("smith", "johnson")).toBeGreaterThan(2);
    expect(levenshtein("garcia", "rodriguez")).toBeGreaterThan(2);
  });

  it("is symmetric", () => {
    expect(levenshtein("smith", "smyth")).toBe(levenshtein("smyth", "smith"));
    expect(levenshtein("johnson", "jonson")).toBe(levenshtein("jonson", "johnson"));
  });

  it("handles full-name strings (first + space + last)", () => {
    expect(levenshtein("john smith", "jon smith")).toBe(1);
    expect(levenshtein("john smith", "john smyth")).toBe(1);
    expect(levenshtein("bobby jr", "bobby jr")).toBe(0);
  });
});
