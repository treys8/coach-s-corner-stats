import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseRosterFile } from "@/lib/rosterParser";

type Cell = string | number;

const makeBook = (rows: Cell[][]): ArrayBuffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Roster");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

describe("parseRosterFile", () => {
  it("parses minimal First/Last only and reports no optional columns", () => {
    const r = parseRosterFile(
      makeBook([
        ["First", "Last"],
        ["Jane", "Smith"],
      ]),
    );
    expect(r.players).toHaveLength(1);
    expect(r.players[0]).toMatchObject({ first: "Jane", last: "Smith", number: "" });
    expect(r.players[0].position).toBeNull();
    expect(r.players[0].grad_year).toBeNull();
    expect(r.hadNumberColumn).toBe(false);
    expect(r.hadPositionColumn).toBe(false);
    expect(r.hadGradYearColumn).toBe(false);
  });

  it("flags Position column present even when the cell is blank", () => {
    const r = parseRosterFile(
      makeBook([
        ["First", "Last", "Position"],
        ["Jane", "Smith", ""],
      ]),
    );
    expect(r.hadPositionColumn).toBe(true);
    expect(r.players[0].position).toBeNull();
  });

  it("parses jersey number, position, and grad year via header aliases", () => {
    const r = parseRosterFile(
      makeBook([
        ["#", "Last", "First", "Pos", "Class"],
        [9, "Doe", "John", "SS", 2027],
      ]),
    );
    expect(r.hadNumberColumn).toBe(true);
    expect(r.hadPositionColumn).toBe(true);
    expect(r.hadGradYearColumn).toBe(true);
    expect(r.players[0]).toMatchObject({
      number: "9",
      first: "John",
      last: "Doe",
      position: "SS",
      grad_year: 2027,
    });
  });

  it("dedupes case-insensitive duplicate names within a single file", () => {
    const r = parseRosterFile(
      makeBook([
        ["First", "Last"],
        ["Jane", "Smith"],
        ["jane", "smith"],
      ]),
    );
    expect(r.players).toHaveLength(1);
    // Keeps the first-seen casing.
    expect(r.players[0]).toMatchObject({ first: "Jane", last: "Smith" });
  });

  it("skips Totals and Glossary rows", () => {
    const r = parseRosterFile(
      makeBook([
        ["First", "Last"],
        ["Jane", "Smith"],
        ["", "Totals"],
        ["Glossary: AVG = batting average", ""],
      ]),
    );
    expect(r.players).toHaveLength(1);
  });

  it("returns null for non-year grad values", () => {
    const r = parseRosterFile(
      makeBook([
        ["First", "Last", "Grad Year"],
        ["Jane", "Smith", 42],
      ]),
    );
    expect(r.hadGradYearColumn).toBe(true);
    expect(r.players[0].grad_year).toBeNull();
  });

  it("throws when the file has no First/Last header", () => {
    expect(() =>
      parseRosterFile(
        makeBook([
          ["Foo", "Bar"],
          [1, 2],
        ]),
      ),
    ).toThrow();
  });

  it("throws when no player rows are present", () => {
    expect(() => parseRosterFile(makeBook([["First", "Last"]]))).toThrow(/No players/);
  });
});
