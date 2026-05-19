// Canonical normalization for opposing-team names. Used to dedupe
// "Meridian", "  Meridian", "@ Meridian", "vs Meridian", and "MERIDIAN" into
// the same logical opponent, both when grouping the opponents list and when
// recognizing repeat opponents during schedule upload.
//
// Output is intended as a stable key, not for display. Always render the
// original raw string.

export function normalizeOpponentName(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^@\s*/i, "");
  v = v.replace(/^(at|vs\.?)\s+/i, "");
  return v.toLowerCase();
}
