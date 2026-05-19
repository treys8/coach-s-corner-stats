import { describe, it, expect } from "vitest";
import { shouldTouchTabletSnapshots } from "../server";
import type { GameEventType } from "@/integrations/supabase/types";

// Locks the rederive() snapshot-rebuild gate. The original data-integrity
// audit claimed the gate didn't trigger a rebuild when a correction landed
// on an already-final game; re-reading the code showed it actually does
// (status stays 'final' after the correction replay, so the gate fires).
// This test pins that behavior so a future refactor can't silently regress.

describe("shouldTouchTabletSnapshots", () => {
  it("rebuilds when the game is final on a regular event", () => {
    expect(shouldTouchTabletSnapshots("final", ["pitch"])).toBe(true);
  });

  it("rebuilds when a correction lands on a finalized game", () => {
    // Regression: a correction on a final game must rebuild stat_snapshots
    // so the updated rollup reflects the correction.
    expect(shouldTouchTabletSnapshots("final", ["correction"])).toBe(true);
  });

  it("deletes (but does not rebuild) when a correction un-finalizes a game", () => {
    // status flips to in_progress when the correction reverses finalization.
    // Caller must DELETE snapshots so stale rows don't linger; rebuild skips
    // because the game is no longer final.
    expect(shouldTouchTabletSnapshots("in_progress", ["correction"])).toBe(true);
  });

  it("triggers on game_finalized chain transitioning to final", () => {
    expect(shouldTouchTabletSnapshots("final", ["pitch", "at_bat", "game_finalized"])).toBe(true);
  });

  it("triggers on game_finalized chain that didn't complete the transition", () => {
    expect(shouldTouchTabletSnapshots("in_progress", ["game_finalized"])).toBe(true);
  });

  it("does NOT trigger on an in-progress pitch chain (hot path)", () => {
    expect(shouldTouchTabletSnapshots("in_progress", ["pitch"])).toBe(false);
    expect(shouldTouchTabletSnapshots("in_progress", ["pitch", "at_bat"])).toBe(false);
    expect(shouldTouchTabletSnapshots("in_progress", ["pitch", "at_bat", "inning_end"])).toBe(false);
  });

  it("does NOT trigger on a draft game", () => {
    expect(shouldTouchTabletSnapshots("draft", ["game_started"])).toBe(false);
  });

  it("ignores chainTypes when the game is already final (rebuilds anyway)", () => {
    const chains: GameEventType[][] = [
      [],
      ["pitch"],
      ["at_bat"],
      ["substitution"],
      ["pitching_change"],
    ];
    for (const chain of chains) {
      expect(shouldTouchTabletSnapshots("final", chain)).toBe(true);
    }
  });
});
