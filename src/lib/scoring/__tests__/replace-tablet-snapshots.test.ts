import { describe, expect, it, vi } from "vitest";
import {
  buildTabletSnapshotRows,
  replaceTabletSnapshots,
} from "../server";
import { INITIAL_STATE, EMPTY_BASES } from "../types";
import type { DerivedAtBat, ReplayState } from "../types";

// Regression coverage for audit #9. Pre-fix, rederive() called
// admin.from('stat_snapshots').delete()… and then a separate
// admin.from('stat_snapshots').insert(…). If the insert leg failed (network
// blip, CHECK violation, transient err), the prior tablet rows were wiped
// and stayed wiped until the next correction or finalize re-triggered the
// replace. The fix routes both writes through a single atomic Postgres
// transaction via the replace_tablet_stat_snapshots RPC.
//
// These tests pin:
//   1. The pure row-builder shape (so a future rollup refactor doesn't
//      silently change what we persist).
//   2. That the JS side now calls the RPC with the right payload — and
//      never reaches for a direct DELETE or INSERT against stat_snapshots.
//   3. That an RPC failure propagates as a thrown error (so the API route
//      surfaces the failure to the client instead of silently passing).

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const TEAM_ID = "22222222-2222-2222-2222-222222222222";
const GAME_DATE = "2026-05-24";
const P1 = "33333333-3333-3333-3333-333333333333";
const P2 = "44444444-4444-4444-4444-444444444444";

let abCounter = 0;
function ab(overrides: Partial<DerivedAtBat>): DerivedAtBat {
  abCounter += 1;
  return {
    event_id: `e${abCounter}`,
    inning: 1,
    half: "top",
    batting_order: 1,
    batter_id: null,
    opponent_batter_id: null,
    pitcher_id: null,
    opponent_pitcher_id: null,
    result: "GO",
    rbi: 0,
    pitch_count: 0,
    balls: 0,
    strikes: 0,
    spray_x: null,
    spray_y: null,
    fielder_position: null,
    runs_scored_on_play: 0,
    outs_recorded: 0,
    runner_advances: [],
    pitcher_of_record_id: null,
    bases_before: { ...EMPTY_BASES },
    description: null,
    pitches: [],
    ...overrides,
  };
}

function finalState(atBats: DerivedAtBat[]): ReplayState {
  return {
    ...INITIAL_STATE,
    status: "final",
    we_are_home: true,
    team_score: 3,
    opponent_score: 1,
    at_bats: atBats,
  };
}

describe("buildTabletSnapshotRows", () => {
  it("emits one row per player with batting/pitching/fielding splits", () => {
    const state = finalState([
      ab({ batter_id: P1, result: "1B" }),
      ab({ batter_id: P2, result: "HR", rbi: 1, runs_scored_on_play: 1 }),
    ]);
    const rows = buildTabletSnapshotRows(state);
    const byPlayer = new Map(rows.map((r) => [r.player_id, r]));

    expect(byPlayer.size).toBe(2);
    const p1 = byPlayer.get(P1)!;
    expect(p1.stats).toMatchObject({
      batting: expect.objectContaining({ H: 1 }),
      pitching: {},
      fielding: {},
    });
    const p2 = byPlayer.get(P2)!;
    expect(p2.stats.batting).toMatchObject({ H: 1, HR: 1, RBI: 1 });
  });

  it("returns empty array when state has no at_bats", () => {
    expect(buildTabletSnapshotRows(finalState([]))).toEqual([]);
  });

  it("merges W/L/SV from computeWLS into the matching pitching line", () => {
    // Opposing batter PA with our pitcher P1 on the mound. Our team is home
    // and won 3-1 → P1 should pick up the W.
    const state = finalState([
      ab({
        opponent_batter_id: "opp-1",
        pitcher_id: P1,
        result: "K_looking",
        outs_recorded: 1,
        pitch_count: 3,
        balls: 0,
        strikes: 3,
      }),
    ]);
    const rows = buildTabletSnapshotRows(state);
    const p1 = rows.find((r) => r.player_id === P1);
    expect(p1).toBeDefined();
    expect(p1!.stats.pitching).toMatchObject({ W: 1 });
  });
});

