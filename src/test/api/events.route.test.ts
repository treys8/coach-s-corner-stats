import { describe, it, expect, vi, beforeEach } from "vitest";

// The route imports applyEvent + the user-scoped Supabase client. Both are
// mocked here so the test pins HTTP-layer behavior (input validation, auth
// gate, error → status mapping) without needing a DB or auth provider.
const applyEventMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@/lib/scoring/server", () => ({
  applyEvent: (...args: unknown[]) => applyEventMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => getUserMock() },
  }),
}));

import { POST } from "@/app/api/games/[gameId]/events/route";

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const params = Promise.resolve({ gameId: GAME_ID });

function makeReq(body: unknown): Request {
  return new Request(`http://test/api/games/${GAME_ID}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validPitchBody() {
  return {
    client_event_id: "pitch-1",
    event_type: "pitch",
    payload: { pitch_type: "ball" },
  };
}

beforeEach(() => {
  applyEventMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("POST /api/games/[gameId]/events", () => {
  it("returns 400 on invalid JSON", async () => {
    const req = makeReq("not-json{");
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 on payload that fails schema", async () => {
    const res = await POST(
      makeReq({ client_event_id: "x", event_type: "not_a_real_event", payload: {} }),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_payload");
  });

  it("returns 400 for at_bat with both batter ids null", async () => {
    const res = await POST(
      makeReq({
        client_event_id: "ab-1",
        event_type: "at_bat",
        payload: {
          batter_id: null,
          opponent_batter_id: null,
          inning: 1,
          half: "top",
          result: "1B",
        },
      }),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("batter");
    expect(applyEventMock).not.toHaveBeenCalled();
  });

  it("returns 401 when no auth user", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeReq(validPitchBody()), { params });
    expect(res.status).toBe(401);
    expect(applyEventMock).not.toHaveBeenCalled();
  });

  it("returns 201 and the multi-event chain for a closing pitch", async () => {
    // Phase 2 wire shape: one POST may persist 1–3 events (the primary
    // pitch + a server-derived closing at_bat + an auto inning_end).
    applyEventMock.mockResolvedValueOnce({
      events: [
        { id: "e1", event_type: "pitch", sequence_number: 10 },
        { id: "e2", event_type: "at_bat", sequence_number: 11 },
        { id: "e3", event_type: "inning_end", sequence_number: 12 },
      ],
      state: { inning: 1, half: "bottom", outs: 0, status: "in_progress" },
      duplicate: false,
    });
    const res = await POST(makeReq(validPitchBody()), { params });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.events).toHaveLength(3);
    expect(body.events.map((e: { event_type: string }) => e.event_type)).toEqual([
      "pitch",
      "at_bat",
      "inning_end",
    ]);
    expect(body.state.status).toBe("in_progress");
    expect(applyEventMock).toHaveBeenCalledTimes(1);
  });

  it("returns 200 (not 201) on an idempotent retry", async () => {
    applyEventMock.mockResolvedValueOnce({
      events: [{ id: "e1", event_type: "pitch", sequence_number: 10 }],
      state: { inning: 1, half: "top", outs: 0, status: "in_progress" },
      duplicate: true,
    });
    const res = await POST(makeReq(validPitchBody()), { params });
    expect(res.status).toBe(200);
  });

  it("maps a 42501 SECURITY DEFINER denial to 403", async () => {
    applyEventMock.mockRejectedValueOnce(new Error("forbidden: 42501 permission denied"));
    const res = await POST(makeReq(validPitchBody()), { params });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });

  it("maps a generic row-level-security message to 403", async () => {
    applyEventMock.mockRejectedValueOnce(
      new Error("new row violates row-level security policy"),
    );
    const res = await POST(makeReq(validPitchBody()), { params });
    expect(res.status).toBe(403);
  });

  it("returns 500 with detail for unexpected errors", async () => {
    applyEventMock.mockRejectedValueOnce(new Error("database is on fire"));
    const res = await POST(makeReq(validPitchBody()), { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal");
    expect(body.detail).toBe("database is on fire");
  });
});
