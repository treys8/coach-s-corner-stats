// Roster parser. Reads a single-sheet .xlsx or .csv file with columns:
//   Number | Last | First [| Position] [| Grad Year] [| Grade]
// Header row is auto-detected (case-insensitive). Player rows continue until
// the first blank/non-name row. "Totals" rows are skipped.

import * as XLSX from "xlsx";
import { normalizePlayerName } from "@/lib/csvParser";

export type PlayerGrade = "7th" | "8th" | "Freshman" | "Sophomore" | "Junior" | "Senior";

export const PLAYER_GRADES: PlayerGrade[] = [
  "7th", "8th", "Freshman", "Sophomore", "Junior", "Senior",
];

// Each grade's next-year default. Senior → null (graduated; not rolled into
// the next season's roster unless the coach overrides it on the confirm screen).
export const NEXT_GRADE: Record<PlayerGrade, PlayerGrade | null> = {
  "7th": "8th",
  "8th": "Freshman",
  "Freshman": "Sophomore",
  "Sophomore": "Junior",
  "Junior": "Senior",
  "Senior": null,
};

export interface ParsedRosterPlayer {
  number: string;
  last: string;
  first: string;
  position: string | null;
  grad_year: number | null;
  grade: PlayerGrade | null;
}

export interface ParsedRoster {
  players: ParsedRosterPlayer[];
  // Whether the source file had each optional column at all. Lets the caller
  // distinguish "column absent → preserve existing DB value" from "column
  // present but cell blank → clear existing DB value".
  hadNumberColumn: boolean;
  hadPositionColumn: boolean;
  hadGradYearColumn: boolean;
  hadGradeColumn: boolean;
}

type Row = (string | number | null | undefined)[];

const HEADER_ALIASES: Record<string, "number" | "last" | "first" | "position" | "grad_year" | "grade"> = {
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
  // "class" / "year" stay on grad_year for backwards compatibility with files
  // that already use them to mean the 4-digit graduation year.
  class: "grad_year",
  year: "grad_year",
  // New: per-season grade (Freshman / Senior / 7th / etc.). Disambiguated
  // from "class" via explicit aliases.
  grade: "grade",
  level: "grade",
  "class level": "grade",
  "school year": "grade",
};

// Normalize free-text grade input (CSV cell or inline edit) to the enum.
// Accepts: 7/7th, 8/8th, Fr/Fresh/Freshman/9/9th, So/Soph/Sophomore/10/10th,
// Jr/Junior/11/11th, Sr/Senior/12/12th. Case-insensitive; returns null on no match.
export function parseGrade(raw: unknown): PlayerGrade | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase().replace(/[.\s]+/g, "");
  if (!s) return null;
  if (s === "7" || s === "7th" || s === "seventh") return "7th";
  if (s === "8" || s === "8th" || s === "eighth") return "8th";
  if (s === "9" || s === "9th" || s === "ninth" || s === "fr" || s === "fresh" || s === "freshman" || s === "frosh") return "Freshman";
  if (s === "10" || s === "10th" || s === "tenth" || s === "so" || s === "soph" || s === "sophomore") return "Sophomore";
  if (s === "11" || s === "11th" || s === "eleventh" || s === "jr" || s === "junior") return "Junior";
  if (s === "12" || s === "12th" || s === "twelfth" || s === "sr" || s === "senior") return "Senior";
  return null;
}

interface HeaderMap {
  number: number;
  last: number;
  first: number;
  position: number;
  grad_year: number;
  grade: number;
}

const findHeaderRow = (rows: Row[]): { idx: number; map: HeaderMap } | null => {
  const limit = Math.min(rows.length, 8);
  for (let i = 0; i < limit; i++) {
    const r = rows[i] ?? [];
    const map: HeaderMap = { number: -1, last: -1, first: -1, position: -1, grad_year: -1, grade: -1 };
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
    const grade = map.grade >= 0 ? parseGrade(row[map.grade]) : null;

    // Use the same normalization the upsert_roster RPC's unique key uses, so
    // we don't ship two rows that the RPC would collapse — ON CONFLICT DO
    // UPDATE would error with "cannot affect row a second time" if both rows
    // hit the same player on insert.
    const key = `${normalizePlayerName(first)}|${normalizePlayerName(last)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    players.push({ number, first, last, position, grad_year, grade });
  }

  if (players.length === 0) {
    throw new Error("No players found. Make sure rows have both a First and Last name.");
  }
  return {
    players,
    hadNumberColumn: map.number >= 0,
    hadPositionColumn: map.position >= 0,
    hadGradYearColumn: map.grad_year >= 0,
    hadGradeColumn: map.grade >= 0,
  };
}
