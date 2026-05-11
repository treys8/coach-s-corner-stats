"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link2, Link2Off, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { GameStatus } from "@/integrations/supabase/types";
import { formatGameTime } from "@/lib/date-display";

type LinkRow = {
  id: string;
  home_game_id: string;
  visitor_game_id: string;
};

type Candidate = {
  candidate_game_id: string;
  game_date: string;
  game_time: string | null;
  game_sequence: number;
  status: GameStatus;
  is_home: boolean;
};

interface GameLinkBannerProps {
  /** This account's game id. */
  gameId: string;
  /** The FK opponent team id on this game; if null the banner renders nothing. */
  opponentTeamId: string | null;
  /** Whether this account's record is the home team's record. Drives which slot
   * we pass to confirm_game_link. */
  isHome: boolean;
  /** Display label for the linked state ("Linked with {opponentLabel}"). The
   * games table already stores this as `opponent` text — reuse it to avoid an
   * extra round trip. */
  opponentLabel: string;
  /** Optional: parent refresh hook fired after a confirm or unlink. */
  onChange?: () => void;
}

const supabase = createClient();

const fmtTime = (t: string | null): string =>
  t ? formatGameTime(t) : "no time set";

const statusBadge = (s: GameStatus) =>
  s === "final" ? "Final" : s === "in_progress" ? "Live" : "Draft";

export function GameLinkBanner({
  gameId,
  opponentTeamId,
  isHome,
  opponentLabel,
  onChange,
}: GameLinkBannerProps) {
  const [link, setLink] = useState<LinkRow | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const linkResp = await supabase
        .from("game_links")
        .select("id, home_game_id, visitor_game_id")
        .or(`home_game_id.eq.${gameId},visitor_game_id.eq.${gameId}`)
        .maybeSingle();
      if (linkResp.error) throw linkResp.error;
      const existing = linkResp.data as LinkRow | null;
      setLink(existing);

      if (!existing && opponentTeamId) {
        const candResp = await supabase.rpc("game_match_candidates", {
          p_my_game_id: gameId,
        });
        if (candResp.error) throw candResp.error;
        setCandidates((candResp.data ?? []) as Candidate[]);
      } else {
        setCandidates([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load link state";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [gameId, opponentTeamId]);

  useEffect(() => {
    if (!opponentTeamId) {
      setLoading(false);
      return;
    }
    refresh();
  }, [opponentTeamId, refresh]);

  const confirm = async (candidate: Candidate) => {
    setActing(true);
    try {
      const home = isHome ? gameId : candidate.candidate_game_id;
      const visitor = isHome ? candidate.candidate_game_id : gameId;
      const { error } = await supabase.rpc("confirm_game_link", {
        p_home_game_id: home,
        p_visitor_game_id: visitor,
      });
      if (error) {
        if (error.message.includes("home/visitor designation conflict")) {
          toast.error(
            "Both schools have this marked as the home team. One side needs to correct this before linking.",
          );
        } else if (error.message.includes("games do not match")) {
          toast.error(
            "The opposing record names a different opponent or date. They may have picked the wrong team.",
          );
        } else {
          toast.error(error.message);
        }
        return;
      }
      toast.success(`Linked with ${opponentLabel}`);
      await refresh();
      onChange?.();
    } finally {
      setActing(false);
    }
  };

  const unlink = async () => {
    if (!link) return;
    setActing(true);
    try {
      const { error } = await supabase.rpc("unlink_games", { p_link_id: link.id });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Link removed");
      await refresh();
      onChange?.();
    } finally {
      setActing(false);
    }
  };

  const visibleCandidates = useMemo(
    () => candidates.filter((c) => !dismissed.has(c.candidate_game_id)),
    [candidates, dismissed],
  );

  if (!opponentTeamId) return null;
  if (loading) return null;

  if (link) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <Link2 className="w-4 h-4 text-sa-blue shrink-0" aria-hidden />
        <span className="truncate">
          Linked with <span className="font-medium">{opponentLabel}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7"
          onClick={unlink}
          disabled={acting}
        >
          <Link2Off className="w-3.5 h-3.5 mr-1" aria-hidden />
          Unlink
        </Button>
      </div>
    );
  }

  if (visibleCandidates.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        <Clock className="w-4 h-4 shrink-0" aria-hidden />
        <span className="truncate">
          You&apos;ve identified <span className="font-medium">{opponentLabel}</span>. Waiting
          for their coach to enter this game.
        </span>
      </div>
    );
  }

  if (visibleCandidates.length === 1) {
    const c = visibleCandidates[0];
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-sa-blue/40 bg-sa-blue/5 px-3 py-2 text-sm">
        <AlertCircle className="w-4 h-4 text-sa-blue shrink-0" aria-hidden />
        <span className="flex-1 min-w-[12rem]">
          <span className="font-medium">{opponentLabel}</span> has a game on{" "}
          {c.game_date} ({fmtTime(c.game_time)}
          {c.game_sequence > 1 ? `, game ${c.game_sequence}` : ""}).{" "}
          <span className="text-muted-foreground">Same game?</span>
        </span>
        <div className="flex gap-1.5 ml-auto">
          <Button size="sm" className="h-7" onClick={() => confirm(c)} disabled={acting}>
            Yes
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() =>
              setDismissed((prev) => new Set(prev).add(c.candidate_game_id))
            }
            disabled={acting}
          >
            No
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-sa-blue/40 bg-sa-blue/5 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="w-4 h-4 text-sa-blue shrink-0" aria-hidden />
        <span>
          <span className="font-medium">{opponentLabel}</span> has{" "}
          {visibleCandidates.length} games this date. Pick the one that matches:
        </span>
      </div>
      <ul className="space-y-1.5">
        {visibleCandidates.map((c) => (
          <li
            key={c.candidate_game_id}
            className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5"
          >
            <span className="text-sm">
              {fmtTime(c.game_time)}
              {c.game_sequence > 1 ? ` · game ${c.game_sequence}` : ""}
            </span>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
              {statusBadge(c.status)}
            </Badge>
            <Button
              size="sm"
              className="ml-auto h-7"
              onClick={() => confirm(c)}
              disabled={acting}
            >
              Link
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
