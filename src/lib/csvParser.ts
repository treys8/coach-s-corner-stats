// Stats parser. Reads the team's .xlsx workbook with up to three sheets named
// "Hitting", "Pitching", "Fielding" — but each is independently optional. A
// single-sheet hitting-only file is valid, as is a 2-sheet file. CSV inputs
// are also accepted (XLSX.read auto-detects) and route through the override
// path so the coach picks the category.
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

export type StatsCategory = "batting" | "pitching" | "fielding";

const SHEET_NAME_FOR: Record<StatsCategory, string> = {
  batting: "Hitting",
  pitching: "Pitching",
  fielding: "Fielding",
};

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
  /** Categories that had a parseable sheet in this file. */
  presentCategories: StatsCategory[];
  /** Categories not present in this file (will be ingested as empty buckets). */
  missingCategories: StatsCategory[];
  /**
   * True when the file has exactly one sheet and that sheet isn't named
   * Hitting/Pitching/Fielding — the UI needs to ask the coach which category
   * the columns represent and re-parse with `categoryOverride`.
   */
  needsCategoryOverride: boolean;
  /** Original sheet name surfaced when needsCategoryOverride is true. */
  unrecognizedSheetName?: string;
}

export interface ParseStatsOptions {
  /**
   * Force the (first) sheet to be parsed into this category, regardless of
   * sheet name. Used for CSV inputs (one anonymous sheet) and for the
   * "Detected: Pitching — change?" override flow.
   */
  categoryOverride?: StatsCategory;
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

type ParsedSheet = {
  headers: string[];
  unknown: string[];
  byKey: Map<string, { number: string; first: string; last: string; stats: Record<string, string | number> }>;
};

const emptyParsedSheet = (): ParsedSheet => ({ headers: [], unknown: [], byKey: new Map() });

/** Parse one sheet into a header list + map of "First|Last" => stat object. */
const parseSheet = (
  ws: XLSX.WorkSheet,
  sheetName: string,
): ParsedSheet => {
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

/** Parse the team workbook (xlsx or csv) buffer. */
export function parseStatsWorkbook(data: ArrayBuffer, options: ParseStatsOptions = {}): ParsedWorkbook {
  const wb = XLSX.read(data, { type: "array" });
  if (wb.SheetNames.length === 0) throw new Error("File contains no sheets.");

  const { categoryOverride } = options;

  // Case-insensitive sheet lookup.
  const findSheet = (name: string): { ws: XLSX.WorkSheet; actualName: string } | undefined => {
    const match = wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
    if (!match) return undefined;
    return { ws: wb.Sheets[match], actualName: match };
  };

  let battingSheet: ParsedSheet = emptyParsedSheet();
  let pitchingSheet: ParsedSheet = emptyParsedSheet();
  let fieldingSheet: ParsedSheet = emptyParsedSheet();
  let needsCategoryOverride = false;
  let unrecognizedSheetName: string | undefined;

  if (categoryOverride) {
    // Override path: parse the first sheet (CSV always has one; xlsx may have
    // one or more) and force-route it into the chosen category. If the file
    // has a sheet whose name matches the override category, prefer that
    // sheet; otherwise fall back to the first sheet.
    const named = findSheet(SHEET_NAME_FOR[categoryOverride]);
    const ws = named?.ws ?? wb.Sheets[wb.SheetNames[0]];
    const sheetLabel = named?.actualName ?? wb.SheetNames[0];
    const parsed = parseSheet(ws, sheetLabel);
    if (categoryOverride === "batting") battingSheet = parsed;
    else if (categoryOverride === "pitching") pitchingSheet = parsed;
    else fieldingSheet = parsed;
  } else {
    // Auto path: look for sheets named Hitting/Pitching/Fielding.
    const hit = findSheet("Hitting");
    const pit = findSheet("Pitching");
    const fld = findSheet("Fielding");

    if (hit) battingSheet = parseSheet(hit.ws, "Hitting");
    if (pit) pitchingSheet = parseSheet(pit.ws, "Pitching");
    if (fld) fieldingSheet = parseSheet(fld.ws, "Fielding");

    // If we found nothing by name, the file probably has a generic sheet
    // (CSV exports → "Sheet1"; coach exports from another tool → arbitrary
    // names). The caller needs to ask the coach which category this is.
    if (!hit && !pit && !fld) {
      needsCategoryOverride = true;
      unrecognizedSheetName = wb.SheetNames[0];
    } else {
      // A typo'd sheet ("Hittiing") would silently fall out here. Surface
      // dropped sheets so a coach hunting through devtools can spot it.
      const matched = new Set([hit?.actualName, pit?.actualName, fld?.actualName].filter((n): n is string => !!n));
      const dropped = wb.SheetNames.filter((n) => !matched.has(n));
      if (dropped.length > 0) {
        console.warn(`[csvParser] Ignored unrecognized sheets (no auto-detected category): ${dropped.join(", ")}. Rename to Hitting/Pitching/Fielding, or upload them separately and pick the category.`);
      }
    }
  }

  // Union of all player keys across whichever sheets were populated.
  const allKeys = new Set<string>([
    ...battingSheet.byKey.keys(),
    ...pitchingSheet.byKey.keys(),
    ...fieldingSheet.byKey.keys(),
  ]);

  const players: ParsedPlayer[] = [];
  for (const key of allKeys) {
    const meta = battingSheet.byKey.get(key) ?? pitchingSheet.byKey.get(key) ?? fieldingSheet.byKey.get(key);
    if (!meta) continue;
    players.push({
      number: meta.number,
      first: meta.first,
      last: meta.last,
      stats: {
        batting: battingSheet.byKey.get(key)?.stats ?? {},
        pitching: pitchingSheet.byKey.get(key)?.stats ?? {},
        fielding: fieldingSheet.byKey.get(key)?.stats ?? {},
      },
    });
  }

  // Stable sort by last name then first.
  players.sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first));

