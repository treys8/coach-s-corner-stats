import { describe, it, expect } from "vitest";
import { hashFileBuffer } from "../hash";

const toBuf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("hashFileBuffer", () => {
  it("returns the same hex for identical content", async () => {
    const a = await hashFileBuffer(toBuf("hello"));
    const b = await hashFileBuffer(toBuf("hello"));
    expect(a).toBe(b);
  });

  it("returns different hex for different content", async () => {
    const a = await hashFileBuffer(toBuf("hello"));
    const b = await hashFileBuffer(toBuf("Hello"));
    expect(a).not.toBe(b);
  });

  it("matches the known SHA-256 of an empty buffer", async () => {
    const h = await hashFileBuffer(new ArrayBuffer(0));
    expect(h).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the known SHA-256 of 'abc'", async () => {
    const h = await hashFileBuffer(toBuf("abc"));
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
