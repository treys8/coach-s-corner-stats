-- Make player identity case-insensitive within a school. The previous
-- UNIQUE (school_id, first_name, last_name) treated "Smith" and "smith" as
-- distinct, which let coaches accidentally create duplicate player records by
-- changing the casing in a roster file. We replace it with a functional unique
-- index on lower(first_name) / lower(last_name).
--
-- Before swapping the constraint we merge any existing duplicates: pick the
-- oldest row in each (school_id, lower(first), lower(last)) group as the
-- canonical id, repoint every FK that references the loser ids, then delete
-- the losers. Two of those FKs sit inside their own unique constraints
-- (roster_entries on (team_id, season_year, player_id); stat_snapshots on
-- (team_id, player_id, upload_date, game_id)), so we pre-delete losing rows
-- whose UPDATE would otherwise collide.

DO $$
DECLARE dup RECORD;
BEGIN
  FOR dup IN
    WITH ranked AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY school_id, lower(first_name), lower(last_name)
          ORDER BY created_at, id
        ) AS rn,
        first_value(id) OVER (
          PARTITION BY school_id, lower(first_name), lower(last_name)
          ORDER BY created_at, id
        ) AS keep_id
      FROM public.players
    )
    SELECT id AS dup_id, keep_id FROM ranked WHERE rn > 1
  LOOP
    -- roster_entries collisions: a (team_id, season_year, dup_id) row would
    -- collide with an existing (team_id, season_year, keep_id) row on UPDATE.
    DELETE FROM public.roster_entries re
     WHERE re.player_id = dup.dup_id
       AND EXISTS (
         SELECT 1 FROM public.roster_entries kre
          WHERE kre.player_id   = dup.keep_id
            AND kre.team_id     = re.team_id
            AND kre.season_year = re.season_year
       );

    -- stat_snapshots collisions on (team_id, player_id, upload_date, game_id).
    DELETE FROM public.stat_snapshots ss
     WHERE ss.player_id = dup.dup_id
       AND EXISTS (
         SELECT 1 FROM public.stat_snapshots kss
          WHERE kss.player_id   = dup.keep_id
            AND kss.team_id     = ss.team_id
            AND kss.upload_date = ss.upload_date
            AND kss.game_id IS NOT DISTINCT FROM ss.game_id
       );

    UPDATE public.roster_entries  SET player_id     = dup.keep_id WHERE player_id     = dup.dup_id;
    UPDATE public.stat_snapshots  SET player_id     = dup.keep_id WHERE player_id     = dup.dup_id;
    UPDATE public.at_bats         SET batter_id     = dup.keep_id WHERE batter_id     = dup.dup_id;
    UPDATE public.at_bats         SET pitcher_id    = dup.keep_id WHERE pitcher_id    = dup.dup_id;
    UPDATE public.game_live_state SET runner_first  = dup.keep_id WHERE runner_first  = dup.dup_id;
    UPDATE public.game_live_state SET runner_second = dup.keep_id WHERE runner_second = dup.dup_id;
    UPDATE public.game_live_state SET runner_third  = dup.keep_id WHERE runner_third  = dup.dup_id;

    DELETE FROM public.players WHERE id = dup.dup_id;
  END LOOP;
END $$;

ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_school_id_first_name_last_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS players_school_lower_name_uniq
  ON public.players (school_id, lower(first_name), lower(last_name));
