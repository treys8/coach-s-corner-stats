-- Public Scores page: anonymous SELECT access for the rows the scoreboard
-- needs to render — schools (name/slug/colors), teams (name/sport/level),
-- and finalized games. Membership tables (school_admins, team_members),
-- player data, stat snapshots, and non-finalized games stay private.
--
-- These additive SELECT policies layer on top of the existing team-scoped
-- policies; Postgres ORs the USING clauses, so members still see everything
-- they could before.

DROP POLICY IF EXISTS "schools public read" ON public.schools;
CREATE POLICY "schools public read" ON public.schools
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "teams public read" ON public.teams;
CREATE POLICY "teams public read" ON public.teams
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "games public read finalized" ON public.games;
CREATE POLICY "games public read finalized" ON public.games
  FOR SELECT USING (is_final = TRUE);
