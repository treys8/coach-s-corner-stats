// Roster parser. Reads a single-sheet .xlsx or .csv file with columns:
//   Number | Last | First [| Position] [| Grad Year]
// Header row is auto-detected (case-insensitive). Player rows continue until
// the first blank/non-name row. "Totals" rows are skipped.

import * as XLSX from "xlsx";

export interface ParsedRosterPlayer {
  number: string;
  last: string;
  first: string;
  position: string | null;
  grad_year: number | null;
}

export interface ParsedRoster {
  players: ParsedRosterPlayer[];
}

type Row = (string | number | null | undefined)[];

const HEADER_ALIASES: Record<string, "number" | "last" | "first" | "position" | "grad_year"> = {
  number: "number",
  "#": "number",
  jersey: "number",
  "jersey number": "number",
  "jersey #": "number",
  last: "last",
  "last name": "last",
  surname: "last",
  first: "first",
  "first name": "first",
  position: "position",
  pos: "position",
  "grad year": "grad_year",
  "graduation year": "grad_year",
  class: "grad_year",
  year: "grad_year",
};

interface HeaderMap {
  number: number;
  last: number;
  first: number;
  position: number;
  grad_year: number;
}

const findHeaderRow = (rows: Row[]): { idx: number; map: HeaderMap } | null => {
  const limit = Math.min(rows.length, 8);
  for (let i = 0; i < limit; i++) {
    const r = rows[i] ?? [];
    const map: HeaderMap = { number: -1, last: -1, first: -1, position: -1, grad_year: -1 };
    for (let c = 0; c < r.length; c++) {
      const cell = String(r[c] ?? "").trim().toLowerCase();
      const role = HEADER_ALIASES[cell];
      if (role && map[role] === -1) map[role] = c;
    }
    if (map.first !== -1 && map.last !== -1) return { idx: i, map };
  }
  return null;
};

const isPlayerRow = (row: Row, map: HeaderMap): boolean => {
  const last = String(row[map.last] ?? "").trim();
  const first = String(row[map.first] ?? "").trim();
  if (!last || !first) return false;
  if (last.toLowerCase() === "totals" || first.toLowerCase() === "totals") return false;
  if (last.toLowerCase().includes("glossary")) return false;
  return true;
};

const parseGradYear = (raw: unknown): number | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  // Accept 4-digit years; reject obvious junk.
  if (n >= 1900 && n <= 2100) return Math.trunc(n);
  return null;
};

export function parseRosterFile(data: ArrayBuffer): ParsedRoster {
  const wb = XLSX.read(data, { type: "array" });
  if (wb.SheetNames.length === 0) throw new Error("File contains no sheets.");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, blankrows: false, defval: null });
  if (rows.length === 0) throw new Error("Sheet is empty.");

  const found = findHeaderRow(rows);
  if (!found) {
    throw new Error('Could not find a header row with "First" and "Last" columns.');
  }
  const { idx, map } = found;

  const seen = new Set<string>();
  const players: ParsedRosterPlayer[] = [];
  for (let r = idx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !isPlayerRow(row, map)) continue;
    const last = String(row[map.last] ?? "").trim();
    const first = String(row[map.first] ?? "").trim();
    const number = map.number >= 0 ? String(row[map.number] ?? "").trim() : "";
    const position = map.position >= 0 ? (String(row[map.position] ?? "").trim() || null) : null;
    const grad_year = map.grad_year >= 0 ? parseGradYear(row[map.grad_year]) : null;

    const key = `${first.toLowerCase()}|${last.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    players.push({ number, first, last, position, grad_year });
  }

  if (players.length === 0) {
    throw new Error("No players found. Make sure rows have both a First and Last name.");
  }
  return { players };
}
