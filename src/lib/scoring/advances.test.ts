import { describe, expect, it } from "vitest";
import { defaultAdvances } from "./advances";
import type { BaseRunner, Bases } from "./types";

// Compact helper for fixtures: wrap a player_id in a BaseRunner with no
// pitcher_of_record. Tests that exercise pitcher attribution should
// construct BaseRunner inline instead.
const r = (playerId: string): BaseRunner => ({
  player_id: playerId,
  pitcher_of_record_id: null,
  reached_on_error: false,
});

const empty: Bases = { first: null, second: null, third: null };

describe("defaultAdvances()", () => {
  it("walk with empty bases puts batter on first", () => {
    expect(defaultAdvances(empty, "b1", "BB")).toEqual([
      { from: "batter", to: "first", player_id: "b1" },
    ]);
  });

  it("walk with bases loaded forces the runner from 3rd home", () => {
    const loaded: Bases = { first: r("p1"), second: r("p2"), third: r("p3") };
    const adv = defaultAdvances(loaded, "b", "BB");
    expect(adv).toContainEqual({ from: "third", to: "home", player_id: "p3" });
    expect(adv).toContainEqual({ from: "second", to: "third", player_id: "p2" });
    expect(adv).toContainEqual({ from: "first", to: "second", player_id: "p1" });
    expect(adv).toContainEqual({ from: "batter", to: "first", player_id: "b" });
  });

  it("walk with runner only on 2nd doesn't push", () => {
    const bases: Bases = { first: null, second: r("p2"), third: null };
    expect(defaultAdvances(bases, "b", "BB")).toEqual([
      { from: "batter", to: "first", player_id: "b" },
    ]);
  });

  it("single advances every runner by one base", () => {
    const bases: Bases = { first: r("p1"), second: r("p2"), third: r("p3") };
    const adv = defaultAdvances(bases, "b", "1B");
    expect(adv).toContainEqual({ from: "third", to: "home", player_id: "p3" });
    expect(adv).toContainEqual({ from: "second", to: "third", player_id: "p2" });
    expect(adv).toContainEqual({ from: "first", to: "second", player_id: "p1" });
    expect(adv).toContainEqual({ from: "batter", to: "first", player_id: "b" });
  });

  it("HR clears the bases and scores the batter", () => {
    const bases: Bases = { first: r("p1"), second: null, third: r("p3") };
    const adv = defaultAdvances(bases, "b", "HR");
    const homeScores = adv.filter((a) => a.to === "home").length;
    expect(homeScores).toBe(3);
  });

  it("strikeout produces no advances (replay engine charges 1 out)", () => {
    expect(defaultAdvances({ first: r("p1"), second: null, third: null }, "b", "K_swinging")).toEqual([]);
  });

  it("sac fly: batter out, runner from 3rd scores", () => {
    const bases: Bases = { first: null, second: null, third: r("p3") };
    const adv = defaultAdvances(bases, "b", "SF");
    expect(adv).toContainEqual({ from: "batter", to: "out", player_id: "b" });
    expect(adv).toContainEqual({ from: "third", to: "home", player_id: "p3" });
  });

  it("IBB advances like a regular walk", () => {
    const loaded: Bases = { first: r("p1"), second: r("p2"), third: r("p3") };
    const adv = defaultAdvances(loaded, "b", "IBB");
    expect(adv).toContainEqual({ from: "third", to: "home", player_id: "p3" });
    expect(adv).toContainEqual({ from: "batter", to: "first", player_id: "b" });
  });

  it("FC produces no auto-advances (coach overrides)", () => {
    const bases: Bases = { first: r("p1"), second: null, third: null };
    expect(defaultAdvances(bases, "b", "FC")).toEqual([]);
  });

  it("E produces no auto-advances (coach overrides)", () => {
    expect(defaultAdvances(empty, "b", "E")).toEqual([]);
  });
});
