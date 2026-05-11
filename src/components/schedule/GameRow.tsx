"use client";

import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Trash2, MapPin, Calendar, CheckCircle2, Globe, Pencil } from "lucide-react";
import { useSchool } from "@/lib/contexts/school";
import { formatDatePart, formatGameTime, localToday } from "@/lib/date-display";
import type { Game } from "./types";

const supabase = createClient();

interface Props {
  game: Game;
  closed: boolean;
  onEdit: (g: Game) => void;
  onChange: () => void;
}

export function GameRow({ game: g, closed, onEdit, onChange }: Props) {
  const { school } = useSchool();
  const today = localToday(school.timezone);
  const isPast = g.game_date < today;
  const resultColor =
    g.result === "W" ? "bg-sa-blue text-white"
    : g.result === "L" ? "bg-sa-orange text-white"
    : "bg-sa-grey text-white";

  const remove = async () => {
    if (!confirm("Delete this game?")) return;
    const { error } = await supabase.from("games").delete().eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Game removed");
    onChange();
  };

  const setFinal = async (isFinal: boolean) => {
    if (isFinal) {
      if (g.team_score === null || g.opponent_score === null || !g.result) {
        toast.error("Add the score and result before marking final.");
        return;
      }
      if (!confirm("Mark this game final? It'll appear on the public Scores page.")) return;
    }
    // Write `status` — the games_sync_status_is_final trigger derives is_final
    // and stamps finalized_at. Writing is_final directly leaves status='draft',
    // which keeps the game off /scores even though the user marked it final.
    const { error } = await supabase
      .from("games")
      .update(
        isFinal
          ? { status: "final" as const }
          : { status: "draft" as const, finalized_at: null },
      )
      .eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isFinal ? "Game finalized" : "Game un-finalized");
    onChange();
  };

  return (
    <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg shadow-card group">
      <div className="text-center w-16 flex-shrink-0 border-r pr-4">
        <p className="font-display text-2xl text-sa-blue-deep leading-none">{formatDatePart(g.game_date, "day", school.timezone)}</p>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{formatDatePart(g.game_date, "month-short", school.timezone)}</p>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase font-bold tracking-wider text-sa-orange">{g.location === "home" ? "vs" : g.location === "away" ? "@" : "neutral"}</span>
          <h3 className="font-display text-xl text-sa-blue-deep truncate">{g.opponent}</h3>
          {isPast && g.result && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${resultColor}`}>
              {g.result} {g.team_score ?? "-"}-{g.opponent_score ?? "-"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          {g.game_time && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatGameTime(g.game_time)}</span>}
          <span className="flex items-center gap-1 capitalize"><MapPin className="w-3 h-3" />{g.location}</span>
          {g.is_final && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sa-blue">
              <Globe className="w-3 h-3" /> On public Scores
            </span>
          )}
        </div>
        {g.notes && <p className="text-xs text-muted-foreground mt-1 italic truncate">{g.notes}</p>}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isPast && g.result && g.team_score !== null && g.opponent_score !== null && (
          g.is_final ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-sa-blue hover:text-sa-blue-deep"
              onClick={() => setFinal(false)}
              title="Remove from public Scores"
            >
              Un-finalize
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-sa-blue hover:text-sa-blue-deep"
              onClick={() => setFinal(true)}
              title="Publish to public Scores page"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Final
            </Button>
          )
        )}
        <Button variant="ghost" size="icon" onClick={() => onEdit(g)} disabled={closed} title="Edit game">
          <Pencil className="w-4 h-4 text-sa-blue" />
        </Button>
        <Button variant="ghost" size="icon" onClick={remove}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
