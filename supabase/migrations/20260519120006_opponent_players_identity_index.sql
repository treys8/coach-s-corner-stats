-- opponent_players' soft-identity unique index (20260512120000_opponent_players.sql:58-64)
-- excludes external_player_id. That means a manual "Smith #12" row and an
-- externally-linked "Smith #12" copied from another tenant's roster via
-- get_public_roster() can both exist with the same school/last/jersey/team
-- — except one has external_player_id set and the other doesn't. The
-- soft-identity index treats them as a collision, even though they are
-- semantically distinct (manual vs. linked).
--
-- Adding external_player_id (COALESCE'd to '__manual__' for null) to the
-- index expression lets both coexist while still blocking same-source dupes.

DO $$
DECLARE
  v_dupes INT;
BEGIN
  -- A row with the new index expression would collide if two existing rows
  -- already share (school, lower(last), jersey, opponent_team_id, external).
  -- Today's index ignores external_player_id so it's possible (though
  -- unlikely) for there to be duplicates the old index already permitted.
  SELECT count(*) INTO v_dupes FROM (
    SELECT school_id,
           lower(COALESCE(last_name, '')) AS lname,
           COALESCE(jersey_number, '') AS jersey,
           COALESCE(opponent_team_id::text, '__manual__') AS team_key,
           COALESCE(external_player_id::text, '__manual__') AS ext_key,
           count(*) AS n
      FROM public.opponent_players
     GROUP BY 1, 2, 3, 4, 5
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'opponent_players_identity_index migration would collide on % group(s). Investigate and merge before re-running.',
      v_dupes;
  END IF;
END $$;

DROP INDEX IF EXISTS public.opponent_players_soft_identity_idx;

CREATE UNIQUE INDEX opponent_players_soft_identity_idx
  ON public.opponent_players (
    school_id,
    lower(COALESCE(last_name, '')),
    COALESCE(jersey_number, ''),
    COALESCE(opponent_team_id::text, '__manual__'),
    COALESCE(external_player_id::text, '__manual__')
  );