  const unknownHeaders = Array.from(
    new Set([...battingSheet.unknown, ...pitchingSheet.unknown, ...fieldingSheet.unknown]),
  );

  const presentCategories: StatsCategory[] = [];
  const missingCategories: StatsCategory[] = [];
  (
    [
      ["batting", battingSheet],
      ["pitching", pitchingSheet],
      ["fielding", fieldingSheet],
    ] as const
  ).forEach(([cat, sheet]) => {
    if (sheet.byKey.size > 0 || sheet.headers.length > 0) presentCategories.push(cat);
    else missingCategories.push(cat);
  });

  return {
    battingHeaders: battingSheet.headers,
    pitchingHeaders: pitchingSheet.headers,
    fieldingHeaders: fieldingSheet.headers,
    players,
    unknownHeaders,
    presentCategories,
    missingCategories,
    needsCategoryOverride,
    unrecognizedSheetName,
  };
}

// ---------------------------------------------------------------------------
// Schedule sheet parser (CSV + xlsx). Used by /upload/schedule.
//
// Expected columns (case-insensitive, order-insensitive):
//   Date         (required)  — ISO 'YYYY-MM-DD', US 'M/D/YYYY', or Excel serial
//   Opponent     (required)  — free text; later fuzzy-matched in the preview
//   Time         (optional)  — '4:30 PM', '16:30', '4pm', etc. (blank ok)
//   Location     (optional)  — Home/Away/Neutral, also H/A/N or '@' for away.
//                              Defaults to 'home' if missing.
//   Doubleheader (optional)  — Y/yes/true/DH/1 → emit two rows (sequence 1+2)
//   Notes        (optional)  — free text
//
// Doubleheaders are expanded at parse time so the preview shows the actual
// rows that will be inserted. Game 2 inherits game 1's time; the user can
// adjust either in the preview before commit.

export type ScheduleLocation = "home" | "away" | "neutral";

export interface ParsedScheduleRow {
  /** 1-based source row number (after header), for "row X" warnings in the UI. */
  sourceRow: number;
  game_date: string;     // YYYY-MM-DD
  game_time: string;     // HH:MM, or '' if absent
  opponent: string;
  location: ScheduleLocation;
  game_sequence: 1 | 2;  // 2 means it's the second leg of a doubleheader
  notes: string;
}

export interface ParsedSchedule {
  rows: ParsedScheduleRow[];
  /** Soft issues — non-fatal; the row was parsed but something looked off. */
  warnings: string[];
}

const SCHEDULE_HEADER_ALIASES: Record<string, string> = {
  date: "date",
  "game date": "date",
  time: "time",
  "game time": "time",
  "start time": "time",
  opponent: "opponent",
  opp: "opponent",
  vs: "opponent",
  versus: "opponent",
  location: "location",
  loc: "location",
  "home/away": "location",
  doubleheader: "doubleheader",
  dh: "doubleheader",
  notes: "notes",
  note: "notes",
  comment: "notes",
  comments: "notes",
};

const TRUE_TOKENS = new Set(["y", "yes", "true", "1", "dh", "doubleheader", "x"]);

const parseLocation = (raw: string, opponent: string): ScheduleLocation => {
  const v = raw.trim().toLowerCase();
  if (v === "home" || v === "h") return "home";
  if (v === "away" || v === "a" || v === "@") return "away";
  if (v === "neutral" || v === "n") return "neutral";
  // Fall back to a hint from opponent text: "@ Magnolia" or "at Magnolia" → away.
  const op = opponent.trim().toLowerCase();
  if (op.startsWith("@") || op.startsWith("at ")) return "away";
  return "home";
};

/** Strip a leading "@ " / "at " / "vs " from an opponent cell. */
const cleanOpponent = (raw: string): string => {
  let v = raw.trim();
  v = v.replace(/^@\s*/i, "");
  v = v.replace(/^(at|vs\.?)\s+/i, "");
  return v;
};

