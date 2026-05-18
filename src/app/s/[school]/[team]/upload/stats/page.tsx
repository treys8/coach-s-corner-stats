"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Upload as UploadIcon, FileText, CheckCircle2, AlertCircle, Check } from "lucide-react";
import { toast } from "sonner";
import { parseStatsWorkbook, type ParsedPlayer, type StatsCategory } from "@/lib/csvParser";
import { matchAgainstRoster, type MatchResult, type RosterPlayer } from "@/lib/players/matchRoster";
import type { Json } from "@/integrations/supabase/types";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";

const CATEGORY_LABEL: Record<StatsCategory, string> = {
  batting: "Hitting",
  pitching: "Pitching",
  fielding: "Fielding",
};

const supabase = createClient();

const OVERWRITE_PREFIX = "STATS_OVERWRITE_REQUIRED:";

// Format YYYY-MM-DD as M/D/YYYY without going through `new Date(...)`, which
// parses the string as UTC midnight and shifts a day in negative-offset zones.
const formatPickerDate = (yyyyMmDd: string): string => {
  const [y, m, d] = yyyyMmDd.split("-");
  if (!y || !m || !d) return yyyyMmDd;
  return `${Number(m)}/${Number(d)}/${y}`;
};

const friendlyError = (msg: string): string => {
  const m = msg.match(/^season (\d+) is closed$/);
  if (m) return `The ${m[1]} season is closed (ended May 31). Pick a date inside an open season window (Feb 1 – May 31).`;
  return msg;
};

interface PendingOverwrite {
  players: ParsedPlayer[];
  filename: string;
  uploadDate: string;
  existingCount: number;
}

interface PendingCategory {
  sheetName: string;
}

// One row in the name-review dialog. `classification` and `originalFirst`/
// `originalLast` are the immutable display state captured at parse time.
// When the coach accepts a "similar" suggestion, we mutate `player.first`/
// `player.last` to the existing player's exact-cased names so the server's
// normalize_player_name() ON CONFLICT path will hit that row, and flip
// `acceptedSuggestion` so the row renders as resolved (and can be undone
// back to the originals).
interface ReviewItem {
  player: ParsedPlayer;
  classification: MatchResult;
  originalFirst: string;
  originalLast: string;
  acceptedSuggestion: boolean;
}

interface PendingReview {
  items: ReviewItem[];
  filename: string;
  uploadDate: string;
}

