// Season utilities. A season runs Feb 1 – May 31. After May 31 the season is "closed".
// Dates outside Feb–May are tagged with the nearest preceding season year:
// Jun–Dec map to the current calendar year (just-closed season); Jan maps to
// the prior calendar year (still the same just-closed season — year boundary crossed).
// Must stay in sync with public.season_year_for(date) in Supabase.

export const seasonYearFor = (date: Date | string): number => {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  return m === 1 ? y - 1 : y;
};

export const isSeasonClosed = (year: number, today: Date = new Date()): boolean => {
  const close = new Date(year, 4, 31, 23, 59, 59); // May 31 of that year
  return today > close;
};

export const currentSeasonYear = (today: Date = new Date()): number => seasonYearFor(today);

export const seasonLabel = (year: number): string => `${year} Season`;