describe("replaceTabletSnapshots", () => {
  function makeAdminMock(opts?: {
    rpcError?: { message: string };
    missingGameRow?: boolean;
  }) {
    const rpc = vi.fn().mockResolvedValue({ error: opts?.rpcError ?? null });
    const single = vi.fn().mockResolvedValue(
      opts?.missingGameRow
        ? { data: null, error: { message: "row not found" } }
        : { data: { team_id: TEAM_ID, game_date: GAME_DATE }, error: null },
    );
    const eqFn = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq: eqFn });
    const from = vi.fn().mockReturnValue({ select });
    return { rpc, from, _select: select, _single: single };
  }

  it("calls the atomic RPC with the rebuilt rows for a final game", async () => {
    const admin = makeAdminMock();
    const state = finalState([
      ab({ batter_id: P1, result: "1B" }),
      ab({ batter_id: P2, result: "HR", rbi: 1, runs_scored_on_play: 1 }),
    ]);

    await replaceTabletSnapshots(admin, GAME_ID, state);

    expect(admin.rpc).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = admin.rpc.mock.calls[0];
    expect(rpcName).toBe("replace_tablet_stat_snapshots");
    expect(rpcArgs).toMatchObject({
      p_game_id: GAME_ID,
      p_team_id: TEAM_ID,
      p_upload_date: GAME_DATE,
    });
    // Two players, each with the shape the RPC expects.
    expect(rpcArgs.p_rows).toHaveLength(2);
    expect(rpcArgs.p_rows[0]).toMatchObject({
      player_id: expect.any(String),
      stats: {
        batting: expect.any(Object),
        pitching: expect.any(Object),
        fielding: expect.any(Object),
      },
    });
    // games is the only direct table access. The pre-fix delete+insert
    // pair against stat_snapshots is gone.
    const fromTables = admin.from.mock.calls.map((c) => c[0]);
    expect(fromTables).toEqual(["games"]);
    expect(fromTables).not.toContain("stat_snapshots");
  });

  it("calls the RPC with p_rows=[] for an un-finalize delete-only pass", async () => {
    const admin = makeAdminMock();
    // status !== "final" → the RPC clears stale tablet rows but skips insert.
    const state: ReplayState = { ...INITIAL_STATE, status: "in_progress" };

    await replaceTabletSnapshots(admin, GAME_ID, state);

    expect(admin.rpc).toHaveBeenCalledTimes(1);
    const [, rpcArgs] = admin.rpc.mock.calls[0];
    expect(rpcArgs).toMatchObject({
      p_game_id: GAME_ID,
      p_team_id: null,
      p_upload_date: null,
      p_rows: [],
    });
    // No games fetch needed when we're not building rollup rows.
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("throws when the RPC returns an error (no silent data wipe)", async () => {
    // The user-facing fix: pre-fix a failed insert silently wiped the prior
    // rows. Post-fix the RPC body's transaction rolls back; the error
    // propagates here so the API route surfaces it.
    const admin = makeAdminMock({
      rpcError: { message: "deadlock detected" },
    });
    const state = finalState([ab({ batter_id: P1, result: "1B" })]);

    await expect(replaceTabletSnapshots(admin, GAME_ID, state)).rejects.toThrow(
      /replace_tablet_stat_snapshots failed: deadlock detected/,
    );
    // No direct stat_snapshots access on the failure path either.
    const fromTables = admin.from.mock.calls.map((c) => c[0]);
    expect(fromTables).not.toContain("stat_snapshots");
  });

  it("throws when the games fetch fails for a final game", async () => {
    const admin = makeAdminMock({ missingGameRow: true });
    const state = finalState([ab({ batter_id: P1, result: "1B" })]);

    await expect(replaceTabletSnapshots(admin, GAME_ID, state)).rejects.toThrow(
      /games fetch for rollup failed/,
    );
    // RPC never reached.
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
