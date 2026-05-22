"use client";

// Two-step End-Season flow:
//   Step 1 (Review): load the closing season's roster, propose next-year
//     grades (7th→8th … Junior→Senior, Senior→Graduate). Coach can override
//     any row (repeated year, transfer, mid-year cut).
//   Step 2 (Confirm): summarize the promote/graduate counts and run
//     archive_team_season_with_rollover, which atomically inserts the
//     next-season roster rows AND locks the closing season.
//
// Players whose current grade is unset can't be auto-advanced; the row
// defaults to "Don't roll over" with a warning chip so the coach knows
// they need to either set a grade now or skip the player.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { seasonLabel } from "@/lib/season";
import { NEXT_GRADE, PLAYER_GRADES, type PlayerGrade } from "@/lib/rosterParser";

// Sentinel for "don't carry this player into next year's roster". Stored as a
// distinct string in the row's UI state and converted to null when sent to
// the RPC.
const GRADUATE = "__graduate__" as const;
type NextGradeChoice = PlayerGrade | typeof GRADUATE;

interface RollRow {
  player_id: string;
  first_name: string;
  last_name: string;
  current_grade: PlayerGrade | null;
  next_choice: NextGradeChoice;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  teamName: string;
  seasonYear: number;
  onArchived: () => void;
}

export function EndSeasonDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
  seasonYear,
  onArchived,
}: Props) {
  const [step, setStep] = useState<"review" | "confirm">("review");
  const [rows, setRows] = useState<RollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: qErr } = await supabase
      .from("roster_entries")
      .select("player_id, grade, players(first_name, last_name)")
      .eq("team_id", teamId)
      .eq("season_year", seasonYear);
    setLoading(false);
    if (qErr) {
      setError(`Couldn't load roster: ${qErr.message}`);
      return;
    }
    const next: RollRow[] = ((data ?? []) as unknown as Array<{
      player_id: string;
      grade: PlayerGrade | null;
      players: { first_name: string; last_name: string } | null;
    }>)
      .filter((r) => r.players)
      .map((r) => {
        const advanced = r.grade ? NEXT_GRADE[r.grade] : null;
        return {
          player_id: r.player_id,
          first_name: r.players!.first_name,
          last_name: r.players!.last_name,
          current_grade: r.grade,
          next_choice: advanced ?? GRADUATE,
        };
      })
      .sort((a, b) => a.last_name.localeCompare(b.last_name));
    setRows(next);
  }, [teamId, seasonYear]);

  useEffect(() => {
    if (open) {
      setStep("review");
      void loadRoster();
    }
  }, [open, loadRoster]);

  const counts = useMemo(() => {
    let advancing = 0;
    let graduating = 0;
    let ungradedHeld = 0;
    for (const r of rows) {
      if (r.next_choice === GRADUATE) {
        if (r.current_grade === "Senior") graduating++;
        else ungradedHeld++;
      } else {
        advancing++;
      }
    }
    return { advancing, graduating, ungradedHeld };
  }, [rows]);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const rollover = rows.map((r) => ({
      player_id: r.player_id,
      next_grade: r.next_choice === GRADUATE ? null : r.next_choice,
    }));
    const { error: rpcErr } = await (supabase as any).rpc(
      "archive_team_season_with_rollover",
      {
        p_team_id: teamId,
        p_season_year: seasonYear,
        p_rollover: rollover,
      },
    );
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message ?? "Couldn't archive the season.");
      return;
    }
    onOpenChange(false);
    onArchived();
  };

  const setChoice = (playerId: string, choice: NextGradeChoice) => {
    setRows((prev) =>
      prev.map((r) => (r.player_id === playerId ? { ...r, next_choice: choice } : r)),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {step === "review"
              ? `End the ${seasonLabel(seasonYear)}: roll roster forward`
              : `Confirm: end the ${seasonLabel(seasonYear)}`}
          </DialogTitle>
          <DialogDescription>
            {step === "review" ? (
              <>
                Choose each player&rsquo;s grade for {seasonYear + 1}. Seniors
                default to graduating. Anyone marked &ldquo;Don&rsquo;t roll
                over&rdquo; won&rsquo;t be added to next year&rsquo;s roster.
              </>
            ) : (
              <>
                Archives {seasonYear} for{" "}
                <span className="font-semibold">{teamName}</span>. Roster,
                schedule, scoring, and stats edits for {seasonYear} are locked
                after this. You can keep viewing &mdash; you just can&rsquo;t
                change it.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {step === "review" && (
          <div className="space-y-3">
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" />
                Loading roster…
              </div>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No players on the {seasonYear} roster &mdash; nothing to roll
                forward.
              </p>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Player</th>
                      <th className="text-left px-3 py-2 font-semibold">{seasonYear}</th>
                      <th className="text-left px-3 py-2 font-semibold">{seasonYear + 1}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const ungraded = r.current_grade === null;
                      return (
                        <tr key={r.player_id} className="border-t border-border">
                          <td className="px-3 py-2">
                            <span className="font-medium">{r.last_name}</span>
                            <span className="text-muted-foreground">, {r.first_name}</span>
                          </td>
                          <td className="px-3 py-2">
                            {ungraded ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-sa-orange">
                                <AlertCircle className="w-3 h-3" /> No grade set
                              </span>
                            ) : (
                              <span className="text-foreground">{r.current_grade}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={r.next_choice}
                              onValueChange={(v) => setChoice(r.player_id, v as NextGradeChoice)}
                            >
                              <SelectTrigger className="h-8 w-[180px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PLAYER_GRADES.map((g) => (
                                  <SelectItem key={g} value={g}>
                                    {g}
                                  </SelectItem>
                                ))}
                                <SelectItem value={GRADUATE}>
                                  Don&rsquo;t roll over
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {counts.ungradedHeld > 0 && (
              <p className="text-xs text-sa-orange flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {counts.ungradedHeld} player{counts.ungradedHeld === 1 ? "" : "s"}{" "}
                without a grade &mdash; set one above to advance them, otherwise
                they&rsquo;ll stay off next year&rsquo;s roster.
              </p>
            )}
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-2 py-2 text-sm">
            <p>
              <span className="font-semibold">{counts.advancing}</span>{" "}
              player{counts.advancing === 1 ? "" : "s"} added to{" "}
              {seasonLabel(seasonYear + 1)}.
            </p>
            <p>
              <span className="font-semibold">{counts.graduating}</span>{" "}
              senior{counts.graduating === 1 ? "" : "s"} graduating.
            </p>
            {counts.ungradedHeld > 0 && (
              <p className="text-sa-orange">
                <span className="font-semibold">{counts.ungradedHeld}</span>{" "}
                ungraded player{counts.ungradedHeld === 1 ? "" : "s"} held out of
                next year. Go back if you want to set their grades.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          {step === "review" ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={() => setStep("confirm")}
                disabled={loading || busy}
                className="bg-sa-orange hover:bg-sa-orange/90"
              >
                Next: review &amp; archive
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("review")}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                onClick={() => void handleConfirm()}
                disabled={busy}
                className="bg-sa-orange hover:bg-sa-orange/90"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Archiving…
                  </>
                ) : (
                  `End ${seasonYear} Season`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
