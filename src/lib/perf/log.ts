// Server-side perf instrumentation: emits a single structured JSON log
// line per span via console.log, which Vercel logs parse natively. Used
// from API routes and server-only modules. Zero dependencies; no-op-safe
// if `performance` isn't available (older Node, Edge fallback).

const NOW = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const round = (n: number): number => Math.round(n * 100) / 100;

export interface PerfSpan {
  /** Record the elapsed ms since the previous mark (or the span start) under
   *  the key `${label}_ms`. Markers compose left-to-right; the sum equals
   *  the total. */
  mark(label: string): void;
  /** Emit the structured log line and stop the timer. Anything passed in
   *  `extra` is merged into the final JSON object. Safe to call once. */
  finish(extra?: Record<string, unknown>): void;
}

export function startSpan(
  name: string,
  ctx: Record<string, unknown> = {},
): PerfSpan {
  const start = NOW();
  const marks: Record<string, number> = {};
  let last = start;
  let done = false;
  return {
    mark(label: string) {
      if (done) return;
      const t = NOW();
      marks[`${label}_ms`] = round(t - last);
      last = t;
    },
    finish(extra: Record<string, unknown> = {}) {
      if (done) return;
      done = true;
      const total_ms = round(NOW() - start);
      console.log(
        JSON.stringify({ perf: name, total_ms, ...marks, ...ctx, ...extra }),
      );
    },
  };
}
