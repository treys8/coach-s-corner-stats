import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDatePart, formatGameTime, localToday } from "@/lib/date-display";

describe("formatDatePart", () => {
  it("renders the school's local date regardless of viewer locale", () => {
    // 2026-01-15 anchored at UTC noon → still Jan 15 in Los Angeles (UTC-8).
    expect(formatDatePart("2026-01-15", "month-day", "America/Los_Angeles"))
      .toBe("Jan 15");
  });

  it("does not roll back a day when the school is east of UTC", () => {
    // Sydney is UTC+11 in January. Noon UTC → 11 pm Sydney same day.
    expect(formatDatePart("2026-01-15", "month-day", "Australia/Sydney"))
      .toBe("Jan 15");
  });

  it("formats weekday-long parts", () => {
    // Jan 15 2026 is a Thursday in any reasonable TZ.
    expect(formatDatePart("2026-01-15", "weekday-long", "America/Chicago"))
      .toBe("Thursday");
  });

  it("formats long parts (weekday + month + day)", () => {
    expect(formatDatePart("2026-05-15", "long", "America/Chicago"))
      .toContain("May 15");
  });
});

describe("formatGameTime", () => {
  it("converts 24-hour Postgres TIME to 12-hour", () => {
    expect(formatGameTime("17:00")).toBe("5:00 pm");
    expect(formatGameTime("09:30")).toBe("9:30 am");
    expect(formatGameTime("00:00")).toBe("12:00 am");
    expect(formatGameTime("12:00")).toBe("12:00 pm");
  });
});

describe("localToday", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the local date in YYYY-MM-DD form for the given timezone", () => {
    // 2026-05-15 23:30 UTC = 2026-05-15 18:30 Chicago (UTC-5 in May)
    vi.setSystemTime(new Date("2026-05-15T23:30:00Z"));
    expect(localToday("America/Chicago")).toBe("2026-05-15");
  });

  it("uses the school's timezone, not UTC", () => {
    // 2026-05-16 03:30 UTC = 2026-05-15 22:30 Chicago (still May 15).
    // A naive `toISOString().slice(0,10)` would return "2026-05-16" — wrong.
    vi.setSystemTime(new Date("2026-05-16T03:30:00Z"));
    expect(localToday("America/Chicago")).toBe("2026-05-15");
  });
});
