"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const REFRESH_DEBOUNCE_MS = 2000;

interface ScoresAutoRefreshProps {
  /** IDs of games currently rendered on the page. Used to filter the high-
   *  volume game_live_state stream — a pitch in a game that isn't on screen
   *  shouldn't force every spectator to refetch the 200-row tile list.
   *  `games` UPDATE events are NOT filtered: a draft → in_progress
   *  transition is exactly how a new tile appears, and that game won't be
   *  in visibleGameIds yet. */
  visibleGameIds: string[];
}

/**
 * Spectator auto-refresh for `/scores`. Subscribes to `game_live_state` and
 * `games` via the Supabase Realtime publication and triggers a debounced
 * `router.refresh()` when something relevant changes — score, inning,
 * heartbeat, or a status transition (in_progress → final). Public-read RLS
 * on both tables already covers what the page displays; the visible-set
 * filter is a client-side perf gate, not a security boundary.
 */
export function ScoresAutoRefresh({ visibleGameIds }: ScoresAutoRefreshProps) {
  const router = useRouter();
  const visibleSet = useMemo(() => new Set(visibleGameIds), [visibleGameIds]);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
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
        (payload) => {
          // High-volume stream (per-pitch updates). Drop events for games
          // not currently on screen.
          const row = (payload.new ?? payload.old) as { game_id?: string } | null;
          if (row?.game_id && !visibleSet.has(row.game_id)) return;
          scheduleRefresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games" },
        // Low-volume stream (status transitions, finalize). Never filter —
        // a draft → in_progress transition needs to make the new tile
        // appear even though the game isn't in visibleGameIds yet.
        scheduleRefresh,
      )
      .subscribe();
    return () => {
      if (timeout) clearTimeout(timeout);
      void supabase.removeChannel(channel);
    };
  }, [router, visibleSet]);
  return null;
}
