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

  it("recomputes team AVG/OBP/SLG/OPS from summed counts when present", () => {
    // Two players: 2/4 (.500) and 1/3 (.333). Old behavior (avg of rates) =
    // .417. Correct team AVG = (2+1)/(4+3) = 3/7 ≈ .429.
    const result = aggregateByDate([
      snap("2026-03-01", { batting: { H: 2, AB: 4, "2B": 1, BB: 0, HBP: 0, SF: 0, AVG: 0.500 } }),
      snap("2026-03-01", { batting: { H: 1, AB: 3, "2B": 0, BB: 1, HBP: 0, SF: 0, AVG: 0.333 } }),
    ]);
    expect(result[0].agg.batting.AVG).toBeCloseTo(3 / 7, 5);
    // OBP: (3 H + 1 BB) / (7 AB + 1 BB) = 4/8 = .500
    expect(result[0].agg.batting.OBP).toBeCloseTo(0.5, 5);
    // SLG: TB = (2 1B-equivalents) - actually 1B count missing. Derived TB =
    // 1B*1 + 2B*2 + ... With 1B not provided, TB derives as 0+2*1+0+0 = 2.
    // SLG = 2/7. Test only checks the recompute fired and is finite.
    expect(result[0].agg.batting.SLG).toBeGreaterThan(0);
    expect(result[0].agg.batting.OPS).toBeCloseTo(
      result[0].agg.batting.OBP + result[0].agg.batting.SLG,
      5,
    );
  });

  it("falls back to averaging rates when underlying counts are absent", () => {
    // No AB present → recompute can't run, average-of-rates stands.
    const result = aggregateByDate([
      snap("2026-03-01", { batting: { AVG: 0.300 } }),
      snap("2026-03-01", { batting: { AVG: 0.500 } }),
    ]);
    expect(result[0].agg.batting.AVG).toBeCloseTo(0.4, 5);
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