/** Excel stores dates as days-since-1900 (with the famous Lotus leap-year bug). */
const excelSerialToISO = (serial: number): string | null => {
  if (!Number.isFinite(serial) || serial < 1) return null;
  // 25569 = days between 1899-12-30 (Excel epoch) and 1970-01-01 (Unix epoch).
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  // Use UTC getters: serial is a date-only value, so pulling local components
  // would shift a day in non-UTC zones.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseDateCell = (raw: unknown): string | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return excelSerialToISO(raw);
  // Excel can also hand us a JS Date when cellDates:true; defensively handle it.
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  if (!s) return null;
  // ISO-ish: 2026-04-15 (also tolerates 2026/4/15)
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // US: 4/15/2026 or 04/15/26
  const us = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (us) {
    const [, m, d, yRaw] = us;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
};

const parseTimeCell = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "number") {
    // Excel time is a fraction of a day. 0.5 = 12:00. Allow either fraction
    // or a serial-day with a fraction component.
    const frac = raw - Math.floor(raw);
    if (frac <= 0) return "";
    const totalMin = Math.round(frac * 24 * 60);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const s = String(raw).trim().toLowerCase();
  if (!s) return "";
  // Accept '4pm', '4:30pm', '4:30 pm', '16:30', '4', etc.
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];
  if (Number.isNaN(h) || Number.isNaN(min) || h > 23 || min > 59) return "";
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};

const isTruthyDh = (raw: unknown): boolean => {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  return TRUE_TOKENS.has(String(raw).trim().toLowerCase());
};

/** Parse the first sheet (xlsx) or CSV buffer. */
export function parseScheduleSheet(data: ArrayBuffer): ParsedSchedule {
  // SheetJS auto-detects xlsx vs csv from buffer content.
  const wb = XLSX.read(data, { type: "array" });
  const firstName = wb.SheetNames[0];
  if (!firstName) throw new Error("File contains no sheets.");
  const ws = wb.Sheets[firstName];
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, blankrows: false, defval: null });
  if (rows.length === 0) throw new Error("Sheet is empty.");

  // Find header row: first row with both a 'date' and 'opponent' column (under any alias).
  let headerIdx = -1;
  let headerMap: Record<string, number> = {};
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i] ?? [];
    const map: Record<string, number> = {};
    r.forEach((cell, idx) => {
      const key = String(cell ?? "").trim().toLowerCase();
      const canon = SCHEDULE_HEADER_ALIASES[key];
      if (canon && map[canon] === undefined) map[canon] = idx;
    });
    if (map.date !== undefined && map.opponent !== undefined) {
      headerIdx = i;
      headerMap = map;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error("Couldn't find a header row with both Date and Opponent columns.");
  }

  const warnings: string[] = [];
  const out: ParsedScheduleRow[] = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const sourceRow = r - headerIdx; // 1-based, excluding header
    const dateCell = headerMap.date !== undefined ? row[headerMap.date] : null;
    const oppCell = headerMap.opponent !== undefined ? row[headerMap.opponent] : null;
    // Skip totally blank rows silently.
    const allBlank = row.every((c) => c === null || c === undefined || String(c).trim() === "");
    if (allBlank) continue;

    const dateISO = parseDateCell(dateCell);
    const opponentRaw = String(oppCell ?? "").trim();
    if (!dateISO) {
      warnings.push(`Row ${sourceRow}: couldn't parse date "${String(dateCell ?? "")}" — skipped.`);
      continue;
    }
    if (!opponentRaw) {
      warnings.push(`Row ${sourceRow}: opponent is blank — skipped.`);
      continue;
    }

    const timeRaw = headerMap.time !== undefined ? row[headerMap.time] : null;
    const time = parseTimeCell(timeRaw);
    if (timeRaw && !time) {
      warnings.push(`Row ${sourceRow}: couldn't parse time "${String(timeRaw)}" — left blank.`);
    }

    const locationRaw = headerMap.location !== undefined ? String(row[headerMap.location] ?? "") : "";
    const location = parseLocation(locationRaw, opponentRaw);
    const opponent = cleanOpponent(opponentRaw);

    const notesRaw = headerMap.notes !== undefined ? row[headerMap.notes] : null;
    const notes = String(notesRaw ?? "").trim();

    const dhExplicit = headerMap.doubleheader !== undefined && isTruthyDh(row[headerMap.doubleheader]);
    // Also detect "(DH)" / "DH" inline in opponent or notes when no column exists.
    const dhInline = /\b(dh|doubleheader)\b/i.test(opponentRaw) || /\b(dh|doubleheader)\b/i.test(notes);
    const isDh = dhExplicit || dhInline;

    const baseRow: ParsedScheduleRow = {
      sourceRow,
      game_date: dateISO,
      game_time: time,
      opponent,
      location,
      game_sequence: 1,
      notes,
    };
    out.push(baseRow);
    if (isDh) {
      out.push({ ...baseRow, game_sequence: 2 });
    }
  }

  if (out.length === 0) {
    throw new Error("No valid rows found in the file. Check your column headers and data.");
  }
  return { rows: out, warnings };
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
