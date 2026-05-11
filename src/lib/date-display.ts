// Date formatting helpers for rendering YYYY-MM-DD strings in a specific
// IANA timezone (the school's). Game dates are stored as naive DATE values;
// `new Date("2026-05-11")` parses as UTC midnight, and `.toLocaleDateString()`
// then renders the previous day for any viewer west of UTC. Anchoring the
// parse to UTC noon (`T12:00:00Z`) and formatting through `Intl.DateTimeFormat`
// with an explicit `timeZone` avoids the rollover regardless of where the
// viewer is.

export type DatePart = "day" | "month-short" | "weekday-long" | "long";

const partOptions = (part: DatePart): Intl.DateTimeFormatOptions => {
  switch (part) {
    case "day":
      return { day: "numeric" };
    case "month-short":
      return { month: "short" };
    case "weekday-long":
      return { weekday: "long" };
    case "long":
      return { weekday: "long", month: "short", day: "numeric" };
  }
};

export const formatDatePart = (
  dateStr: string,
  part: DatePart,
  timezone: string,
): string => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    ...partOptions(part),
    timeZone: timezone,
  }).format(d);
};

/** Format a Postgres TIME value ("HH:MM" or "HH:MM:SS") as 12-hour
 *  "h:MM am/pm" (e.g. "17:00" → "5:00 pm"). */
export const formatGameTime = (t: string): string => {
  const [hh, mm] = t.split(":");
  const h = Number(hh);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm} ${ampm}`;
};

/** YYYY-MM-DD for "now" in the given IANA timezone. Used to bucket games
 *  into upcoming/past via string comparison against game_date. */
export const localToday = (timezone: string): string => {
  // en-CA emits YYYY-MM-DD natively, sidestepping locale-specific separators.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};
