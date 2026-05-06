import { describe, it, expect } from "vitest";
import { aggregateByDate, type AggregateInput } from "@/lib/aggregate";

const snap = (date: string, stats: AggregateInput["stats"]): AggregateInput => ({
  upload_date: date,
  stats,
});

describe("aggregateByDate", () => {
  it("returns empty array for empty input", () => {
    expect(aggregateByDate([])).toEqual([]);
  });

  it("sums counting stats across players on the same date", () => {
    const result = aggregateByDate([
      snap("2026-03-01", { batting: { H: 3, HR: 1 } }),
      snap("2026-03-01", { batting: { H: 2, HR: 0 } }),
      snap("2026-03-01", { batting: { H: 5, HR: 2 } }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].agg.batting.H).toBe(10);
    expect(result[0].agg.batting.HR).toBe(3);
  });

  it("averages rate stats across players that recorded the stat", () => {
    const result = aggregateByDate([
      snap("2026-03-01", { batting: { AVG: 0.300 } }),
      snap("2026-03-01", { batting: { AVG: 0.200 } }),
      snap("2026-03-01", { batting: { AVG: 0.400 } }),
    ]);
    expect(result[0].agg.batting.AVG).toBeCloseTo(0.300, 5);
  });

  it("rate average ignores players who don't have that stat", () => {
    const result = aggregateByDate([
      snap("2026-03-01", { batting: { AVG: 0.400 } }),
      snap("2026-03-01", { batting: { H: 1 } }), // no AVG → skipped from average
    ]);
    // Mean of just the one player who had AVG.
    expect(result[0].agg.batting.AVG).toBeCloseTo(0.400, 5);
  });

  it("drops unknown stats from the rollup", () => {
    const result = aggregateByDate([
      snap("2026-03-01", { batting: { H: 1, MADE_UP_STAT: 999 } }),
    ]);
    expect(result[0].agg.batting.H).toBe(1);
    expect(result[0].agg.batting).not.toHaveProperty("MADE_UP_STAT");
  });

  it("ignores non-numeric values in the stat block", () => {
    const result = aggregateByDate([
      snap("2026-03-01", { batting: { H: 2 } }),
      snap("2026-03-01", { batting: { H: "DNP" } }),
    ]);
    expect(result[0].agg.batting.H).toBe(2);
  });

  it("groups separate dates into separate result entries, sorted ascending", () => {
    const result = aggregateByDate([
      snap("2026-04-15", { batting: { H: 5 } }),
      snap("2026-03-08", { batting: { H: 3 } }),
      snap("2026-03-01", { batting: { H: 1 } }),
    ]);
    expect(result.map((r) => r.date)).toEqual(["2026-03-01", "2026-03-08", "2026-04-15"]);
    expect(result[0].agg.batting.H).toBe(1);
    expect(result[1].agg.batting.H).toBe(3);
    expect(result[2].agg.batting.H).toBe(5);
  });

  it("aggregates each section independently", () => {
    const result = aggregateByDate([
      snap("2026-03-01", {
        batting: { H: 2 },
        pitching: { SO: 4, ERA: 2.50 },
        fielding: { TC: 3 },
      }),
      snap("2026-03-01", {
        batting: { H: 1 },
        pitching: { SO: 6, ERA: 4.50 },
        fielding: { TC: 5 },
      }),
    ]);
    expect(result[0].agg.batting.H).toBe(3);
    expect(result[0].agg.pitching.SO).toBe(10);
    expect(result[0].agg.pitching.ERA).toBeCloseTo(3.50, 5);
    expect(result[0].agg.fielding.TC).toBe(8);
  });

  it("treats missing sections as empty (no error)", () => {
    const result = aggregateByDate([
      snap("2026-03-01", { batting: { H: 4 } }), // no pitching, no fielding
    ]);
    expect(result[0].agg.batting.H).toBe(4);
    expect(result[0].agg.pitching).toEqual({});
    expect(result[0].agg.fielding).toEqual({});
  });
});
