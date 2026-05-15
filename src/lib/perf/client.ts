"use client";

// Client-side perf instrumentation: a 50-entry ring buffer exposed as
// `window.__scoringPerf` in dev only. Lets the user grab
// `JSON.stringify(window.__scoringPerf)` at any point during a tablet
// session to see the most recent tap timings. No-ops in production so
// there's zero runtime cost off the dev path.

const isDev = process.env.NODE_ENV === "development";

const RING_SIZE = 50;
const ring: Array<Record<string, unknown>> = [];

if (isDev && typeof window !== "undefined") {
  (window as unknown as { __scoringPerf?: typeof ring }).__scoringPerf = ring;
}

const NOW = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const round = (n: number): number => Math.round(n * 100) / 100;

export function recordPerf(entry: Record<string, unknown>): void {
  if (!isDev) return;
  ring.push({ ts: new Date().toISOString(), ...entry });
  if (ring.length > RING_SIZE) ring.shift();
}

/** Time an async function and record the elapsed ms under `label`. Always
 *  returns the inner result; instrumentation is invisible to callers and
 *  becomes a no-op pass-through in production. */
export async function timeAsync<T>(
  label: string,
  ctx: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isDev) return fn();
  const start = NOW();
  try {
    const result = await fn();
    recordPerf({ label, status: "ok", ms: round(NOW() - start), ...ctx });
    return result;
  } catch (err) {
    recordPerf({
      label,
      status: "error",
      ms: round(NOW() - start),
      error: err instanceof Error ? err.message : String(err),
      ...ctx,
    });
    throw err;
  }
}

/** Sync variant of timeAsync — used for the optimistic apply, which is a
 *  cheap pure reduction we want to measure separately from the network. */
export function timeSync<T>(
  label: string,
  ctx: Record<string, unknown>,
  fn: () => T,
): T {
  if (!isDev) return fn();
  const start = NOW();
  const result = fn();
  recordPerf({ label, ms: round(NOW() - start), ...ctx });
  return result;
}
