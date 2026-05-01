// Season utilities. A season runs Feb 1 – May 31. After May 31 the season is "closed".
// Dates outside Feb–May are tagged with the nearest preceding season year.

export const seasonYearFor = (date: Date | string): number => {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  if (m >= 2 && (m < 6 || (m === 5 && day <= 31))) return y;
  if (m < 2) return y - 1;
  return y; // June–Dec: that year's season is already closed
};

export const isSeasonClosed = (year: number, today: Date = new Date()): boolean => {
  const close = new Date(year, 4, 31, 23, 59, 59); // May 31 of that year
  return today > close;
};

export const currentSeasonYear = (today: Date = new Date()): number => seasonYearFor(today);

export const seasonLabel = (year: number): string => `${year} Season`;
