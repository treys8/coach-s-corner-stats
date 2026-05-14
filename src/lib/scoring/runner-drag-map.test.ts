import { describe, it, expect } from "vitest";
import { mapRunnerDragToEvent } from "./runner-drag-map";
import type {
  CaughtStealingPayload,
  PickoffPayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "./types";

describe("mapRunnerDragToEvent — Stage 4 runner-drag mapping", () => {
  describe("SAFE drops", () => {
    it("forward one base = stolen_base", () => {
      const r = mapRunnerDragToEvent("first", "second", "safe", "runner-1");
      expect(r.eventType).toBe("stolen_base");
      const p = r.payload as StolenBasePayload;
      expect(p.from).toBe("first");
      expect(p.to).toBe("second");
      expect(p.runner_id).toBe("runner-1");
      expect(r.clientPrefix).toBe("sb-first");
    });

    it("R2 stealing 3rd = stolen_base", () => {
      const r = mapRunnerDragToEvent("second", "third", "safe", "runner-2");
      expect(r.eventType).toBe("stolen_base");
      expect((r.payload as StolenBasePayload).to).toBe("third");
    });

    it("multi-base advance = error_advance with single runner_advance", () => {
      const r = mapRunnerDragToEvent("first", "third", "safe", "runner-1");
      expect(r.eventType).toBe("error_advance");
      const p = r.payload as RunnerMovePayload;
      expect(p.advances).toHaveLength(1);
      expect(p.advances[0]).toEqual({
        from: "first",
        to: "third",
        player_id: "runner-1",
      });
    });

    it("backward drag (un-advance) = error_advance to lower base", () => {
      const r = mapRunnerDragToEvent("second", "first", "safe", "runner-2");
      expect(r.eventType).toBe("error_advance");
      const p = r.payload as RunnerMovePayload;
      expect(p.advances[0].to).toBe("first");
    });

    it("preserves null runner_id (opp runner unresolved)", () => {
      const r = mapRunnerDragToEvent("first", "second", "safe", null);
      expect((r.payload as StolenBasePayload).runner_id).toBeNull();
    });
  });

  describe("OUT drops", () => {
    it("OUT @ same base = pickoff", () => {
      const r = mapRunnerDragToEvent("first", "first", "out", "runner-1");
      expect(r.eventType).toBe("pickoff");
      const p = r.payload as PickoffPayload;
      expect(p.from).toBe("first");
      expect(p.runner_id).toBe("runner-1");
      expect(r.clientPrefix).toBe("po-first");
    });

    it("OUT @ next base = caught_stealing", () => {
      const r = mapRunnerDragToEvent("first", "second", "out", "runner-1");
      expect(r.eventType).toBe("caught_stealing");
      const p = r.payload as CaughtStealingPayload;
      expect(p.from).toBe("first");
      expect(r.clientPrefix).toBe("cs-first");
    });

    it("OUT @ home from R3 = error_advance/out (routed through home path)", () => {
      const r = mapRunnerDragToEvent("third", "home", "out", "runner-3");
      // home always routes through error_advance for symmetry with the
      // SAFE@home modal flow.
      expect(r.eventType).toBe("error_advance");
      const p = r.payload as RunnerMovePayload;
      expect(p.advances[0]).toEqual({
        from: "third",
        to: "out",
        player_id: "runner-3",
      });
    });

    it("OUT @ distant base (R1 caught at 3B) = error_advance/out", () => {
      const r = mapRunnerDragToEvent("first", "third", "out", "runner-1");
      expect(r.eventType).toBe("error_advance");
      const p = r.payload as RunnerMovePayload;
      expect(p.advances[0].to).toBe("out");
    });
  });
});
