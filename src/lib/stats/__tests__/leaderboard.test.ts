import { describe, expect, it } from "vitest";
import { MIN_AB, rankLeaderboard } from "../leaderboard";
import type { PlayerSeasonAgg } from "@/lib/career";

const row = (
  player_id: string,
  agg: Record<string, number>,
  season_year = 2026,
): PlayerSeasonAgg => ({ player_id, season_year, agg });

describe("rankLeaderboard", () => {
  it("filters rows below the qualifier minimum", () => {
    const rows = [
      row("a", { AVG: 0.500, AB: MIN_AB - 1 }),
      row("b", { AVG: 0.350, AB: MIN_AB }),
      row("c", { AVG: 0.300, AB: 200 }),
    ];
    const ranked = rankLeaderboard(rows, {
      stat: "AVG",
      qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` },
    });
    expect(ranked.map((r) => r.player_id)).toEqual(["b", "c"]);
  });

  it("admits rows exactly at the qualifier minimum", () => {
    const rows = [row("a", { AVG: 0.500, AB: MIN_AB })];
    const ranked = rankLeaderboard(rows, {
      stat: "AVG",
      qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` },
    });
    expect(ranked).toHaveLength(1);
  });

  it("sorts descending by default", () => {
    const rows = [
      row("low", { HR: 5 }),
      row("high", { HR: 30 }),
      row("mid", { HR: 15 }),
    ];
    const ranked = rankLeaderboard(rows, { stat: "HR" });
    expect(ranked.map((r) => r.player_id)).toEqual(["high", "mid", "low"]);
  });

  it("sorts ascending when dir is 'asc' (e.g. ERA)", () => {
    const rows = [
      row("a", { ERA: 4.50, IP: 30 }),
      row("b", { ERA: 2.10, IP: 30 }),
      row("c", { ERA: 3.25, IP: 30 }),
    ];
    const ranked = rankLeaderboard(rows, {
      stat: "ERA",
      dir: "asc",
      qualifier: { stat: "IP", min: 20, note: "Min 20 IP" },
    });
    expect(ranked.map((r) => r.player_id)).toEqual(["b", "c", "a"]);
  });

  it("skips rows with missing or non-finite target stat", () => {
    const rows = [
      row("a", { HR: NaN }),
      row("b", { HR: 5 }),
      row("c", {}),
    ];
    const ranked = rankLeaderboard(rows, { stat: "HR" });
    expect(ranked.map((r) => r.player_id)).toEqual(["b"]);
  });

  it("returns an empty array when no rows qualify", () => {
    const rows = [
      row("a", { AVG: 0.500, AB: 1 }),
      row("b", { AVG: 0.400, AB: 1 }),
    ];
    const ranked = rankLeaderboard(rows, {
      stat: "AVG",
      qualifier: { stat: "AB", min: MIN_AB, note: `Min ${MIN_AB} AB` },
    });
    expect(ranked).toEqual([]);
  });
});
