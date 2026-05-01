import Papa from "papaparse";

export interface SectionedStats {
  batting: Record<string, string | number>;
  pitching: Record<string, string | number>;
  fielding: Record<string, string | number>;
}

export interface ParsedPlayer {
  number: string;
  last: string;
  first: string;
  stats: SectionedStats;
}

export interface ParsedCsv {
  battingHeaders: string[];
  pitchingHeaders: string[];
  fieldingHeaders: string[];
  players: ParsedPlayer[];
}

/**
 * Parses the team stats CSV.
 *
 * Row 1: category headers — empty cells except where a section starts ("Batting", "Pitching", "Fielding")
 * Row 2: column headers (Number, Last, First, GP, PA, AB, ...)
 * Rows 3..N-1: player data
 * Last row: glossary (skipped — no last/first name)
 *
 * Sections are detected from row 1 so we don't hardcode column indices.
 * Stats are stored split by section because column abbreviations are reused
 * across sections (e.g. H, R, BB, SO appear in both batting and pitching).
 */
export function parseStatsCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = result.data as string[][];
  if (rows.length < 3) throw new Error("CSV is too short — expected category row, header row, and data rows.");

  const categoryRow = rows[0];
  const headerRow = rows[1].map((h) => (h || "").trim());
  const dataRows = rows.slice(2);

  // Detect section ranges from category row.
  const sections: { name: string; start: number; end: number }[] = [];
  let cur: { name: string; start: number; end: number } | null = null;
  for (let i = 0; i < categoryRow.length; i++) {
    const label = (categoryRow[i] || "").trim();
    if (label) {
      if (cur) sections.push(cur);
      cur = { name: label.toLowerCase(), start: i, end: i };
    } else if (cur) {
      cur.end = i;
    }
  }
  if (cur) sections.push(cur);

  const findSection = (name: string) => sections.find((s) => s.name.startsWith(name));
  const batSec = findSection("batting");
  const pitSec = findSection("pitching");
  const fldSec = findSection("fielding");

  if (!batSec || !pitSec || !fldSec) {
    throw new Error("CSV is missing one of the Batting / Pitching / Fielding section headers in row 1.");
  }

  const sliceHeaders = (s: { start: number; end: number }) =>
    headerRow.slice(s.start, s.end + 1).filter((h) => h !== "");

  const battingHeaders = sliceHeaders(batSec);
  const pitchingHeaders = sliceHeaders(pitSec);
  const fieldingHeaders = sliceHeaders(fldSec);

  const parseCell = (raw: string): string | number => {
    const v = (raw ?? "").toString().trim();
    if (v === "" || v === "-") return "-";
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  };

  const players: ParsedPlayer[] = [];
  for (const row of dataRows) {
    const number = (row[0] || "").trim();
    const last = (row[1] || "").trim();
    const first = (row[2] || "").trim();
    if (!last || !first) continue; // glossary / blank rows
    if (last.toLowerCase().includes("glossary")) continue;

    const sectionStats = (s: { start: number; end: number }) => {
      const out: Record<string, string | number> = {};
      for (let i = s.start; i <= s.end; i++) {
        const key = headerRow[i];
        if (!key) continue;
        out[key] = parseCell(row[i] ?? "");
      }
      return out;
    };

    players.push({
      number,
      last,
      first,
      stats: {
        batting: sectionStats(batSec),
        pitching: sectionStats(pitSec),
        fielding: sectionStats(fldSec),
      },
    });
  }

  return { battingHeaders, pitchingHeaders, fieldingHeaders, players };
}

/** Format a stat value for display. */
export function formatStat(value: unknown): string {
  if (value === null || value === undefined || value === "" || value === "-") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    // Sub-1 values rendered as rate stats (.300 style)
    if (Math.abs(value) > 0 && Math.abs(value) < 1) return value.toFixed(3).replace(/^0\./, ".");
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}
