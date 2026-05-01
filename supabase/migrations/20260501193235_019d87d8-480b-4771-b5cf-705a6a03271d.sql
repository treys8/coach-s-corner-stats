
-- Players roster
CREATE TABLE public.players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  jersey_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (first_name, last_name)
);

-- Weekly stat snapshots per player
CREATE TABLE public.stat_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  upload_date DATE NOT NULL,
  upload_id UUID,
  stats JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, upload_date)
);
CREATE INDEX stat_snapshots_player_idx ON public.stat_snapshots (player_id, upload_date DESC);

-- Glossary of stat abbreviations
CREATE TABLE public.glossary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  abbreviation TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schedule
CREATE TABLE public.games (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_date DATE NOT NULL,
  game_time TIME,
  opponent TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'home',
  team_score INTEGER,
  opponent_score INTEGER,
  result TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX games_date_idx ON public.games (game_date);

-- Upload audit
CREATE TABLE public.csv_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  upload_date DATE NOT NULL,
  filename TEXT,
  player_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (open policies for now; will tighten when auth is added)
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stat_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glossary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_uploads ENABLE ROW LEVEL SECURITY;

-- Open policies (temporary until login is wired)
CREATE POLICY "Public read players" ON public.players FOR SELECT USING (true);
CREATE POLICY "Public write players" ON public.players FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read snapshots" ON public.stat_snapshots FOR SELECT USING (true);
CREATE POLICY "Public write snapshots" ON public.stat_snapshots FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read glossary" ON public.glossary FOR SELECT USING (true);
CREATE POLICY "Public write glossary" ON public.glossary FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read games" ON public.games FOR SELECT USING (true);
CREATE POLICY "Public write games" ON public.games FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read uploads" ON public.csv_uploads FOR SELECT USING (true);
CREATE POLICY "Public write uploads" ON public.csv_uploads FOR ALL USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER players_updated_at BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER games_updated_at BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
