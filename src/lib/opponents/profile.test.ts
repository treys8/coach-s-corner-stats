import { describe, expect, it } from "vitest";
import {
  deriveOpposingBatterProfile,
  type RawOpposingAtBat,
} from "./profile";

const ID = "opp-1";
const IDENTITY = { first_name: "Sam", last_name: "Smith", jersey_number: "7" };

function ab(overrides: Partial<RawOpposingAtBat> = {}): RawOpposingAtBat {
  return {
    game_id: "g1",
    game_date: "2026-04-01",
    result: "K_swinging",
    rbi: 0,
    spray_x: null,
    spray_y: null,
    ...overrides,
  };
}

describe("deriveOpposingBatterProfile", () => {
  it("empty input → zeroed line, no spray, no games", () => {
    const p = deriveOpposingBatterProfile([], IDENTITY, ID);
    expect(p.player_id).toBe(ID);
    expect(p.identity).toEqual(IDENTITY);
    expect(p.line).toMatchObject({
      PA: 0, AB: 0, H: 0, HR: 0, BB: 0, SO: 0, HBP: 0, RBI: 0,
      "2B": 0, "3B": 0, AVG: 0, OBP: 0, SLG: 0,
    });
    expect(p.sprayPoints).toEqual([]);
    expect(p.games).toEqual([]);
  });

  it("counts PA/AB/H/HR/BB/SO/HBP correctly and accumulates RBI", () => {
    const rows: RawOpposingAtBat[] = [
      ab({ result: "1B", rbi: 0 }),
      ab({ result: "2B", rbi: 1 }),
      ab({ result: "3B", rbi: 2 }),
      ab({ result: "HR", rbi: 1 }),
      ab({ result: "BB" }),
      ab({ result: "HBP" }),
      ab({ result: "K_looking" }),
      ab({ result: "SF", rbi: 1 }),
      ab({ result: "FO" }), // AB out, not a hit
    ];
    const p = deriveOpposingBatterProfile(rows, IDENTITY, ID);
    expect(p.line.PA).toBe(9);
    // AB excludes BB / HBP / SF, so AB = 9 − 3 = 6.
    expect(p.line.AB).toBe(6);
    expect(p.line.H).toBe(4);
    expect(p.line.HR).toBe(1);
    expect(p.line["2B"]).toBe(1);
    expect(p.line["3B"]).toBe(1);
    expect(p.line.BB).toBe(1);
    expect(p.line.SO).toBe(1);
    expect(p.line.HBP).toBe(1);
    expect(p.line.RBI).toBe(5);
  });

  it("computes AVG / OBP / SLG correctly", () => {
    // 4 PA: 2 singles, 1 BB, 1 K. AB=3, H=2 → AVG=.667.
    // OBP denom = AB + BB + HBP + SF = 3+1+0+0 = 4; OBP = (2+1+0)/4 = .750.
    // SLG = 2 total bases / 3 AB = .667.
    const rows: RawOpposingAtBat[] = [
      ab({ result: "1B" }),
      ab({ result: "1B" }),
      ab({ result: "BB" }),
      ab({ result: "K_swinging" }),
    ];
    const p = deriveOpposingBatterProfile(rows, IDENTITY, ID);
    expect(p.line.AVG).toBeCloseTo(2 / 3, 5);
    expect(p.line.OBP).toBeCloseTo(0.75, 5);
    expect(p.line.SLG).toBeCloseTo(2 / 3, 5);
  });

  it("zero-AB doesn't divide by zero (1 BB only)", () => {
    const p = deriveOpposingBatterProfile(
      [ab({ result: "BB" })],
      IDENTITY,
      ID,
    );
    expect(p.line.AVG).toBe(0);
    expect(p.line.SLG).toBe(0);
    // OBP denom = AB + BB + HBP + SF = 0+1+0+0 = 1; (0+1+0)/1 = 1.000.
    expect(p.line.OBP).toBe(1);
  });

  it("collects spray points only when both spray coords are set", () => {
    const rows: RawOpposingAtBat[] = [
      ab({ result: "1B", spray_x: 0.2, spray_y: 0.3 }),
      ab({ result: "FO", spray_x: null, spray_y: 0.4 }), // dropped (x null)
      ab({ result: "2B", spray_x: 0.5, spray_y: 0.6 }),
    ];
    const p = deriveOpposingBatterProfile(rows, IDENTITY, ID);
    expect(p.sprayPoints).toHaveLength(2);
    expect(p.sprayPoints[0]).toMatchObject({ x: 0.2, y: 0.3, result: "1B" });
    expect(p.sprayPoints[1]).toMatchObject({ x: 0.5, y: 0.6, result: "2B" });
  });

  it("dedupes games and sorts most recent first", () => {
    const rows: RawOpposingAtBat[] = [
      ab({ game_id: "g1", game_date: "2026-04-01" }),
      ab({ game_id: "g1", game_date: "2026-04-01" }),
      ab({ game_id: "g2", game_date: "2026-05-01" }),
      ab({ game_id: "g3", game_date: "2026-03-01" }),
    ];
    const p = deriveOpposingBatterProfile(rows, IDENTITY, ID);
    expect(p.games.map((g) => g.game_id)).toEqual(["g2", "g1", "g3"]);
  });
});
