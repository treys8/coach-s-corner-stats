// Color utilities for per-school theming.
// CSS custom properties in src/app/globals.css store HSL values without the
// `hsl()` wrapper (e.g. `--sa-orange: 16 100% 50%`) because Tailwind composes
// them as `hsl(var(--sa-orange))`. The HTML5 color picker hands back hex, so
// we convert hex → HSL string before injecting into a `style` attribute.

/** Parse a hex color (#RRGGBB, RRGGBB, #RGB, RGB) into [r, g, b] 0..1. */
const parseHex = (input: string): [number, number, number] | null => {
  const m = input.trim().replace(/^#/, "");
  if (!/^[0-9a-f]+$/i.test(m)) return null;
  let hex: string;
  if (m.length === 3) hex = m.split("").map((c) => c + c).join("");
  else if (m.length === 6) hex = m;
  else return null;
  const n = parseInt(hex, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

/**
 * Convert a hex color to the `H S% L%` string our CSS custom properties expect.
 * Returns null on invalid input so callers can fall back to the default theme.
 */
export const hexToHsl = (hex: string | null | undefined): string | null => {
  if (!hex) return null;
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

/** Same as hexToHsl but returns the input for an invalid hex — useful for inline style fallbacks. */
export const hexToHslOr = (hex: string | null | undefined, fallback: string): string =>
  hexToHsl(hex) ?? fallback;

/** Brighten an `H S% L%` string by adding `delta` to its lightness (clamped 0..100). */
export const lightenHsl = (hsl: string, delta: number): string => {
  const m = /^(\d+)\s+(\d+)%\s+(\d+)%$/.exec(hsl);
  if (!m) return hsl;
  const h = m[1];
  const s = m[2];
  const l = Math.max(0, Math.min(100, parseInt(m[3], 10) + delta));
  return `${h} ${s}% ${l}%`;
};
