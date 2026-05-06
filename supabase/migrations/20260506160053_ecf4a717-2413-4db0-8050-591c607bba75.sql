DROP POLICY IF EXISTS "coaches all players"   ON public.players;
DROP POLICY IF EXISTS "coaches all snapshots" ON public.stat_snapshots;
DROP POLICY IF EXISTS "coaches all glossary"  ON public.glossary;
DROP POLICY IF EXISTS "coaches all games"     ON public.games;
DROP POLICY IF EXISTS "coaches all uploads"   ON public.csv_uploads;

CREATE POLICY "Public read players"   ON public.players       FOR SELECT USING (true);
CREATE POLICY "Public write players"  ON public.players       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read snapshots" ON public.stat_snapshots FOR SELECT USING (true);
CREATE POLICY "Public write snapshots" ON public.stat_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read glossary"  ON public.glossary      FOR SELECT USING (true);
CREATE POLICY "Public write glossary" ON public.glossary      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read games"     ON public.games         FOR SELECT USING (true);
CREATE POLICY "Public write games"    ON public.games         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read uploads"   ON public.csv_uploads   FOR SELECT USING (true);
CREATE POLICY "Public write uploads"  ON public.csv_uploads   FOR ALL USING (true) WITH CHECK (true);