export default function UploadStatsPage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const [file, setFile] = useState<File | null>(null);
  const [uploadDate, setUploadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwrite | null>(null);
  const [pendingCategory, setPendingCategory] = useState<PendingCategory | null>(null);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [overrideChoice, setOverrideChoice] = useState<StatsCategory>("batting");
  const fileRef = useRef<HTMLInputElement>(null);
  // Mirrors `busy` for synchronous reads from Radix's onOpenChange, which fires
  // before React re-renders with the latest state.
  const busyRef = useRef(false);
  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  const ingestOnce = async (params: {
    players: ParsedPlayer[];
    filename: string;
    uploadDate: string;
    replace: boolean;
  }): Promise<number> => {
    const payload = params.players.map((p) => ({ first: p.first, last: p.last, stats: p.stats }));
    const { data, error } = await supabase.rpc("ingest_stats_workbook", {
      p_school: school.id,
      p_team: team.id,
      p_upload_date: params.uploadDate,
      p_filename: params.filename,
      p_players: payload as unknown as Json,
      p_replace: params.replace,
    });
    if (error) throw error;
    const rows = data ?? [];
    return rows[0]?.snapshot_count ?? params.players.length;
  };

  const finishSuccess = (count: number, date: string) => {
    setResult({ ok: true, msg: `Imported ${count} players for ${formatPickerDate(date)}.` });
    toast.success("Stats uploaded");
    setFile(null);
    setPendingOverwrite(null);
    setPendingCategory(null);
    setPendingReview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Run the actual RPC. If the server reports an existing snapshot for the
  // date, raise the overwrite dialog. Takes snapshotDate explicitly so callers
  // can pass the date that was current when the review was generated, not
  // whatever the picker shows now (the user might have nudged it while the
  // review dialog was open).
  const proceedToIngest = async (players: ParsedPlayer[], filename: string, snapshotDate: string) => {
    try {
      const count = await ingestOnce({ players, filename, uploadDate: snapshotDate, replace: false });
      finishSuccess(count, snapshotDate);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith(OVERWRITE_PREFIX)) {
        const existingCount = parseInt(msg.slice(OVERWRITE_PREFIX.length), 10) || 0;
        setPendingOverwrite({ players, filename, uploadDate: snapshotDate, existingCount });
        return;
      }
      throw e;
    }
  };

  // Shared parse-then-classify core. Called from the initial submit and from
  // the category-picker confirm (which re-parses with an override). On success
  // either opens the name-review dialog or, when there's no roster to compare
  // against and nothing to review, proceeds straight to ingest.
  const runIngest = async (currentFile: File, categoryOverride?: StatsCategory) => {
    const buf = await currentFile.arrayBuffer();
    const parsed = parseStatsWorkbook(buf, { categoryOverride });

    if (parsed.needsCategoryOverride) {
      setPendingCategory({
        sheetName: parsed.unrecognizedSheetName ?? "Sheet1",
      });
      return;
    }

    if (parsed.players.length === 0) throw new Error("No players found in file");

    if (parsed.unknownHeaders.length > 0) {
      toast.warning(
        `Unrecognized stat columns ingested: ${parsed.unknownHeaders.slice(0, 6).join(", ")}${parsed.unknownHeaders.length > 6 ? "…" : ""}. Update the glossary if these are real stats.`,
        { duration: 8000 },
      );
    }

    if (parsed.missingCategories.length > 0) {
      const present = parsed.presentCategories.map((c) => CATEGORY_LABEL[c]).join(" + ");
      toast.info(`Partial upload: ${present} only.`, { duration: 6000 });
    }

    // Fetch the school's current roster so we can flag possible-typo names
    // before they fork existing players. Players are school-scoped, so this
    // matches the unique-index scope of normalize_player_name().
    const { data: rosterRows, error: rosterErr } = await supabase
      .from("players")
      .select("id, first_name, last_name")
      .eq("school_id", school.id);
    if (rosterErr) throw rosterErr;
    const roster: RosterPlayer[] = (rosterRows ?? []) as RosterPlayer[];

    // First-upload-for-the-school path: every parsed name is "new", review
    // would just be friction. Per the plan, skip straight to ingest.
    if (roster.length === 0) {
      await proceedToIngest(parsed.players, currentFile.name, uploadDate);
      return;
    }

    const items: ReviewItem[] = parsed.players.map((p) => ({
      player: { ...p },
      classification: matchAgainstRoster({ first: p.first, last: p.last }, roster),
      originalFirst: p.first,
      originalLast: p.last,
      acceptedSuggestion: false,
    }));

    // If there are no "similar" rows AND no "new" rows, every name matched
    // existing roster exactly — no decisions to make, skip the dialog.
    const hasDecision = items.some((it) => it.classification.kind !== "existing");
    if (!hasDecision) {
      await proceedToIngest(parsed.players, currentFile.name, uploadDate);
      return;
    }

    setPendingReview({ items, filename: currentFile.name, uploadDate });
  };

  const handleSubmit = async () => {
    if (!file) {
      toast.error("Choose a file");
      return;
    }
    if (!uploadDate) {
      toast.error("Pick an upload date");
      return;
    }
    setBusyBoth(true);
    setResult(null);
    try {
      await runIngest(file);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Upload failed";
      const msg = friendlyError(raw);
      setResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setBusyBoth(false);
    }
  };

  const handleConfirmCategory = async () => {
    if (!pendingCategory || !file) return;
    setBusyBoth(true);
    setResult(null);
    setPendingCategory(null);
    try {
      await runIngest(file, overrideChoice);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Upload failed";
      const msg = friendlyError(raw);
      setResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setBusyBoth(false);
    }
  };

  // Accept the suggested existing-roster match for a single review row. We
  // rewrite the parsed first/last to the roster's exact-cased values; the RPC
  // then matches that row to the existing player via normalize_player_name()
  // and merges stats onto the existing snapshot lineage instead of forking.
  const handleAcceptSuggestion = (idx: number) => {
    setPendingReview((prev) => {
      if (!prev) return prev;
      const item = prev.items[idx];
      if (item.classification.kind !== "similar") return prev;
      const suggestion = item.classification.suggestion;
      const nextItems = prev.items.slice();
      nextItems[idx] = {
        ...item,
        player: { ...item.player, first: suggestion.first_name, last: suggestion.last_name },
        acceptedSuggestion: true,
      };
      return { ...prev, items: nextItems };
    });
  };

  // Undo an accepted suggestion (put the row back to "will be added as new").
  const handleRejectSuggestion = (idx: number) => {
    setPendingReview((prev) => {
      if (!prev) return prev;
      const item = prev.items[idx];
      const nextItems = prev.items.slice();
      nextItems[idx] = {
        ...item,
        player: { ...item.player, first: item.originalFirst, last: item.originalLast },
        acceptedSuggestion: false,
      };
      return { ...prev, items: nextItems };
    });
  };

  const handleConfirmReview = async () => {
    if (!pendingReview) return;
    const { items, filename, uploadDate: snapshotDate } = pendingReview;
    setBusyBoth(true);
    setPendingReview(null);
    try {
      await proceedToIngest(items.map((it) => it.player), filename, snapshotDate);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Upload failed";
      const msg = friendlyError(raw);
      setResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setBusyBoth(false);
    }
  };

  const handleConfirmOverwrite = async () => {
    if (!pendingOverwrite) return;
    const { players, filename, uploadDate: stagedDate } = pendingOverwrite;
    setBusyBoth(true);
    try {
      const count = await ingestOnce({ players, filename, uploadDate: stagedDate, replace: true });
      finishSuccess(count, stagedDate);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Upload failed";
      const msg = friendlyError(raw);
      setResult({ ok: false, msg });
      toast.error(msg);
      setPendingOverwrite(null);
    } finally {
      setBusyBoth(false);
    }
  };

  const dialogOpen = pendingOverwrite !== null;
  const categoryDialogOpen = pendingCategory !== null;
  const reviewDialogOpen = pendingReview !== null;
  const submitDisabled = busy || !file || dialogOpen || categoryDialogOpen || reviewDialogOpen;

  // Bucket the review items by classification kind for the dialog sections.
  const reviewExisting = pendingReview?.items.filter((it) => it.classification.kind === "existing") ?? [];
  const reviewSimilar = pendingReview
    ? pendingReview.items
        .map((it, idx) => ({ it, idx }))
        .filter(({ it }) => it.classification.kind === "similar")
    : [];
  const reviewNew = pendingReview?.items.filter((it) => it.classification.kind === "new") ?? [];

  // Derive the categories present in this pending upload from the first
  // player's stats shape. The RPC overwrites stats wholesale (stats =
  // EXCLUDED.stats), so any empty section in the incoming file will wipe
  // whatever exists on the snapshot — warn the coach before they confirm.
  const overwriteMissing: StatsCategory[] = pendingOverwrite
    ? (["batting", "pitching", "fielding"] as const).filter(
        (c) => Object.keys(pendingOverwrite.players[0]?.stats[c] ?? {}).length === 0,
      )
    : [];
  const overwritePresent: StatsCategory[] = pendingOverwrite
    ? (["batting", "pitching", "fielding"] as const).filter((c) => !overwriteMissing.includes(c))
    : [];

  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Coach Tools</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">Upload Weekly Stats</h2>
      <p className="text-sm text-muted-foreground mb-8">
        Upload the team's cumulative season-to-date stats — a full 3-sheet workbook, a single-category file (Hitting only, Pitching only, Fielding only), or a CSV. Each upload is saved as a snapshot so trends build week over week.
      </p>

      <Card className="p-8 shadow-elevated">
        <div className="space-y-5">
          <div>
            <Label htmlFor="upload-date" className="mb-1.5 block">Upload date (week of)</Label>
            <Input id="upload-date" type="date" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="csv-file" className="mb-1.5 block">File (.csv or .xlsx)</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-sa-orange transition-colors bg-muted/20">
              <UploadIcon className="w-8 h-8 mx-auto mb-2 text-sa-blue" />
              <Input
                ref={fileRef}
                id="csv-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="max-w-sm mx-auto"
              />
              {file && (
                <p className="mt-3 text-sm text-foreground flex items-center justify-center gap-2">
                  <FileText className="w-4 h-4 text-sa-orange" /> {file.name}
                </p>
              )}
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="w-full bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange font-semibold uppercase tracking-wider"
          >
            {busy ? "Importing…" : "Import Stats"}
          </Button>

          {result && (
            <div
              className={`flex items-start gap-3 p-4 rounded-md ${
                result.ok ? "bg-sa-blue/5 border border-sa-blue/20" : "bg-destructive/5 border border-destructive/20"
              }`}
            >
              {result.ok ? (
                <CheckCircle2 className="w-5 h-5 text-sa-blue flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              )}
              <p className="text-sm">{result.msg}</p>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6 mt-6 bg-sa-grey-soft/40 border-dashed">
        <h3 className="font-display text-xl text-sa-blue-deep mb-2">Expected format</h3>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Excel workbook with any of: sheets named <strong>Hitting</strong>, <strong>Pitching</strong>, <strong>Fielding</strong> — each independently optional</li>
          <li>Or a single CSV / single-sheet Excel — you'll be asked which category it is</li>
          <li>Each sheet starts with a header row containing <code>Number, Last, First, …stat columns</code></li>
          <li>Player rows follow; <strong>Totals</strong> and <strong>Glossary</strong> rows are auto-skipped</li>
          <li>Players are matched by first + last name across weekly uploads</li>
        </ul>
      </Card>

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && !busyRef.current) setPendingOverwrite(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOverwrite
                ? `A stats snapshot already exists for ${formatPickerDate(pendingOverwrite.uploadDate)} (${pendingOverwrite.existingCount} player ${pendingOverwrite.existingCount === 1 ? "row" : "rows"}). Replacing will overwrite those values with the new workbook.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingOverwrite && overwriteMissing.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p>
                <strong>Heads up:</strong> this file only contains{" "}
                {overwritePresent.map((c) => CATEGORY_LABEL[c]).join(" + ")}.{" "}
                {overwriteMissing.map((c) => CATEGORY_LABEL[c]).join(" and ")} data on the existing snapshot will be cleared.
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOverwrite} disabled={busy}>
              {busy ? "Replacing…" : "Replace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={categoryDialogOpen}
        onOpenChange={(open) => {
          if (!open && !busyRef.current) setPendingCategory(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Which category is this?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCategory
                ? `We couldn't auto-detect from the sheet name "${pendingCategory.sheetName}". Pick the category the columns represent — the other categories will be left untouched on existing snapshots.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-3 gap-2 my-4">
            {(["batting", "pitching", "fielding"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setOverrideChoice(cat)}
                className={`px-4 py-3 rounded-md border-2 text-sm font-semibold uppercase tracking-wider transition-colors ${
                  overrideChoice === cat
                    ? "border-sa-orange bg-sa-orange/10 text-sa-orange"
                    : "border-border bg-background hover:border-sa-orange/40 text-muted-foreground"
                }`}
              >
                {CATEGORY_LABEL[cat]}
              </button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCategory} disabled={busy}>
              {busy ? "Importing…" : `Import as ${CATEGORY_LABEL[overrideChoice]}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={reviewDialogOpen}
        onOpenChange={(open) => {
          if (!open && !busyRef.current) setPendingReview(null);
        }}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Review names before import</AlertDialogTitle>
            <AlertDialogDescription>
              We matched the file's names against your school roster. Confirm any did-you-mean suggestions, then import.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-4 max-h-[55vh] overflow-y-auto space-y-5">
            {reviewSimilar.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-sa-orange" />
                  Possible typos ({reviewSimilar.length})
                </h3>
                <ul className="space-y-2">
                  {reviewSimilar.map(({ it, idx }) => {
                    if (it.classification.kind !== "similar") return null;
                    const suggestion = it.classification.suggestion;
                    return (
                      <li key={idx} className="rounded-md border border-border bg-background p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {it.originalFirst} {it.originalLast}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Did you mean{" "}
                              <strong className="text-foreground">
                                {suggestion.first_name} {suggestion.last_name}
                              </strong>
                              ? ({it.classification.distance} {it.classification.distance === 1 ? "edit" : "edits"} away)
                            </p>
                          </div>
                          {it.acceptedSuggestion ? (
                            <button
                              type="button"
                              onClick={() => handleRejectSuggestion(idx)}
                              className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md border-2 border-sa-blue/40 bg-sa-blue/10 text-sa-blue text-xs font-semibold"
                            >
                              <Check className="w-3 h-3" /> Using match
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleAcceptSuggestion(idx)}
                              className="flex-shrink-0 px-3 py-1.5 rounded-md border-2 border-border bg-background text-xs font-semibold hover:border-sa-orange hover:text-sa-orange transition-colors"
                            >
                              Use match
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {reviewNew.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <span className="text-base">🆕</span>
                  New players ({reviewNew.length})
                </h3>
                <p className="text-xs text-muted-foreground mb-2">
                  These names don't match anyone on your roster and will be added as new players.
                </p>
                <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
                  {reviewNew.map((it, i) => (
                    <li key={`new-${i}`} className="text-muted-foreground">
                      • {it.player.first} {it.player.last}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {reviewExisting.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-sa-blue" />
                  Matched existing roster ({reviewExisting.length})
                </h3>
                <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
                  {reviewExisting.map((it, i) => (
                    <li key={`existing-${i}`} className="text-muted-foreground">
                      • {it.player.first} {it.player.last}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmReview} disabled={busy}>
              {busy ? "Importing…" : "Confirm import"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
