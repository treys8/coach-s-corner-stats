import { describe, expect, it } from "vitest";
import { deriveBattingRates, safeDiv } from "../derived";

describe("safeDiv", () => {
  it("divides normally", () => {
    expect(safeDiv(3, 4)).toBe(0.75);
  });

  it("returns 0 when denominator is zero", () => {
    expect(safeDiv(5, 0)).toBe(0);
  });

  it("returns 0 when denominator is negative", () => {
    // Negative denominators can arise from BABIP when SO+HR > AB+SF (impossible
    // in real data but guarded anyway). Treat as 0 rather than emitting a
    // negative rate.
    expect(safeDiv(5, -1)).toBe(0);
  });
});

describe("deriveBattingRates", () => {
  it("returns all zeros when counts are zero", () => {
    const rates = deriveBattingRates({
      AB: 0, H: 0, HR: 0, SO: 0, BB: 0, HBP: 0, SF: 0,
    });
    expect(rates.AVG).toBe(0);
    expect(rates.OBP).toBe(0);
    expect(rates.SLG).toBe(0);
    expect(rates.OPS).toBe(0);
    expect(rates.BABIP).toBe(0);
    expect(rates["BB/K"]).toBe(0);
    expect(rates["SB%"]).toBe(0);
  });

  it("computes the basic slash line", () => {
    const rates = deriveBattingRates({
      AB: 100, H: 30, HR: 5, SO: 20, BB: 10, HBP: 2, SF: 1,
      "1B": 15, "2B": 7, "3B": 3,
    });
    expect(rates.AVG).toBeCloseTo(0.300, 3);
    // OBP = (30 + 10 + 2) / (100 + 10 + 2 + 1) = 42 / 113
    expect(rates.OBP).toBeCloseTo(42 / 113, 4);
    // TB = 15 + 14 + 9 + 20 = 58 → SLG = 58/100
    expect(rates.SLG).toBeCloseTo(0.58, 3);
    expect(rates.OPS).toBeCloseTo(rates.OBP + rates.SLG, 6);
  });

  it("prefers explicit TB over reconstructed TB", () => {
    const rates = deriveBattingRates({
      AB: 100, H: 30, HR: 5, SO: 20, BB: 10, HBP: 0, SF: 0,
      TB: 99, // intentionally weird value to prove TB wins
      "1B": 15, "2B": 7, "3B": 3,
    });
    expect(rates.SLG).toBeCloseTo(0.99, 6);
  });

  it("BABIP excludes home runs from numerator and adds SF to denominator", () => {
    // AB=100, H=30, HR=5, SO=20, SF=1 → BABIP = (30-5) / (100-20-5+1) = 25/76
    const rates = deriveBattingRates({
      AB: 100, H: 30, HR: 5, SO: 20, BB: 0, HBP: 0, SF: 1,
    });
    expect(rates.BABIP).toBeCloseTo(25 / 76, 4);
  });

  it("handles all-walks (zero AB) without NaN", () => {
    const rates = deriveBattingRates({
      AB: 0, H: 0, HR: 0, SO: 0, BB: 4, HBP: 0, SF: 0,
    });
    expect(rates.AVG).toBe(0);
    expect(rates.SLG).toBe(0);
    expect(rates.OBP).toBe(1); // 4 / (0+4+0+0) = 1.000
    expect(Number.isFinite(rates.OPS)).toBe(true);
  });

  it("AB/HR returns 0 when HR is 0 instead of Infinity", () => {
    const rates = deriveBattingRates({
      AB: 50, H: 15, HR: 0, SO: 10, BB: 5, HBP: 0, SF: 0,
    });
    expect(rates["AB/HR"]).toBe(0);
  });

  it("SB% from SB and CS only", () => {
    const rates = deriveBattingRates({
      AB: 1, H: 0, HR: 0, SO: 0, BB: 0, HBP: 0, SF: 0,
      SB: 7, CS: 3,
    });
    expect(rates["SB%"]).toBeCloseTo(0.7, 6);
  });
});
