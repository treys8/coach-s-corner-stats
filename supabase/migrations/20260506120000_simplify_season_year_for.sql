-- Simplify season_year_for: the original CASE had unreachable branches.
-- A "season year" is the calendar year of Feb 1 – May 31. Dates in Jun–Dec
-- belong to that calendar year's just-closed season; dates in Jan belong to
-- the prior calendar year's season (the year boundary crossed mid-offseason).
CREATE OR REPLACE FUNCTION public.season_year_for(d date)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM d) = 1 THEN (EXTRACT(YEAR FROM d) - 1)::smallint
    ELSE EXTRACT(YEAR FROM d)::smallint
  END;
$$;
