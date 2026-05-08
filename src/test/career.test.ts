import { describe, expect, it } from "vitest";
import { aggregateCareer } from "@/lib/career";
import type { SnapshotStats } from "@/lib/snapshots";

const snap = (
  upload_date: string,
  stats: SnapshotStats,
): { upload_date: string; stats: SnapshotStats } => ({ upload_date, stats });

describe("aggregateCareer", () => {
  it("sums batting counters and recomputes AVG/OBP/SLG/OPS from sums", () => {
    // Two seasons, contrived numbers so we can hand-check the arithmetic.
    const snapshots = [
      snap("2025-04-01", {
        batting: { AB: 100, H: 30, BB: 10, HBP: 0, SF: 0, TB: 45, AVG: 0.300, OBP: 0.364, SLG: 0.450, OPS: 0.814 },
        pitching: {},
        fielding: {},
      }),
      snap("2026-04-01", {
        batting: { AB: 200, H: 80, BB: 20, HBP: 0, SF: 0, TB: 130, AVG: 0.400, OBP: 0.455, SLG: 0.650, OPS: 1.105 },
        pitching: {},
        fielding: {},
      }),
    ];
    const career = aggregateCareer(snapshots, "batting");
    expect(career.AB).toBe(300);
    expect(career.H).toBe(110);
    expect(career.TB).toBe(175);
    // Career AVG must be 110/300 = .3667, NOT (.300 + .400)/2 = .350.
    expect(career.AVG).toBeCloseTo(110 / 300, 6);
    expect(career.SLG).toBeCloseTo(175 / 300, 6);
    expect(career.OBP).toBeCloseTo((110 + 30) / (300 + 30), 6);
    expect(career.OPS).toBeCloseTo(career.OBP! + career.SLG!, 6);
  });

  it("converts pitching IP via outs (7.1 + 2.2 = 10.0 innings)", () => {
    const snapshots = [
      snap("2025-04-01", {
        batting: {},
        pitching: { IP: 7.1, ER: 2, BB: 1, H: 4, SO: 8 },
        fielding: {},
      }),
      snap("2026-04-01", {
        batting: {},
        pitching: { IP: 2.2, ER: 1, BB: 0, H: 1, SO: 2 },
        fielding: {},
      }),
    ];
    const career = aggregateCareer(snapshots, "pitching");
    // 7.1 = 22 outs, 2.2 = 8 outs → 30 outs = 10 IP exactly.
    expect(career.IP).toBe(10);
    expect(career.ERA).toBeCloseTo((3 * 9) / 10, 6);
    expect(career.WHIP).toBeCloseTo((1 + 5) / 10, 6);
    expect(career["K/BB"]).toBeCloseTo(10 / 1, 6);
  });

  it("recomputes fielding FPCT from summed PO/A/TC", () => {
    const snapshots = [
      snap("2025-04-01", {
        batting: {},
        pitching: {},
        fielding: { TC: 50, PO: 30, A: 18, E: 2 },
      }),
      snap("2026-04-01", {
        batting: {},
        pitching: {},
        fielding: { TC: 100, PO: 60, A: 38, E: 2 },
      }),
    ];
    const career = aggregateCareer(snapshots, "fielding");
    expect(career.TC).toBe(150);
    expect(career.E).toBe(4);
    expect(career.FPCT).toBeCloseTo((90 + 56) / 150, 6);
  });

  it("returns an empty object when there are no snapshots", () => {
    const career = aggregateCareer([], "batting");
    expect(career).toEqual({});
  });
});
