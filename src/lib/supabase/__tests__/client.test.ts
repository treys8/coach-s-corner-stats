import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  // Vitest doesn't auto-load .env.local; stub the public env vars so the
  // browser client constructor succeeds. We only assert identity, not network.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("createClient (browser)", () => {
  it("returns the same instance across calls", async () => {
    const { createClient } = await import("../client");
    const a = createClient();
    const b = createClient();
    expect(a).toBe(b);
  });
});
