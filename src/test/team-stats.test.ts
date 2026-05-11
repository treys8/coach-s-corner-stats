import { describe, expect, it } from "vitest";
import { buildLeaderboard, qualifierNote, MIN_AB, MIN_IP } from "@/lib/team-stats";
import type { SnapshotStats } from "@/lib/snapshots";

const snap = (stats: SnapshotStats): { stats: SnapshotStats } => ({ stats });

describe("buildLeaderboard", () => {
  it("excludes batters who don't meet the MIN_AB qualifier for rate stats", () => {
    const latestByPlayer = {
      qualified: snap({ batting: { AB: MIN_AB, AVG: 0.300 }, pitching: {}, fielding: {} }),
      tooFew: snap({ batting: { AB: MIN_AB - 1, AVG: 1.000 }, pitching: {}, fielding: {} }),
    };
    const rows = buildLeaderboard(latestByPlayer, "batting", "AVG");
    expect(rows).toHaveLength(1);
    expect(rows[0].player_id).toBe("qualified");
    expect(rows[0].value).toBe(0.300);
  });

  it("excludes pitchers who don't meet the MIN_IP qualifier for rate stats", () => {
    const latestByPlayer = {
      qualified: snap({ batting: {}, pitching: { IP: MIN_IP, ERA: 2.50 }, fielding: {} }),
      tooFew: snap({ batting: {}, pitching: { IP: MIN_IP - 0.1, ERA: 0.00 }, fielding: {} }),
    };
    const rows = buildLeaderboard(latestByPlayer, "pitching", "ERA");
    expect(rows).toHaveLength(1);
    expect(rows[0].player_id).toBe("qualified");
    expect(rows[0].value).toBe(2.50);
  });

  it("includes counting stats regardless of AB / IP", () => {
    // A counting stat like H or SO should not gate on the rate-qualifier.
    const latestByPlayer = {
      a: snap({ batting: { AB: 1, H: 1 }, pitching: {}, fielding: {} }),
      b: snap({ batting: { AB: 100, H: 30 }, pitching: {}, fielding: {} }),
    };
    const rows = buildLeaderboard(latestByPlayer, "batting", "H");
    expect(rows).toHaveLength(2);
  });

  it("excludes rows with non-finite or non-number stat values", () => {
    const latestByPlayer = {
      good: snap({ batting: { AB: 10, AVG: 0.350 }, pitching: {}, fielding: {} }),
      missing: snap({ batting: { AB: 10 }, pitching: {}, fielding: {} }),
      stringy: snap({ batting: { AB: 10, AVG: "n/a" }, pitching: {}, fielding: {} }),
      // Infinity / NaN can't survive the JSON round-trip from Supabase, but the
      // typeof+isFinite gate is the contract — assert it.
      infinite: snap({ batting: { AB: 10, AVG: Number.POSITIVE_INFINITY }, pitching: {}, fielding: {} }),
    };
    const rows = buildLeaderboard(latestByPlayer, "batting", "AVG");
    expect(rows.map((r) => r.player_id)).toEqual(["good"]);
  });

  it("excludes rate-stat rows when AB / IP itself is missing", () => {
    const latestByPlayer = {
      noAb: snap({ batting: { AVG: 0.500 }, pitching: {}, fielding: {} }),
      noIp: snap({ batting: {}, pitching: { ERA: 1.00 }, fielding: {} }),
    };
    expect(buildLeaderboard(latestByPlayer, "batting", "AVG")).toEqual([]);
    expect(buildLeaderboard(latestByPlayer, "pitching", "ERA")).toEqual([]);
  });
});

describe("qualifierNote", () => {
  it("returns the AB note for batting rate stats", () => {
    expect(qualifierNote("batting", "AVG")).toBe(`Min ${MIN_AB} AB to qualify`);
    expect(qualifierNote("batting", "OPS")).toBe(`Min ${MIN_AB} AB to qualify`);
  });

  it("returns the IP note for pitching rate stats", () => {
    expect(qualifierNote("pitching", "ERA")).toBe(`Min ${MIN_IP} IP to qualify`);
    expect(qualifierNote("pitching", "WHIP")).toBe(`Min ${MIN_IP} IP to qualify`);
  });

  it("returns null for counting stats and fielding stats", () => {
    expect(qualifierNote("batting", "H")).toBeNull();
    expect(qualifierNote("pitching", "SO")).toBeNull();
    expect(qualifierNote("fielding", "FPCT")).toBeNull();
  });
});
