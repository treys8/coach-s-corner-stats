-- Simplify season_year_for
CREATE OR REPLACE FUNCTION public.season_year_for(d date)
RETURNS smallint LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM d) = 1 THEN (EXTRACT(YEAR FROM d) - 1)::smallint
    ELSE EXTRACT(YEAR FROM d)::smallint
  END;
$$;

-- Coaches allowlist + coach-only RLS
CREATE TABLE IF NOT EXISTS public.coaches (
  email      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coaches read self" ON public.coaches;
CREATE POLICY "coaches read self" ON public.coaches
  FOR SELECT USING (lower(email) = lower(auth.jwt() ->> 'email'));

CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaches
    WHERE lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_coach() TO anon, authenticated;

DROP POLICY IF EXISTS "Public read players"   ON public.players;
DROP POLICY IF EXISTS "Public write players"  ON public.players;
DROP POLICY IF EXISTS "Public read snapshots" ON public.stat_snapshots;
DROP POLICY IF EXISTS "Public write snapshots" ON public.stat_snapshots;
DROP POLICY IF EXISTS "Public read glossary"  ON public.glossary;
DROP POLICY IF EXISTS "Public write glossary" ON public.glossary;
DROP POLICY IF EXISTS "Public read games"     ON public.games;
DROP POLICY IF EXISTS "Public write games"    ON public.games;
DROP POLICY IF EXISTS "Public read uploads"   ON public.csv_uploads;
DROP POLICY IF EXISTS "Public write uploads"  ON public.csv_uploads;

CREATE POLICY "coaches all players"   ON public.players
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());
CREATE POLICY "coaches all snapshots" ON public.stat_snapshots
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());
CREATE POLICY "coaches all glossary"  ON public.glossary
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());
CREATE POLICY "coaches all games"     ON public.games
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());
CREATE POLICY "coaches all uploads"   ON public.csv_uploads
  FOR ALL USING (public.is_coach()) WITH CHECK (public.is_coach());

INSERT INTO public.coaches (email) VALUES ('treyschill@gmail.com')
  ON CONFLICT (email) DO NOTHING;