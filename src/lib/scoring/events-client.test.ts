import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// sonner.toast is invoked from events-client on failure / final-fail; mock
// so the tests can assert call shape without rendering a Toaster.
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: toastMocks,
}));

import { postEvent } from "./events-client";

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const body = {
  client_event_id: "ce1",
  sequence_number: 1,
  event_type: "at_bat",
  payload: {},
};

describe("postEvent", () => {
  beforeEach(() => {
    toastMocks.error.mockReset();
    toastMocks.success.mockReset();
    toastMocks.warning.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true on first-attempt 200; no toast, no retry indicator", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onRetryingChange = vi.fn();

    const ok = await postEvent("g1", body, { onRetryingChange });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRetryingChange).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("retries on a 500 then succeeds; signals retrying then clears", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: "boom" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onRetryingChange = vi.fn();

    const ok = await postEvent("g1", body, {
      onRetryingChange,
      retryDelaysMs: [0], // skip the actual backoff
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRetryingChange).toHaveBeenCalledWith(true);
    expect(onRetryingChange).toHaveBeenLastCalledWith(false);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("retries on network errors; surfaces a persistent toast after final failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const onRetryingChange = vi.fn();

    const ok = await postEvent("g1", body, {
      onRetryingChange,
      retryDelaysMs: [0, 0, 0], // three retry attempts, all fail
    });

    expect(ok).toBe(false);
    // Initial + 3 retries = 4 attempts.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Retrying flag flipped on then off.
    expect(onRetryingChange.mock.calls[0][0]).toBe(true);
    expect(onRetryingChange.mock.calls.at(-1)?.[0]).toBe(false);
    // Final-failure toast is persistent and carries a Retry action.
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    const [, opts] = toastMocks.error.mock.calls[0];
    expect(opts.duration).toBe(Infinity);
    expect(opts.action.label).toBe("Retry");
    expect(typeof opts.action.onClick).toBe("function");
  });

  it("does NOT retry on 4xx (client bug); surfaces error toast immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: "bad payload" }));
    vi.stubGlobal("fetch", fetchMock);
    const onRetryingChange = vi.fn();

    const ok = await postEvent("g1", body, {
      onRetryingChange,
      retryDelaysMs: [0, 0, 0],
    });

    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRetryingChange).not.toHaveBeenCalled();
    // Error toast is non-persistent (no duration override).
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    const args = toastMocks.error.mock.calls[0];
    expect(args[0]).toContain("bad payload");
    expect(args[1]).toBeUndefined();
  });
});
