"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload as UploadIcon, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { parseRosterFile } from "@/lib/rosterParser";
import type { Json } from "@/integrations/supabase/types";
import { currentSeasonYear, isSeasonClosed, seasonLabel } from "@/lib/season";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";

const supabase = createClient();

const SEASON_OPTIONS = (() => {
  const cur = currentSeasonYear();
  return [cur + 1, cur, cur - 1, cur - 2].filter((y) => y >= 2000);
})();

export default function RosterUploadPage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const [file, setFile] = useState<File | null>(null);
  const [season, setSeason] = useState<number>(currentSeasonYear());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!file) {
      toast.error("Choose a roster file");
      return;
    }
    if (isSeasonClosed(season)) {
      toast.error(`The ${season} season is closed. Pick the current or upcoming season.`);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const { players, hadNumberColumn, hadPositionColumn, hadGradYearColumn } =
        parseRosterFile(buf);

      // Atomic upsert via SECURITY DEFINER RPC. The has_* flags tell the RPC
      // which columns to actually write — columns absent from the file are
      // preserved on existing rows, so re-uploading a roster without a
      // Position column won't wipe positions set on a previous upload.
      const { error: rpcErr } = await supabase.rpc("upsert_roster", {
        p_school: school.id,
        p_team: team.id,
        p_season: season,
        p_players: players as unknown as Json,
        p_has_number: hadNumberColumn,
        p_has_position: hadPositionColumn,
        p_has_grad_year: hadGradYearColumn,
      });
      if (rpcErr) throw rpcErr;

      setResult({
        ok: true,
        msg: `Imported ${players.length} player${players.length === 1 ? "" : "s"} for ${seasonLabel(season)}.`,
      });
      toast.success("Roster uploaded");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Coach Tools</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">Upload Roster</h2>
      <p className="text-sm text-muted-foreground mb-8">
        Set your team's roster for the season. Upload a CSV or Excel file with jersey number, last name, and first name.
        Players are persisted across seasons — re-uploading just refreshes jersey numbers and positions.
      </p>

      <Card className="p-8 shadow-elevated">
        <div className="space-y-5">
          <div>
            <Label htmlFor="season" className="mb-1.5 block">Season</Label>
            <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
              <SelectTrigger id="season" className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEASON_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)} disabled={isSeasonClosed(y)}>
                    {seasonLabel(y)}{isSeasonClosed(y) ? " (closed)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="roster-file" className="mb-1.5 block">Roster file (.csv or .xlsx)</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-sa-orange transition-colors bg-muted/20">
              <UploadIcon className="w-8 h-8 mx-auto mb-2 text-sa-blue" />
              <Input
                ref={fileRef}
                id="roster-file"
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
            disabled={busy || !file}
            className="w-full bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange font-semibold uppercase tracking-wider"
          >
            {busy ? "Importing…" : "Import Roster"}
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
          <li>Single sheet (or CSV) with a header row including <strong>First</strong> and <strong>Last</strong> columns</li>
          <li>Optional columns: <strong>Number</strong> (jersey), <strong>Position</strong>, <strong>Grad Year</strong></li>
          <li>Header names are case-insensitive — <code>#</code>, <code>Jersey</code>, <code>Pos</code>, <code>Class</code> all work</li>
          <li>Players are matched by First + Last name across uploads, so re-uploading is safe</li>
        </ul>
      </Card>
    </div>
  );
}
