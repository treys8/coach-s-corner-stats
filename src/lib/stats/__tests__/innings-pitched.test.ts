import { describe, expect, it } from "vitest";
import { eraFromOuts, ipToOuts, outsToIp, whipFromOuts } from "../innings-pitched";

describe("ipToOuts", () => {
  it("converts whole innings", () => {
    expect(ipToOuts(7.0)).toBe(21);
    expect(ipToOuts(0)).toBe(0);
  });

  it("converts third-of-inning notation", () => {
    expect(ipToOuts(7.1)).toBe(22);
    expect(ipToOuts(7.2)).toBe(23);
  });

  it("rejects malformed fractions by dropping them", () => {
    // .5 is not valid in baseball notation; discard the fractional part.
    expect(ipToOuts(7.5)).toBe(21);
    expect(ipToOuts(7.9)).toBe(21);
  });

  it("guards against bad inputs", () => {
    expect(ipToOuts(NaN)).toBe(0);
    expect(ipToOuts(-1)).toBe(0);
    expect(ipToOuts(Infinity)).toBe(0);
  });
});

describe("outsToIp", () => {
  it("maps outs back to IP notation", () => {
    expect(outsToIp(0)).toBe(0);
    expect(outsToIp(1)).toBeCloseTo(0.1, 6);
    expect(outsToIp(2)).toBeCloseTo(0.2, 6);
    expect(outsToIp(3)).toBeCloseTo(1.0, 6);
    expect(outsToIp(22)).toBeCloseTo(7.1, 6);
  });
});

describe("ipToOuts / outsToIp round-trip", () => {
  it("is stable for outs ∈ [0, 30]", () => {
    for (let outs = 0; outs <= 30; outs++) {
      expect(ipToOuts(outsToIp(outs))).toBe(outs);
    }
  });
});

describe("eraFromOuts", () => {
  it("returns ER * 9 / IP", () => {
    // 3 ER, 27 outs (9 innings) → 3.00
    expect(eraFromOuts(3, 27)).toBeCloseTo(3.0, 6);
    // 4 ER, 18 outs (6 innings) → 6.00
    expect(eraFromOuts(4, 18)).toBeCloseTo(6.0, 6);
  });

  it("returns 0 when no outs were recorded", () => {
    expect(eraFromOuts(2, 0)).toBe(0);
  });
});

describe("whipFromOuts", () => {
  it("returns (BB+H) / IP", () => {
    // 9 baserunners across 9 innings (27 outs) → WHIP 1.00
    expect(whipFromOuts(9, 27)).toBeCloseTo(1.0, 6);
  });

  it("returns 0 when no outs were recorded", () => {
    expect(whipFromOuts(5, 0)).toBe(0);
  });
});
