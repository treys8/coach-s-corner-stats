"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

// Coalesce a burst of taps on the scoring tablet into one server refetch.
// /scores is force-dynamic so the refresh re-renders with fresh tiles; the
// debounce keeps a fast-moving inning from re-fetching every pitch.
const REFRESH_DEBOUNCE_MS = 2000;

/**
 * Spectator auto-refresh for `/scores`. Subscribes to `game_live_state` and
 * `games` via the Supabase Realtime publication and triggers a debounced
 * `router.refresh()` when something changes — score, inning, heartbeat, or
 * a status transition (in_progress → final). Public-read RLS on both tables
 * already covers what the page displays.
 */
export function ScoresAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timeout) return;
      timeout = setTimeout(() => {
        timeout = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };
    const channel = supabase
      .channel("public-scores-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_live_state" },
        trigger,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games" },
        trigger,
      )
      .subscribe();
    return () => {
      if (timeout) clearTimeout(timeout);
      void supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}
