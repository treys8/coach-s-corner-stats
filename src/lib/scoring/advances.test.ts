import { describe, expect, it } from "vitest";
import { defaultAdvances } from "./advances";
import type { Bases } from "./types";

const empty: Bases = { first: null, second: null, third: null };

describe("defaultAdvances()", () => {
  it("walk with empty bases puts batter on first", () => {
    expect(defaultAdvances(empty, "b1", "BB")).toEqual([
      { from: "batter", to: "first", player_id: "b1" },
    ]);
  });

  it("walk with bases loaded forces the runner from 3rd home", () => {
    const loaded: Bases = { first: "p1", second: "p2", third: "p3" };
    const adv = defaultAdvances(loaded, "b", "BB");
    expect(adv).toContainEqual({ from: "third", to: "home", player_id: "p3" });
    expect(adv).toContainEqual({ from: "second", to: "third", player_id: "p2" });
    expect(adv).toContainEqual({ from: "first", to: "second", player_id: "p1" });
    expect(adv).toContainEqual({ from: "batter", to: "first", player_id: "b" });
  });

  it("walk with runner only on 2nd doesn't push", () => {
    const bases: Bases = { first: null, second: "p2", third: null };
    expect(defaultAdvances(bases, "b", "BB")).toEqual([
      { from: "batter", to: "first", player_id: "b" },
    ]);
  });

  it("single advances every runner by one base", () => {
    const bases: Bases = { first: "p1", second: "p2", third: "p3" };
    const adv = defaultAdvances(bases, "b", "1B");
    expect(adv).toContainEqual({ from: "third", to: "home", player_id: "p3" });
    expect(adv).toContainEqual({ from: "second", to: "third", player_id: "p2" });
    expect(adv).toContainEqual({ from: "first", to: "second", player_id: "p1" });
    expect(adv).toContainEqual({ from: "batter", to: "first", player_id: "b" });
  });

  it("HR clears the bases and scores the batter", () => {
    const bases: Bases = { first: "p1", second: null, third: "p3" };
    const adv = defaultAdvances(bases, "b", "HR");
    const homeScores = adv.filter((a) => a.to === "home").length;
    expect(homeScores).toBe(3);
  });

  it("strikeout produces no advances (replay engine charges 1 out)", () => {
    expect(defaultAdvances({ first: "p1", second: null, third: null }, "b", "K_swinging")).toEqual([]);
  });

  it("sac fly: batter out, runner from 3rd scores", () => {
    const bases: Bases = { first: null, second: null, third: "p3" };
    const adv = defaultAdvances(bases, "b", "SF");
    expect(adv).toContainEqual({ from: "batter", to: "out", player_id: "b" });
    expect(adv).toContainEqual({ from: "third", to: "home", player_id: "p3" });
  });
});
