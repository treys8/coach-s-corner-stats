import { describe, expect, it } from "vitest";
import { normalizePlayerName } from "../normalize";

describe("normalizePlayerName", () => {
  it("lowercases", () => {
    expect(normalizePlayerName("Smith")).toBe("smith");
    expect(normalizePlayerName("MCDONALD")).toBe("mcdonald");
  });

  it("trims whitespace and trailing punctuation", () => {
    expect(normalizePlayerName("  Smith  ")).toBe("smith");
    expect(normalizePlayerName("Smith.")).toBe("smith");
    expect(normalizePlayerName("Bobby Jr.")).toBe("bobby jr");
  });

  it("collapses internal whitespace runs", () => {
    expect(normalizePlayerName("Van  Der  Berg")).toBe("van der berg");
    expect(normalizePlayerName("Van\tDer\nBerg")).toBe("van der berg");
  });

  it("strips both straight and curly apostrophes/quotes", () => {
    expect(normalizePlayerName("O'Brien")).toBe("obrien");
    expect(normalizePlayerName("O’Brien")).toBe("obrien"); // curly '
    expect(normalizePlayerName(`"Smith"`)).toBe("smith");
  });

  it("NFKC-folds wide characters and ligatures", () => {
    expect(normalizePlayerName("Ｊａｎｅ")).toBe("jane"); // fullwidth Jane
    expect(normalizePlayerName("Cliﬀ")).toBe("cliff"); // ﬀ ligature
  });

  it("produces a single collapsed key for variants of the same name", () => {
    const variants = [
      "Smith",
      "smith",
      " SMITH ",
      "'Smith'",
      "Smith.",
    ];
    expect(new Set(variants.map(normalizePlayerName)).size).toBe(1);
  });
});
