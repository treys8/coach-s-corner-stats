import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/integrations/supabase/types";

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

// Browser client. Memoized so callers that invoke `createClient()` at module
// scope across many files (currently ~25 of them) all share one instance,
// avoiding the lightweight churn of recreating GoTrue listeners during HMR.
// Server code should not call this — use `@/lib/supabase/server` instead.
export function createClient() {
  if (cached) return cached;
  cached = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
