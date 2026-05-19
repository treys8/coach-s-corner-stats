import { describe, expect, it } from "vitest";
import { normalizeOpponentName } from "../normalize";

describe("normalizeOpponentName", () => {
  it("trims whitespace", () => {
    expect(normalizeOpponentName("  Meridian  ")).toBe("meridian");
  });

  it("strips leading '@' marker (with or without space)", () => {
    expect(normalizeOpponentName("@ Meridian")).toBe("meridian");
    expect(normalizeOpponentName("@Meridian")).toBe("meridian");
  });

  it("strips leading 'at' and 'vs' prefixes", () => {
    expect(normalizeOpponentName("at Meridian")).toBe("meridian");
    expect(normalizeOpponentName("vs Meridian")).toBe("meridian");
    expect(normalizeOpponentName("vs. Meridian")).toBe("meridian");
    expect(normalizeOpponentName("AT Meridian")).toBe("meridian");
  });

  it("lowercases for case-insensitive dedup", () => {
    expect(normalizeOpponentName("MERIDIAN")).toBe("meridian");
    expect(normalizeOpponentName("Meridian")).toBe("meridian");
  });

  it("collapses common variants to one key", () => {
    const variants = ["Meridian", "  Meridian", "@ Meridian", "vs Meridian", "MERIDIAN"];
    expect(new Set(variants.map(normalizeOpponentName)).size).toBe(1);
  });

  it("does not strip 'at' that is part of a real word", () => {
    // "Atlanta HS" should normalize to "atlanta hs", not "lanta hs".
    expect(normalizeOpponentName("Atlanta HS")).toBe("atlanta hs");
  });
});
