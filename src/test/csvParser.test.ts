import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { parseStatsWorkbook, formatStat } from "@/lib/csvParser";

type Cell = string | number;

const makeWorkbook = (sheets: Record<string, Cell[][]>): ArrayBuffer => {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

const HITTING_HEADERS = ["Number", "Last", "First", "AVG", "H", "HR"];
const PITCHING_HEADERS = ["Number", "Last", "First", "ERA", "SO", "IP"];
const FIELDING_HEADERS = ["Number", "Last", "First", "FPCT", "TC", "E"];

describe("parseStatsWorkbook", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("parses three-sheet workbook into per-player nested stats", () => {
    const buf = makeWorkbook({
      Hitting: [
        HITTING_HEADERS,
        ["10", "Smith", "John", 0.300, 3, 1],
        ["7", "Doe", "Jane", 0.250, 2, 0],
      ],
      Pitching: [
        PITCHING_HEADERS,
        ["10", "Smith", "John", 2.50, 8, 4.0],
      ],
      Fielding: [
        FIELDING_HEADERS,
        ["10", "Smith", "John", 0.950, 20, 1],
        ["7", "Doe", "Jane", 1.000, 5, 0],
      ],
    });

    const { players } = parseStatsWorkbook(buf);
    expect(players).toHaveLength(2);

    const john = players.find((p) => p.first === "John")!;
    expect(john.last).toBe("Smith");
    expect(john.number).toBe("10");
    expect(john.stats.batting.AVG).toBe(0.300);
    expect(john.stats.batting.H).toBe(3);
    expect(john.stats.pitching.ERA).toBe(2.50);
    expect(john.stats.pitching.IP).toBe(4.0);
    expect(john.stats.fielding.FPCT).toBe(0.950);

    const jane = players.find((p) => p.first === "Jane")!;
    expect(jane.stats.batting.AVG).toBe(0.250);
    // Jane has no pitching row → empty section
    expect(jane.stats.pitching).toEqual({});
    expect(jane.stats.fielding.FPCT).toBe(1.000);
  });

  it("skips Totals rows", () => {
    const buf = makeWorkbook({
      Hitting: [
        HITTING_HEADERS,
        ["10", "Smith", "John", 0.300, 3, 1],
        ["", "Totals", "", 0.275, 50, 8],
      ],
      Pitching: [PITCHING_HEADERS],
      Fielding: [FIELDING_HEADERS],
    });
    const { players } = parseStatsWorkbook(buf);
    expect(players).toHaveLength(1);
    expect(players[0].last).toBe("Smith");
  });

  it("skips glossary rows", () => {
    const buf = makeWorkbook({
      Hitting: [
        HITTING_HEADERS,
        ["10", "Smith", "John", 0.300, 3, 1],
        ["", "Glossary: AVG = batting average", "", "", "", ""],
      ],
      Pitching: [PITCHING_HEADERS],
      Fielding: [FIELDING_HEADERS],
    });
    const { players } = parseStatsWorkbook(buf);
    expect(players).toHaveLength(1);
  });

  it("matches Hitting/Pitching/Fielding sheet names case-insensitively", () => {
    const buf = makeWorkbook({
      hitting: [HITTING_HEADERS, ["10", "Smith", "John", 0.300, 3, 1]],
      PITCHING: [PITCHING_HEADERS],
      Fielding: [FIELDING_HEADERS],
    });
    const { players } = parseStatsWorkbook(buf);
    expect(players).toHaveLength(1);
  });

  it("throws when a required sheet is missing", () => {
    const buf = makeWorkbook({
      Hitting: [HITTING_HEADERS, ["10", "Smith", "John", 0.300, 3, 1]],
      // No Pitching, no Fielding
    });
    expect(() => parseStatsWorkbook(buf)).toThrow(/Pitching/);
  });

  it("flags unrecognized headers via unknownHeaders without dropping data", () => {
    const buf = makeWorkbook({
      Hitting: [
        ["Number", "Last", "First", "AVG", "MADE_UP_STAT"],
        ["10", "Smith", "John", 0.300, 42],
      ],
      Pitching: [PITCHING_HEADERS],
      Fielding: [FIELDING_HEADERS],
    });
    const { players, unknownHeaders } = parseStatsWorkbook(buf);
    expect(unknownHeaders).toContain("MADE_UP_STAT");
    // Data is still ingested under the unknown header.
    expect(players[0].stats.batting.MADE_UP_STAT).toBe(42);
  });

  it("returns empty unknownHeaders when all columns are known", () => {
    const buf = makeWorkbook({
      Hitting: [HITTING_HEADERS, ["10", "Smith", "John", 0.300, 3, 1]],
      Pitching: [PITCHING_HEADERS],
      Fielding: [FIELDING_HEADERS],
    });
    const { unknownHeaders } = parseStatsWorkbook(buf);
    expect(unknownHeaders).toEqual([]);
  });

  it("coerces blank cells and dashes to '-'", () => {
    const buf = makeWorkbook({
      Hitting: [HITTING_HEADERS, ["10", "Smith", "John", "-", "", 1]],
      Pitching: [PITCHING_HEADERS],
      Fielding: [FIELDING_HEADERS],
    });
    const { players } = parseStatsWorkbook(buf);
    expect(players[0].stats.batting.AVG).toBe("-");
    expect(players[0].stats.batting.H).toBe("-");
    expect(players[0].stats.batting.HR).toBe(1);
  });
});

describe("formatStat", () => {
  it("renders rate stats below 1 with leading-dot fixed-3 form", () => {
    expect(formatStat(0.305)).toBe(".305");
  });

  it("renders integers as integers", () => {
    expect(formatStat(7)).toBe("7");
  });

  it("renders other floats with two decimals", () => {
    expect(formatStat(2.5)).toBe("2.50");
  });

  it("renders empty placeholders as em-dash", () => {
    expect(formatStat(undefined)).toBe("—");
    expect(formatStat(null)).toBe("—");
    expect(formatStat("")).toBe("—");
    expect(formatStat("-")).toBe("—");
  });
});
