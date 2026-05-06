import { describe, it, expect } from "vitest";
import { seasonYearFor, isSeasonClosed, currentSeasonYear } from "@/lib/season";

describe("seasonYearFor", () => {
  // A season is Feb 1 – May 31. Off-season dates roll back to the most recent
  // season year: Jun–Dec → that calendar year, Jan → prior calendar year.

  it("Feb 1 is the first day of that year's season", () => {
    expect(seasonYearFor(new Date(2026, 1, 1))).toBe(2026);
  });

  it("May 31 is the last day of that year's season", () => {
    expect(seasonYearFor(new Date(2026, 4, 31))).toBe(2026);
  });

  it("Jun 1 rolls back to the just-closed season", () => {
    expect(seasonYearFor(new Date(2026, 5, 1))).toBe(2026);
  });

  it("Dec 31 is still in the previous season's offseason", () => {
    expect(seasonYearFor(new Date(2026, 11, 31))).toBe(2026);
  });

  it("Jan 1 crosses year boundary but stays with prior season", () => {
    expect(seasonYearFor(new Date(2027, 0, 1))).toBe(2026);
  });

  it("Jan 31 is the last day before the new season opens", () => {
    expect(seasonYearFor(new Date(2027, 0, 31))).toBe(2026);
  });

  it("Feb 1 of next year opens the new season", () => {
    expect(seasonYearFor(new Date(2027, 1, 1))).toBe(2027);
  });

  it("accepts ISO date strings (as used by HTML date inputs)", () => {
    expect(seasonYearFor("2026-03-15")).toBe(2026);
    expect(seasonYearFor("2027-01-15")).toBe(2026);
  });
});

describe("isSeasonClosed", () => {
  it("May 31 of the season year is NOT closed yet", () => {
    expect(isSeasonClosed(2026, new Date(2026, 4, 31, 12, 0, 0))).toBe(false);
  });

  it("Jun 1 of the season year IS closed", () => {
    expect(isSeasonClosed(2026, new Date(2026, 5, 1, 0, 0, 0))).toBe(true);
  });

  it("any date in a future season year is not closed", () => {
    expect(isSeasonClosed(2027, new Date(2026, 5, 1))).toBe(false);
  });

  it("any date well after May 31 is closed", () => {
    expect(isSeasonClosed(2026, new Date(2027, 0, 15))).toBe(true);
  });
});

describe("currentSeasonYear", () => {
  it("returns the season year of the supplied date", () => {
    expect(currentSeasonYear(new Date(2026, 2, 15))).toBe(2026);
    expect(currentSeasonYear(new Date(2027, 0, 15))).toBe(2026);
    expect(currentSeasonYear(new Date(2027, 1, 1))).toBe(2027);
  });
});
