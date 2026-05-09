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
import { Upload as UploadIcon, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { parseStatsWorkbook, type ParsedPlayer } from "@/lib/csvParser";
import type { Json } from "@/integrations/supabase/types";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";

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

export default function UploadStatsPage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const [file, setFile] = useState<File | null>(null);
  const [uploadDate, setUploadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwrite | null>(null);
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
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!file) {
      toast.error("Choose an Excel file");
      return;
    }
    if (!uploadDate) {
      toast.error("Pick an upload date");
      return;
    }
    setBusyBoth(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const { players, unknownHeaders } = parseStatsWorkbook(buf);
      if (players.length === 0) throw new Error("No players found in workbook");
      if (unknownHeaders.length > 0) {
        toast.warning(
          `Unrecognized stat columns ingested: ${unknownHeaders.slice(0, 6).join(", ")}${unknownHeaders.length > 6 ? "…" : ""}. Update the glossary if these are real stats.`,
          { duration: 8000 },
        );
      }

      try {
        const count = await ingestOnce({ players, filename: file.name, uploadDate, replace: false });
        finishSuccess(count, uploadDate);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith(OVERWRITE_PREFIX)) {
          const existingCount = parseInt(msg.slice(OVERWRITE_PREFIX.length), 10) || 0;
          setPendingOverwrite({ players, filename: file.name, uploadDate, existingCount });
          return;
        }
        throw e;
      }
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
  const submitDisabled = busy || !file || dialogOpen;

  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Coach Tools</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">Upload Weekly Stats</h2>
      <p className="text-sm text-muted-foreground mb-8">
        Upload the team's cumulative season-to-date Excel workbook (.xlsx). Each upload is saved as a snapshot so trends build week over week.
      </p>

      <Card className="p-8 shadow-elevated">
        <div className="space-y-5">
          <div>
            <Label htmlFor="upload-date" className="mb-1.5 block">Upload date (week of)</Label>
            <Input id="upload-date" type="date" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="csv-file" className="mb-1.5 block">Excel file (.xlsx)</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-sa-orange transition-colors bg-muted/20">
              <UploadIcon className="w-8 h-8 mx-auto mb-2 text-sa-blue" />
              <Input
                ref={fileRef}
                id="csv-file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
          <li>Three sheets named <strong>Hitting</strong>, <strong>Pitching</strong>, and <strong>Fielding</strong></li>
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
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOverwrite} disabled={busy}>
              {busy ? "Replacing…" : "Replace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
