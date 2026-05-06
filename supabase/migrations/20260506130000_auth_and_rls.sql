-- Phase 2 auth: replace open RLS with coach-only access.
-- Coaches are identified by the email on their Supabase Auth JWT, matched
-- against an allow-list in public.coaches. Anyone whose email is in the
-- table can read/write everything; anyone else gets nothing.

CREATE TABLE IF NOT EXISTS public.coaches (
  email      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

-- A coach can see their own row (used by the app to confirm authorization).
DROP POLICY IF EXISTS "coaches read self" ON public.coaches;
CREATE POLICY "coaches read self" ON public.coaches
  FOR SELECT USING (lower(email) = lower(auth.jwt() ->> 'email'));

-- is_coach(): true iff the caller's JWT email is in the coaches table.
-- SECURITY DEFINER so it can read public.coaches even when the caller can't.
CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaches
    WHERE lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_coach() TO anon, authenticated;

-- Drop the old wide-open policies.
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

-- Coach-only policies on every data table.
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

-- Bootstrap: seed the first coach so you aren't locked out on first deploy.
-- Add more coaches later with: INSERT INTO public.coaches (email) VALUES ('them@example.com');
INSERT INTO public.coaches (email) VALUES ('treyschill@gmail.com')
  ON CONFLICT (email) DO NOTHING;
