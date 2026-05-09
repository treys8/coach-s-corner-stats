"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Edit3 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

interface DiscrepancyRow {
  id: string;
  game_link_id: string;
  home_acct_home_score: number | null;
  home_acct_visitor_score: number | null;
  vis_acct_home_score: number | null;
  vis_acct_visitor_score: number | null;
  home_self_confirmed: boolean;
  visitor_self_confirmed: boolean;
}

interface LinkRow {
  id: string;
  home_game_id: string;
  visitor_game_id: string;
}

interface GameDiscrepancyBannerProps {
  /** This account's game id. */
  gameId: string;
  /** Display label for the opposing school (e.g. game.opponent). */
  opponentLabel: string;
  /** Optional href for the "Update my score" action; hidden if omitted. */
  gameEditHref?: string;
  /** Fired after a successful confirm so the parent can refresh state. */
  onChange?: () => void;
}

const supabase = createClient();

const formatScore = (h: number | null, v: number | null): string =>
  h == null || v == null ? "—" : `${v} – ${h}`;

export function GameDiscrepancyBanner({
  gameId,
  opponentLabel,
  gameEditHref,
  onChange,
}: GameDiscrepancyBannerProps) {
  const [link, setLink] = useState<LinkRow | null>(null);
  const [disc, setDisc] = useState<DiscrepancyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const linkResp = await supabase
        .from("game_links")
        .select("id, home_game_id, visitor_game_id")
        .or(`home_game_id.eq.${gameId},visitor_game_id.eq.${gameId}`)
        .maybeSingle();
      if (linkResp.error) throw linkResp.error;
      const l = linkResp.data as LinkRow | null;
      setLink(l);

      if (!l) {
        setDisc(null);
        return;
      }
      const discResp = await supabase
        .from("score_discrepancies")
        .select(
          "id, game_link_id, home_acct_home_score, home_acct_visitor_score, vis_acct_home_score, vis_acct_visitor_score, home_self_confirmed, visitor_self_confirmed",
        )
        .eq("game_link_id", l.id)
        .is("resolved_at", null)
        .maybeSingle();
      if (discResp.error) throw discResp.error;
      setDisc(discResp.data as DiscrepancyRow | null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load dispute state";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const confirmMyScore = async () => {
    if (!link) return;
    setActing(true);
    try {
      const { error } = await supabase.rpc("confirm_my_score", { p_link_id: link.id });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Marked your score correct");
      await refresh();
      onChange?.();
    } finally {
      setActing(false);
    }
  };

  if (loading || !link || !disc) return null;

  const iAmHome = link.home_game_id === gameId;
  const myScores = iAmHome
    ? { home: disc.home_acct_home_score, visitor: disc.home_acct_visitor_score }
    : { home: disc.vis_acct_home_score, visitor: disc.vis_acct_visitor_score };
  const theirScores = iAmHome
    ? { home: disc.vis_acct_home_score, visitor: disc.vis_acct_visitor_score }
    : { home: disc.home_acct_home_score, visitor: disc.home_acct_visitor_score };
  const iSelfConfirmed = iAmHome ? disc.home_self_confirmed : disc.visitor_self_confirmed;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="font-medium">
            Score mismatch with{" "}
            <span className="font-semibold">{opponentLabel}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            You have {formatScore(myScores.home, myScores.visitor)} ·{" "}
            {opponentLabel} has {formatScore(theirScores.home, theirScores.visitor)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2 ml-6">
        {gameEditHref && (
          <Button asChild size="sm" variant="outline" className="h-7" disabled={acting}>
            <Link href={gameEditHref}>
              <Edit3 className="w-3.5 h-3.5 mr-1" aria-hidden />
              Update my score
            </Link>
          </Button>
        )}
        <Button
          size="sm"
          variant={iSelfConfirmed ? "secondary" : "default"}
          className="h-7"
          onClick={confirmMyScore}
          disabled={acting || iSelfConfirmed}
        >
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" aria-hidden />
          {iSelfConfirmed ? "Confirmed" : "My score is correct"}
        </Button>
      </div>
    </div>
  );
}
