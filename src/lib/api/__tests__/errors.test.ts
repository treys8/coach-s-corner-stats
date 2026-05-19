import { describe, expect, it } from "vitest";
import { apiError, apiErrorFromException, isForbiddenError } from "../errors";

describe("apiError", () => {
  it("returns a NextResponse with the standard shape", async () => {
    const res = apiError(400, "invalid_payload", { issues: ["x"] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid_payload", issues: ["x"] });
  });

  it("omits detail and issues when not provided", async () => {
    const res = apiError(401, "unauthenticated");
    const body = await res.json();
    expect(body).toEqual({ error: "unauthenticated" });
  });
});

describe("isForbiddenError", () => {
  it("matches PostgreSQL 42501 (insufficient privilege)", () => {
    expect(isForbiddenError({ code: "42501", message: "anything" })).toBe(true);
  });

  it("matches messages starting with 'forbidden'", () => {
    expect(isForbiddenError(new Error("forbidden: row-level security failed"))).toBe(true);
  });

  it("matches 'permission denied' anywhere", () => {
    expect(isForbiddenError(new Error("permission denied for table at_bats"))).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isForbiddenError(new Error("constraint violation on insert"))).toBe(false);
    expect(isForbiddenError(null)).toBe(false);
    expect(isForbiddenError(undefined)).toBe(false);
  });
});

describe("apiErrorFromException", () => {
  it("maps RLS errors to 403 / forbidden", async () => {
    const res = apiErrorFromException(new Error("forbidden: RLS"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "forbidden" });
  });

  it("maps unknown errors to 500 / internal with the message as detail", async () => {
    const res = apiErrorFromException(new Error("kaboom"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal", detail: "kaboom" });
  });

  it("maps non-Error throws to 500 / internal with 'unknown' detail", async () => {
    const res = apiErrorFromException("string error");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal", detail: "unknown" });
  });
});
