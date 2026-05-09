"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { TeamLevel } from "@/integrations/supabase/types";

interface SuggestionRow {
  game_id: string;
  game_date: string;
  game_time: string | null;
  opponent_text: string;
  candidate_school_id: string;
  candidate_school_name: string;
  candidate_school_short_name: string | null;
  candidate_team_id: string;
  candidate_team_name: string;
  candidate_team_level: TeamLevel;
}

interface RelinkSuggestionsBannerProps {
  /** The viewer's team id. */
  teamId: string;
  /** Fired after a successful apply so the parent can refresh. */
  onChange?: () => void;
}

const supabase = createClient();

const LEVEL_LABEL: Record<TeamLevel, string> = {
  varsity: "Varsity",
  jv: "JV",
  freshman: "Freshman",
  middle_school: "Middle School",
};

interface SchoolGroup {
  schoolId: string;
  schoolName: string;
  schoolShortName: string | null;
  teams: Array<{ id: string; name: string; level: TeamLevel }>;
  /** Distinct game ids that match this school. */
  gameIds: string[];
  games: Array<{ id: string; date: string; time: string | null; text: string }>;
}

const groupBySchool = (rows: SuggestionRow[]): SchoolGroup[] => {
  const map = new Map<string, SchoolGroup>();
  for (const r of rows) {
    let g = map.get(r.candidate_school_id);
    if (!g) {
      g = {
        schoolId: r.candidate_school_id,
        schoolName: r.candidate_school_name,
        schoolShortName: r.candidate_school_short_name,
        teams: [],
        gameIds: [],
        games: [],
      };
      map.set(r.candidate_school_id, g);
    }
    if (!g.teams.some((t) => t.id === r.candidate_team_id)) {
      g.teams.push({
        id: r.candidate_team_id,
        name: r.candidate_team_name,
        level: r.candidate_team_level,
      });
    }
    if (!g.gameIds.includes(r.game_id)) {
      g.gameIds.push(r.game_id);
      g.games.push({
        id: r.game_id,
        date: r.game_date,
        time: r.game_time,
        text: r.opponent_text,
      });
    }
  }
  return Array.from(map.values());
};

export function RelinkSuggestionsBanner({ teamId, onChange }: RelinkSuggestionsBannerProps) {
  const [groups, setGroups] = useState<SchoolGroup[] | null>(null);
  const [acting, setActing] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>({});

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("find_relink_suggestions", {
      p_team_id: teamId,
    });
    if (error) {
      toast.error(error.message);
      setGroups([]);
      return;
    }
    const grouped = groupBySchool((data ?? []) as SuggestionRow[]);
    setGroups(grouped);
    setPicked((prev) => {
      const next = { ...prev };
      for (const g of grouped) {
        if (!next[g.schoolId]) {
          // Default to varsity if available, else the first team.
          const v = g.teams.find((t) => t.level === "varsity");
          next[g.schoolId] = v?.id ?? g.teams[0].id;
        }
      }
      return next;
    });
  }, [teamId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visibleGroups = useMemo(
    () => (groups ?? []).filter((g) => !dismissed.has(g.schoolId)),
    [groups, dismissed],
  );

  const apply = async (g: SchoolGroup) => {
    const targetTeamId = picked[g.schoolId];
    if (!targetTeamId) return;
    const skipForGroup = excluded[g.schoolId] ?? new Set<string>();
    const ids = g.gameIds.filter((id) => !skipForGroup.has(id));
    if (ids.length === 0) {
      toast.error("No games selected.");
      return;
    }
    setActing(true);
    try {
      const { error } = await supabase.rpc("apply_relink", {
        p_game_ids: ids,
        p_target_team_id: targetTeamId,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Linked ${ids.length} game${ids.length === 1 ? "" : "s"}`);
      // Clear local exclusion state so any unlinked games that survived this
      // apply (because the user opted them out) come back fully checked on
      // refresh. Don't auto-dismiss the group — refresh will determine
      // visibility based on whether suggestions still exist.
      setExcluded((prev) => {
        const next = { ...prev };
        delete next[g.schoolId];
        return next;
      });
      await refresh();
      onChange?.();
    } finally {
      setActing(false);
    }
  };

  if (groups === null || visibleGroups.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleGroups.map((g) => {
        const skipForGroup = excluded[g.schoolId] ?? new Set<string>();
        const selectedCount = g.gameIds.length - skipForGroup.size;
        const label = g.schoolShortName ?? g.schoolName;
        return (
          <div
            key={g.schoolId}
            className="rounded-md border border-sa-blue/30 bg-sa-blue/5 px-3 py-2.5 text-sm"
          >
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-sa-blue shrink-0 mt-0.5" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  <span className="font-semibold">{label}</span> joined Statly. Link
                  these {g.gameIds.length} game{g.gameIds.length === 1 ? "" : "s"}?
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {g.games.map((gm) => {
                    const skipped = skipForGroup.has(gm.id);
                    return (
                      <li key={gm.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={!skipped}
                          onChange={() => {
                            setExcluded((prev) => {
                              const next = { ...prev };
                              const set = new Set(next[g.schoolId] ?? []);
                              if (skipped) set.delete(gm.id);
                              else set.add(gm.id);
                              next[g.schoolId] = set;
                              return next;
                            });
                          }}
                          className="h-3.5 w-3.5"
                          aria-label={`Include game on ${gm.date}`}
                        />
                        <span className={skipped ? "line-through text-muted-foreground" : ""}>
                          {gm.date}
                          {gm.time ? ` · ${gm.time.slice(0, 5)}` : ""}
                          <span className="text-muted-foreground"> · &quot;{gm.text}&quot;</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setDismissed((prev) => new Set(prev).add(g.schoolId))}
                disabled={acting}
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" aria-hidden />
              </Button>
            </div>
            <div className="flex items-center gap-2 mt-2 ml-6">
              <Select
                value={picked[g.schoolId]}
                onValueChange={(v) => setPicked((prev) => ({ ...prev, [g.schoolId]: v }))}
              >
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue placeholder="Pick team" />
                </SelectTrigger>
                <SelectContent>
                  {g.teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {LEVEL_LABEL[t.level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8"
                onClick={() => apply(g)}
                disabled={acting || selectedCount === 0 || !picked[g.schoolId]}
              >
                Link {selectedCount} game{selectedCount === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
