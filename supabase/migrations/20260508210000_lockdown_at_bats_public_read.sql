-- Lockdown: drop the additive public-read policy on at_bats.
--
-- The team-member SELECT policy stays (in-app surfaces still work for
-- team members + school admins). The public-read-finalized policy was
-- added in 20260508120000_tablet_phase_1_schema.sql for future public
-- box-score support; that's never been surfaced and the only public
-- page (/scores) does not query at_bats. Dropping the policy keeps
-- at-bat-level data private to the team, matching the invariant that
-- /scores is the only public page.
--
-- Schools, teams, games, and game_live_state retain their public
-- SELECT policies — those are the rows /scores actually renders.

DROP POLICY IF EXISTS "at_bats public read finalized" ON public.at_bats;
