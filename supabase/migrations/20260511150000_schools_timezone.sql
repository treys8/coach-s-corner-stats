-- Per-school timezone for rendering game dates and times.
-- Default America/Chicago (US Central) — Mississippi-anchored origin team
-- and the majority of expected early users live in Central. Schools can
-- change this in Settings; values are IANA timezone names.
ALTER TABLE public.schools
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Chicago';
