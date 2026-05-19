// Canonical name normalization for player identity matching across uploads,
// rosters, and live scoring. Mirrors `public.normalize_player_name()` in SQL
// (see Phase B1 of the stats upload work) so the same input collapses to the
// same key on either side of the wire.
//
// Steps:
//   1. NFKC unicode fold ("Ｊａｎｅ" → "Jane", "ﬁ" → "fi")
//   2. lowercase
//   3. strip straight/curly apostrophes + quote marks
//   4. collapse runs of whitespace to a single space
//   5. trim leading/trailing whitespace and trailing "." / ","

export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[''"`’ʼ‘”“]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,]+|[\s.,]+$/g, "");
}
