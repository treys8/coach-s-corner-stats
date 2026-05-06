// Stats parser. Despite the file name, this now reads the team's .xlsx workbook
// with three sheets: "Hitting", "Pitching", "Fielding".
//
// Sheet layouts (per the coach-provided template):
//   Hitting:  row 1 = column headers, rows 2..N = players, row(Totals) row = "Totals", glossary row last.
//   Pitching: row 1 = section title cell ("Pitching"), row 2 = column headers, rows 3..N = players,
//             a totals row (blank Last/First but with values), glossary row last.
//   Fielding: same shape as Pitching.
//
// Players are matched across sheets by First+Last name. The "Totals" row and the
// glossary row are skipped automatically (no last/first name on glossary; "Totals"
// label or blank name on totals row).

import * as XLSX from "xlsx";
import { GLOSSARY } from "@/lib/glossary";

const KNOWN_HEADERS = new Set(Object.keys(GLOSSARY));

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

export interface ParsedWorkbook {
  battingHeaders: string[];
  pitchingHeaders: string[];
  fieldingHeaders: string[];
  players: ParsedPlayer[];
  /** Headers found in any sheet that aren't in GLOSSARY. Data still ingested. */
  unknownHeaders: string[];
}

type Row = (string | number | null | undefined)[];

const parseCell = (raw: unknown): string | number => {
  if (raw === null || raw === undefined) return "-";
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : "-";
  const v = String(raw).trim();
  if (v === "" || v === "-") return "-";
  const n = Number(v);
  return Number.isFinite(n) && v !== "" ? n : v;
};

/** Find the header row in a sheet — first row whose first three cells are Number/Last/First. */
const findHeaderRow = (rows: Row[]): number => {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i] ?? [];
    const a = String(r[0] ?? "").trim().toLowerCase();
    const b = String(r[1] ?? "").trim().toLowerCase();
    const c = String(r[2] ?? "").trim().toLowerCase();
    if (a === "number" && b === "last" && c === "first") return i;
  }
  return 0;
};

const isPlayerRow = (row: Row): boolean => {
  const last = String(row[1] ?? "").trim();
  const first = String(row[2] ?? "").trim();
  if (!last && !first) return false;
  if (last.toLowerCase() === "totals" || first.toLowerCase() === "totals") return false;
  if (last.toLowerCase().includes("glossary")) return false;
  return true;
};

/** Parse one sheet into a header list + map of "First|Last" => stat object. */
const parseSheet = (
  ws: XLSX.WorkSheet | undefined,
  sheetName: string,
): { headers: string[]; unknown: string[]; byKey: Map<string, { number: string; first: string; last: string; stats: Record<string, string | number> }> } => {
  if (!ws) throw new Error(`Workbook is missing the "${sheetName}" sheet.`);
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, blankrows: false, defval: null });
  if (rows.length === 0) throw new Error(`"${sheetName}" sheet is empty.`);

  const headerIdx = findHeaderRow(rows);
  const headerRow = (rows[headerIdx] ?? []).map((h) => String(h ?? "").trim());
  // Stat columns start at index 3 (after Number/Last/First)
  const headers: string[] = [];
  const unknown: string[] = [];
  for (let i = 3; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (!h) continue;
    headers.push(h);
    if (!KNOWN_HEADERS.has(h)) unknown.push(h);
  }
  if (unknown.length > 0) {
    console.warn(`[csvParser] "${sheetName}" has unrecognized headers (still ingested): ${unknown.join(", ")}. Add them to GLOSSARY in src/lib/glossary.ts to silence this.`);
  }

  const byKey = new Map<string, { number: string; first: string; last: string; stats: Record<string, string | number> }>();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !isPlayerRow(row)) continue;
    const number = String(row[0] ?? "").trim();
    const last = String(row[1] ?? "").trim();
    const first = String(row[2] ?? "").trim();
    const stats: Record<string, string | number> = {};
    for (let i = 3; i < headerRow.length; i++) {
      const key = headerRow[i];
      if (!key) continue;
      stats[key] = parseCell(row[i]);
    }
    byKey.set(`${first}|${last}`, { number, first, last, stats });
  }
  return { headers, unknown, byKey };
};

/** Parse the team workbook (xlsx) buffer. */
export function parseStatsWorkbook(data: ArrayBuffer): ParsedWorkbook {
  const wb = XLSX.read(data, { type: "array" });

  // Tolerant sheet lookup (case-insensitive).
  const findSheet = (name: string): XLSX.WorkSheet | undefined => {
    const match = wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
    return match ? wb.Sheets[match] : undefined;
  };

  const hit = parseSheet(findSheet("Hitting"), "Hitting");
  const pit = parseSheet(findSheet("Pitching"), "Pitching");
  const fld = parseSheet(findSheet("Fielding"), "Fielding");

  // Union of all player keys across the three sheets.
  const allKeys = new Set<string>([...hit.byKey.keys(), ...pit.byKey.keys(), ...fld.byKey.keys()]);

  const players: ParsedPlayer[] = [];
  for (const key of allKeys) {
    const meta = hit.byKey.get(key) ?? pit.byKey.get(key) ?? fld.byKey.get(key);
    if (!meta) continue;
    players.push({
      number: meta.number,
      first: meta.first,
      last: meta.last,
      stats: {
        batting: hit.byKey.get(key)?.stats ?? {},
        pitching: pit.byKey.get(key)?.stats ?? {},
        fielding: fld.byKey.get(key)?.stats ?? {},
      },
    });
  }

  // Stable sort by last name then first.
  players.sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first));

  const unknownHeaders = Array.from(new Set([...hit.unknown, ...pit.unknown, ...fld.unknown]));

  return {
    battingHeaders: hit.headers,
    pitchingHeaders: pit.headers,
    fieldingHeaders: fld.headers,
    players,
    unknownHeaders,
  };
}

/** Format a stat value for display. */
export function formatStat(value: unknown): string {
  if (value === null || value === undefined || value === "" || value === "-") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (Math.abs(value) > 0 && Math.abs(value) < 1) return value.toFixed(3).replace(/^0\./, ".");
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}
