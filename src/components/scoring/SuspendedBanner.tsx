"use client";

import { Card } from "@/components/ui/card";
import type { ReplayState } from "@/lib/scoring/types";

interface Props {
  state: ReplayState;
}

/** Stage 6a passive banner shown when status === 'suspended'. Mirrors the
 *  always-visible pattern used by MoundVisitCounter and IFRBanner. No action
 *  button — any subsequent play-resolving event resumes the game. */
export function SuspendedBanner({ state }: Props) {
  if (state.status !== "suspended") return null;
  return (
    <Card className="border-amber-400 bg-amber-50 p-3" role="status" aria-live="polite">
      <div className="text-xs uppercase tracking-wider font-display text-amber-700">
        Game suspended
      </div>
      <p className="mt-1 text-sm text-amber-900">
        Game is paused. Any new pitch, play, or runner movement will resume it
        automatically.
      </p>
    </Card>
  );
}
