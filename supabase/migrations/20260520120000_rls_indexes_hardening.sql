-- Perf hardening: reverse-direction indexes on the membership tables that
-- back is_team_member() / is_school_admin().
--
-- team_members and school_admins only have their composite PKs today
-- (team_id, user_id) and (school_id, user_id). The RLS helpers filter by
-- user_id = auth.uid(), so without a leading-user_id index Postgres has to
-- scan the PK index by the trailing column. With per-row policies on
-- games / game_events / at_bats / stat_snapshots, that cost multiplies fast
-- on tablet live-scoring and coach pages alike.

CREATE INDEX IF NOT EXISTS team_members_user_team_idx
  ON public.team_members (user_id, team_id);

CREATE INDEX IF NOT EXISTS school_admins_user_school_idx
  ON public.school_admins (user_id, school_id);
