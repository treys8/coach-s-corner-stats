// Shared utilities used across rollup domains.

export function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}
