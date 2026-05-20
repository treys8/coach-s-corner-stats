"use client";

// Confirm dialog for the manual season-archive flow. Calls the
// archive_team_season RPC and, on success, runs the caller's onArchived
// callback so the surrounding page can refetch its lock set and re-render.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";
import { seasonLabel } from "@/lib/season";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabase as any).rpc("archive_team_season", {
      p_team_id: teamId,
      p_season_year: seasonYear,
    });
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message ?? "Couldn't archive the season.");
      return;
    }
    onOpenChange(false);
    onArchived();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End the {seasonLabel(seasonYear)}?</AlertDialogTitle>
          <AlertDialogDescription>
            This archives the {seasonYear} season for{" "}
            <span className="font-semibold">{teamName}</span>. After archiving,
            roster, schedule, scoring, and stats edits for {seasonYear} are
            locked. You can keep viewing the data — you just can't change it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
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
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
