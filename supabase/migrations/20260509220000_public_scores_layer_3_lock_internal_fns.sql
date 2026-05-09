-- Public scores rollout — Step 7 follow-up: lock down internal trigger fns.
--
-- The three trigger / helper functions added in
-- 20260509210000_public_scores_layer_3_detection.sql were created with the
-- default Supabase GRANTs to `anon` and `authenticated`, which surfaced them
-- as `/rest/v1/rpc/...` endpoints (flagged by the Supabase advisor). They
-- are only meant to run from triggers, so revoke EXECUTE. Trigger invocation
-- is unaffected because triggers run as the table owner (service_role keeps
-- EXECUTE through the public default grant).

REVOKE EXECUTE ON FUNCTION public._score_discrepancy_on_games()
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._score_discrepancy_on_link_insert()
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._score_discrepancy_recompute_for_link(UUID, TEXT)
  FROM anon, authenticated;
