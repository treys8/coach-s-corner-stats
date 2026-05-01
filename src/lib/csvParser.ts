import Papa from "papaparse";

export interface ParsedPlayer {
  number: string;
  last: string;
  first: string;
  stats: Record<string, string | number>;
}

export interface ParsedCsv {
  headers: string[];
  players: ParsedPlayer[];
}

/**
 * Parses the team stats CSV.
 * Row 1: category headers (ignored)
 * Row 2: column headers (Number, Last, First, GP, PA, AB, ...)
 * Rows 3..N: player data
 * Last row: glossary (skipped — first cell empty / not numeric)
 */
export function parseStatsCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = result.data as string[][];
  if (rows.length < 3) throw new Error("CSV is too short — expected category row, header row, and data rows.");

  const headers = rows[1].map((h) => (h || "").trim());
  const dataRows = rows.slice(2);

  const players: ParsedPlayer[] = [];
  for (const row of dataRows) {
    const number = (row[0] || "").trim();
    const last = (row[1] || "").trim();
    const first = (row[2] || "").trim();
    // Skip the glossary row and any empty rows
    if (!last || !first) continue;
    if (last.toLowerCase().includes("glossary")) continue;

    const stats: Record<string, string | number> = {};
    for (let i = 3; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      const raw = (row[i] ?? "").toString().trim();
      if (raw === "" || raw === "-") {
        stats[key] = "-";
      } else {
        const n = Number(raw);
        stats[key] = Number.isFinite(n) && raw !== "" ? n : raw;
      }
    }
    players.push({ number, last, first, stats });
  }
  return { headers, players };
}

/** Format a stat value for display. */
export function formatStat(value: unknown): string {
  if (value === null || value === undefined || value === "" || value === "-") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    // Treat sub-1 values as rate stats with 3 decimals (avg, obp, slg, etc.)
    if (Math.abs(value) > 0 && Math.abs(value) < 1) return value.toFixed(3).replace(/^0\./, ".");
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}
