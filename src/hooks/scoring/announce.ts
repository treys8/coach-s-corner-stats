"use client";

import { toast } from "sonner";
import type { PostResult } from "@/lib/scoring/events-client";

// Server-derived auto-end-half: when a tap brings outs to 3, the server
// emits an inning_end inside the same POST chain. Toast iff one fired.
export function announceAutoEndHalf(result: PostResult): void {
  const ie = result.events.find((e) => e.event_type === "inning_end");
  if (!ie || !result.state) return;
  const payload = ie.payload as { inning?: number; half?: "top" | "bottom" };
  const inning = payload.inning ?? result.state.inning;
  const half = payload.half ?? result.state.half;
  const halfLabel = half === "top" ? "Top" : "Bot";
  toast.success(`End ${halfLabel} ${inning}. Tap Undo to revert.`);
}
