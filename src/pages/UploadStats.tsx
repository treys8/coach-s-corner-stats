import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload as UploadIcon, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { parseStatsWorkbook } from "@/lib/csvParser";
import { seasonYearFor, isSeasonClosed } from "@/lib/season";

const UploadStats = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploadDate, setUploadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!file) { toast.error("Choose an Excel file"); return; }
    if (!uploadDate) { toast.error("Pick an upload date"); return; }
    setBusy(true);
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

      const season_year = seasonYearFor(uploadDate);
      if (isSeasonClosed(season_year)) {
        throw new Error(`The ${season_year} season is closed (ended May 31). Pick a date inside an open season window (Feb 1 – May 31).`);
      }

      // 1. Upsert players for THIS season (rosters are per-season)
      const playerRows = players.map((p) => ({
        first_name: p.first,
        last_name: p.last,
        jersey_number: p.number || "",
        season_year,
      }));
      const { error: playerErr } = await supabase
        .from("players")
        .upsert(playerRows, { onConflict: "season_year,first_name,last_name" });
      if (playerErr) throw playerErr;

      // 2. Fetch IDs scoped to this season
      const { data: playerRecords, error: fetchErr } = await supabase
        .from("players")
        .select("id, first_name, last_name")
        .eq("season_year", season_year);
      if (fetchErr) throw fetchErr;
      const idByName = new Map<string, string>();
      (playerRecords ?? []).forEach((r) => idByName.set(`${r.first_name}|${r.last_name}`, r.id));

      // 3. Insert audit row
      const { data: uploadRow, error: upErr } = await supabase
        .from("csv_uploads")
        .insert({ upload_date: uploadDate, filename: file.name, player_count: players.length, season_year })
        .select("id")
        .single();
      if (upErr) throw upErr;

      // 4. Upsert snapshots — stats stored split by section
      const snapshots = players
        .map((p) => {
          const pid = idByName.get(`${p.first}|${p.last}`);
          if (!pid) return null;
          return {
            player_id: pid,
            upload_date: uploadDate,
            upload_id: uploadRow.id,
            stats: p.stats, // { batting, pitching, fielding }
            season_year,
          };
        })
        .filter(Boolean);

      const { error: snapErr } = await supabase
        .from("stat_snapshots")
        .upsert(snapshots as never[], { onConflict: "player_id,upload_date" });
      if (snapErr) throw snapErr;

      setResult({ ok: true, msg: `Imported ${players.length} players for ${new Date(uploadDate).toLocaleDateString()}.` });
      toast.success("Stats uploaded");
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
            disabled={busy || !file}
            className="w-full bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange font-semibold uppercase tracking-wider"
          >
            {busy ? "Importing…" : "Import Stats"}
          </Button>

          {result && (
            <div className={`flex items-start gap-3 p-4 rounded-md ${result.ok ? "bg-sa-blue/5 border border-sa-blue/20" : "bg-destructive/5 border border-destructive/20"}`}>
              {result.ok
                ? <CheckCircle2 className="w-5 h-5 text-sa-blue flex-shrink-0 mt-0.5" />
                : <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />}
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
    </div>
  );
};

export default UploadStats;
