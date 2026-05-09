-- Resolve two pre-existing security advisor warnings.
--
-- 1. public.glossary was created in 20260501193235 as a stat-abbreviation
--    dictionary, but the app reads from src/lib/glossary.ts (a hardcoded JS
--    constant) instead. The DB table has been empty and unreferenced since
--    the multi-tenant rewrite. RLS was enabled but no policies existed,
--    triggering the rls_enabled_no_policy lint. Drop it.
--
-- 2. games_sync_status_is_final() is a trivial trigger that maintains
--    is_final / finalized_at on games, but it was created without a fixed
--    search_path, triggering function_search_path_mutable. Pin it.

DROP TABLE IF EXISTS public.glossary;

ALTER FUNCTION public.games_sync_status_is_final()
  SET search_path = pg_catalog, public;
