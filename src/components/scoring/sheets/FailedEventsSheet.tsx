"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { listByGame } from "@/lib/outbox/store";
import { discardEntry, drainGame, retryEntry } from "@/lib/outbox/drain";
import { subscribe } from "@/lib/outbox/status";
import type { OutboxRecord } from "@/lib/outbox/types";

interface FailedEventsSheetProps {
  gameId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FailedEventsSheet({ gameId, open, onOpenChange }: FailedEventsSheetProps) {
  const [entries, setEntries] = useState<OutboxRecord[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = async () => {
      const list = await listByGame(gameId).catch(() => []);
      if (active) setEntries(list);
    };
    void refresh();
    // Re-list on any status pub event so retry / discard updates land.
    const unsubscribe = subscribe(gameId, () => {
      void refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [gameId, open]);

  const failed = entries.filter((e) => e.failed);
  const pending = entries.filter((e) => !e.failed);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Sync queue</SheetTitle>
          <SheetDescription>
            Events waiting to reach the server. Failed entries need a retry or
            discard before the queue can drain.
          </SheetDescription>
        </SheetHeader>

        {entries.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-muted-foreground/30 px-4 py-8 text-center text-sm text-muted-foreground">
            Queue is empty. All events have been recorded.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {failed.length > 0 && (
              <Section
                title={`Failed (${failed.length})`}
                tone="danger"
              >
                {failed.map((e) => (
                  <Row
                    key={e.id}
                    entry={e}
                    onRetry={() => void retryEntry(gameId, e.id)}
                    onDiscard={() => void discardEntry(gameId, e.id)}
                  />
                ))}
              </Section>
            )}
            {pending.length > 0 && (
              <Section title={`Waiting (${pending.length})`} tone="muted">
                {pending.map((e) => (
                  <Row key={e.id} entry={e} />
                ))}
              </Section>
            )}
            {failed.length === 0 && pending.length > 0 && (
              <Button
                variant="default"
                size="sm"
                className="w-full"
                onClick={async () => {
                  const r = await drainGame(gameId);
                  if (r.committed > 0) {
                    toast.success(`Synced ${r.committed} event${r.committed === 1 ? "" : "s"}.`);
                  } else if (r.stopped) {
                    toast.message("Sync paused — still offline.");
                  }
                }}
              >
                <RefreshCw className="h-4 w-4 mr-1.5" /> Retry now
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "danger" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "danger"
      ? "text-red-700"
      : "text-muted-foreground";
  return (
    <section>
      <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${cls}`}>
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  entry,
  onRetry,
  onDiscard,
}: {
  entry: OutboxRecord;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const queuedAgo = relativeTime(Date.now() - entry.queued_at);
  const showActions = entry.failed && (onRetry || onDiscard);
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        entry.failed ? "border-red-200 bg-red-50/40" : "border-muted-foreground/20"
      }`}
    >
      <div className="flex items-center gap-2">
        {entry.failed && <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />}
        <span className="font-mono-stat text-xs">{entry.event_type}</span>
        <span className="text-xs text-muted-foreground truncate ml-auto">
          {queuedAgo}
        </span>
      </div>
      {entry.last_error && (
        <p className="mt-1 text-xs text-red-700 line-clamp-2">{entry.last_error}</p>
      )}
      <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">
        {entry.client_event_id} · attempt{entry.attempts === 1 ? "" : "s"} {entry.attempts}
      </p>
      {showActions && (
        <div className="mt-2 flex gap-2">
          {onRetry && (
            <Button size="sm" variant="default" className="h-7 px-2" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
            </Button>
          )}
          {onDiscard && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 border-red-200 text-red-700 hover:bg-red-50"
              onClick={onDiscard}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Discard
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function relativeTime(ms: number): string {
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
