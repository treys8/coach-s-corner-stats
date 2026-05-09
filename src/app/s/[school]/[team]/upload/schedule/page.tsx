"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload as UploadIcon, FileText, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { toast } from "sonner";
import { parseScheduleSheet, type ParsedScheduleRow } from "@/lib/csvParser";
import type { Json } from "@/integrations/supabase/types";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";
import {
  ScheduleUploadPreview,
  type ConflictMode,
  type PreviewRow,
} from "@/components/schedule/ScheduleUploadPreview";

const supabase = createClient();
const CONFLICT_PREFIX = "SCHED_CONFLICTS:";

const friendlyError = (msg: string): string => {
  const m = msg.match(/^season (\d+) is closed$/);
  if (m) return `The ${m[1]} season is closed (ended May 31). Pick dates inside an open season.`;
  if (msg.startsWith(CONFLICT_PREFIX)) {
    const n = msg.slice(CONFLICT_PREFIX.length);
    return `Import cancelled — ${n} of the rows collide with games already on the schedule.`;
  }
  return msg;
};

const TEMPLATE_CSV =
  "Date,Time,Opponent,Location,Doubleheader,Notes\n" +
  "2026-04-15,4:30 PM,Magnolia Heights,Home,,Senior Night\n" +
  "2026-04-18,11:00 AM,Hillcrest Academy,Away,Y,DH — gates open at 10:30\n" +
  "2026-04-22,,Crestview Prep,Neutral,,\n";

const downloadTemplate = () => {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "schedule-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

interface ParseState {
  filename: string;
  rows: ParsedScheduleRow[];
  warnings: string[];
}

interface CommitResult {
  inserted: number;
  updated: number;
  skipped: number;
  conflict_dates: string[];
}

export default function UploadSchedulePage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const [file, setFile] = useState<File | null>(null);
  const [parseState, setParseState] = useState<ParseState | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleParse = async () => {
    if (!file) {
      toast.error("Choose a CSV or Excel file");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const { rows, warnings } = parseScheduleSheet(buf);
      setParseState({ filename: file.name, rows, warnings });
      if (warnings.length > 0) {
        toast.warning(`Parsed ${rows.length} rows with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`);
      } else {
        toast.success(`Parsed ${rows.length} rows.`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't parse file";
      setResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async (rows: PreviewRow[], conflictMode: ConflictMode) => {
    setBusy(true);
    setResult(null);
    try {
      const payload = rows.map((r) => ({
        game_date: r.game_date,
        game_time: r.game_time || null,
        opponent: r.opponent.trim(),
        opponent_team_id: r.opponent_team_id,
        location: r.location,
        is_home: r.location !== "away",
        game_sequence: r.game_sequence,
        notes: r.notes || null,
      }));
      const { data, error } = await supabase.rpc("ingest_schedule", {
        p_school: school.id,
        p_team: team.id,
        p_games: payload as unknown as Json,
        p_on_conflict: conflictMode,
      });
      if (error) throw error;
      const out = ((data ?? [])[0] ?? {}) as CommitResult;
      const parts: string[] = [];
      if (out.inserted) parts.push(`${out.inserted} added`);
      if (out.updated) parts.push(`${out.updated} replaced`);
      if (out.skipped) parts.push(`${out.skipped} skipped`);
      const summary = parts.length > 0 ? parts.join(", ") : "no changes";
      setResult({ ok: true, msg: `Schedule imported: ${summary}.` });
      toast.success("Schedule imported");
      setParseState(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Import failed";
      const msg = friendlyError(raw);
      setResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (parseState) {
    return (
      <div className="container mx-auto px-6 py-10 max-w-5xl">
        <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Coach Tools</p>
        <h2 className="font-display text-4xl md:text-5xl text-sa-blue-deep mb-1">Review {parseState.filename}</h2>
        <p className="text-sm text-muted-foreground mb-8">Importing into <strong>{team.name}</strong>.</p>
        <ScheduleUploadPreview
          initialRows={parseState.rows}
          warnings={parseState.warnings}
          teamId={team.id}
          sport={team.sport}
          busy={busy}
          onCancel={() => setParseState(null)}
          onCommit={handleCommit}
        />
        {result && !result.ok && (
          <div className="mt-6 flex items-start gap-3 p-4 rounded-md bg-destructive/5 border border-destructive/20">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm">{result.msg}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Coach Tools</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">Upload Schedule</h2>
      <p className="text-sm text-muted-foreground mb-8">
        Drop in a CSV or Excel file. We'll parse it into a preview where you can fix anything before saving.
      </p>

      <Card className="p-8 shadow-elevated">
        <div className="space-y-5">
          <div>
            <Label htmlFor="sched-file" className="mb-1.5 block">CSV or Excel file</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-sa-orange transition-colors bg-muted/20">
              <UploadIcon className="w-8 h-8 mx-auto mb-2 text-sa-blue" />
              <Input
                ref={fileRef}
                id="sched-file"
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
            onClick={handleParse}
            disabled={busy || !file}
            className="w-full bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange font-semibold uppercase tracking-wider"
          >
            {busy ? "Parsing…" : "Parse File"}
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
              <div className="text-sm">
                <p>{result.msg}</p>
                {result.ok && (
                  <Link
                    href={`/s/${school.slug}/${team.slug}/schedule`}
                    className="text-sa-blue underline mt-1 inline-block"
                  >
                    View schedule →
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6 mt-6 bg-sa-grey-soft/40 border-dashed">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-display text-xl text-sa-blue-deep mb-2">Expected format</h3>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Header row with columns: <code>Date</code>, <code>Time</code>, <code>Opponent</code>, <code>Location</code>, <code>Doubleheader</code>, <code>Notes</code></li>
              <li>Date can be <code>YYYY-MM-DD</code> or <code>M/D/YYYY</code></li>
              <li>Location accepts <code>Home / Away / Neutral</code> (or H / A / N)</li>
              <li>Doubleheader: any of <code>Y</code>, <code>DH</code>, <code>true</code> creates two games on that date</li>
              <li>Only <strong>Date</strong> and <strong>Opponent</strong> are required</li>
            </ul>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate} className="flex-shrink-0">
            <Download className="w-4 h-4 mr-2" /> Download template
          </Button>
        </div>
      </Card>
    </div>
  );
}
