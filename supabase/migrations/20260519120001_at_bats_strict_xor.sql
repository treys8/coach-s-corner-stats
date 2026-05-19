-- Tighten at_bats.batter_xor_opponent to require exactly one non-null batter.
--
-- The original constraint (20260512120000_opponent_players.sql:117-119) was
-- written as `<= 1` to accommodate legacy opponent PAs predating
-- opponent_batter_id. Those rows had both columns NULL, which makes the
-- record semantically meaningless: a PA with no batter at all. The replay
-- engine never produces this, but nothing at the DB layer enforces it.
--
-- Pre-flight: if any rows would violate the strict form, raise with a
-- clear count so the SQL Editor paste fails loudly. The user can backfill
-- the offenders (or hard-delete legacy junk) before re-running.

DO $$
DECLARE
  v_offenders INT;
BEGIN
  SELECT count(*) INTO v_offenders
    FROM public.at_bats
   WHERE batter_id IS NULL AND opponent_batter_id IS NULL;

  IF v_offenders > 0 THEN
    RAISE EXCEPTION
      'at_bats_batter_xor_opponent_chk strict migration would orphan % row(s) with both batter_id and opponent_batter_id NULL. Investigate and backfill before re-running.',
      v_offenders;
  END IF;
END $$;

ALTER TABLE public.at_bats DROP CONSTRAINT at_bats_batter_xor_opponent_chk;

ALTER TABLE public.at_bats
  ADD CONSTRAINT at_bats_batter_xor_opponent_chk
  CHECK ((batter_id IS NOT NULL)::int + (opponent_batter_id IS NOT NULL)::int = 1);
