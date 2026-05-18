"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOutboxStatus } from "@/hooks/useOutboxStatus";
import { FailedEventsSheet } from "./sheets/FailedEventsSheet";

interface OfflinePillProps {
  gameId: string;
}

/** Compact connectivity / outbox indicator. Lives in the right-cluster of
 *  GameStatusBar. Tap when there are queued or failed entries to open the
 *  reconciliation sheet. */
export function OfflinePill({ gameId }: OfflinePillProps) {
  const status = useOutboxStatus(gameId);
  const [open, setOpen] = useState(false);
  if (!status) return null;

  const { online, draining, pending, failed } = status;
  const hasAnyQueued = pending > 0 || failed > 0;

  // Color + icon priority: failed > offline > pending > online.
  let label: string;
  let icon: React.ReactNode;
  let color: string;
  let aria: string;

  if (failed > 0) {
    label = `${failed} need attention`;
    icon = <AlertTriangle className="h-4 w-4" />;
    color = "text-red-700 bg-red-50 border-red-200 hover:bg-red-100";
    aria = `${failed} failed event${failed === 1 ? "" : "s"} need attention`;
  } else if (!online) {
    label = pending > 0 ? `Offline · ${pending} queued` : "Offline";
    icon = <CloudOff className="h-4 w-4" />;
    color = "text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100";
    aria = pending > 0 ? `Offline, ${pending} event${pending === 1 ? "" : "s"} queued` : "Offline";
  } else if (draining || pending > 0) {
    label = `Syncing ${pending}`;
    icon = <RefreshCw className="h-4 w-4 animate-spin" />;
    color = "text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100";
    aria = `Syncing ${pending} queued event${pending === 1 ? "" : "s"}`;
  } else {
    label = "Live";
    icon = <CheckCircle2 className="h-4 w-4" />;
    color = "text-emerald-700 bg-emerald-50 border-emerald-200";
    aria = "Live, all events synced";
  }

  const interactive = hasAnyQueued;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!interactive}
        onClick={interactive ? () => setOpen(true) : undefined}
        aria-label={aria}
        className={`shrink-0 h-8 px-2 gap-1.5 font-medium border ${color} disabled:opacity-100 disabled:cursor-default`}
      >
        {icon}
        <span className="text-xs whitespace-nowrap">{label}</span>
      </Button>
      <FailedEventsSheet
        gameId={gameId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
