import { describe, it, expect } from "vitest";
import { matchAgainstRoster, type RosterPlayer } from "@/lib/players/matchRoster";

const roster: RosterPlayer[] = [
  { id: "p1", first_name: "John", last_name: "Smith" },
  { id: "p2", first_name: "Jane", last_name: "Doe" },
  { id: "p3", first_name: "Bobby", last_name: "Garcia" },
];

describe("matchAgainstRoster", () => {
  it("returns existing on exact normalized match (case-insensitive)", () => {
    const r = matchAgainstRoster({ first: "JOHN", last: "smith" }, roster);
    expect(r.kind).toBe("existing");
    if (r.kind === "existing") expect(r.player.id).toBe("p1");
  });

  it("returns existing when incoming has trailing punctuation that normalizes away", () => {
    const r = matchAgainstRoster({ first: "John", last: "Smith." }, roster);
    expect(r.kind).toBe("existing");
    if (r.kind === "existing") expect(r.player.id).toBe("p1");
  });

  it("returns similar with the nearest suggestion when within distance 2", () => {
    const r = matchAgainstRoster({ first: "Jon", last: "Smith" }, roster);
    expect(r.kind).toBe("similar");
    if (r.kind === "similar") {
      expect(r.suggestion.id).toBe("p1");
      expect(r.distance).toBe(1);
    }
  });

  it("flags a transposition (Smtih → Smith) as similar at distance 2", () => {
    const r = matchAgainstRoster({ first: "John", last: "Smtih" }, roster);
    expect(r.kind).toBe("similar");
    if (r.kind === "similar") expect(r.suggestion.id).toBe("p1");
  });

  it("returns new when no existing player is within distance 2", () => {
    const r = matchAgainstRoster({ first: "Rodriguez", last: "Martinez" }, roster);
    expect(r.kind).toBe("new");
  });

  it("returns new on an empty roster", () => {
    const r = matchAgainstRoster({ first: "John", last: "Smith" }, []);
    expect(r.kind).toBe("new");
  });

  it("prefers the closer of two similar candidates", () => {
    // Garcia → Garca (dist 1) AND Garci (dist 1) — but Garcia exists exactly.
    // Pick something where two near-misses both exist:
    const r = matchAgainstRoster(
      { first: "Bobi", last: "Garca" },
      [
        { id: "p1", first_name: "Bobby", last_name: "Garcia" },     // ~3 total
        { id: "p2", first_name: "Bob",   last_name: "Garca"  },     // ~2 total
      ],
    );
    expect(r.kind).toBe("similar");
    if (r.kind === "similar") expect(r.suggestion.id).toBe("p2");
  });
});
