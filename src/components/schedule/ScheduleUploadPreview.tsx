"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Trash2, AlertTriangle } from "lucide-react";
import { OpponentPicker, type OpponentPickerValue } from "@/components/schedule/OpponentPicker";
import type { ParsedScheduleRow, ScheduleLocation } from "@/lib/csvParser";
import type { Sport } from "@/integrations/supabase/types";

export type ConflictMode = "skip" | "replace" | "error";

export interface PreviewRow extends ParsedScheduleRow {
  /** Stable client-side id so React keys survive edits/sorts. */
  rowId: string;
  opponent_team_id: string | null;
}

interface ScheduleUploadPreviewProps {
  initialRows: ParsedScheduleRow[];
  warnings: string[];
  teamId: string;
  sport: Sport;
  busy: boolean;
  onCancel: () => void;
  onCommit: (rows: PreviewRow[], conflictMode: ConflictMode) => void;
}

const HHMM_RE = /^\d{2}:\d{2}$/;

const validateRow = (r: PreviewRow): string | null => {
  if (!r.game_date) return "Date is required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.game_date)) return "Date must be YYYY-MM-DD";
  if (!r.opponent.trim()) return "Opponent is required";
  if (r.game_time && !HHMM_RE.test(r.game_time)) return "Time must be HH:MM";
  if (!["home", "away", "neutral"].includes(r.location)) return "Invalid location";
  return null;
};

export function ScheduleUploadPreview({
  initialRows,
  warnings,
  teamId,
  sport,
  busy,
  onCancel,
  onCommit,
}: ScheduleUploadPreviewProps) {
  const [rows, setRows] = useState<PreviewRow[]>(() =>
    initialRows.map((r, i) => ({
      ...r,
      rowId: `r${i}-${r.sourceRow}-${r.game_sequence}`,
      opponent_team_id: null,
    })),
  );
  const [conflictMode, setConflictMode] = useState<ConflictMode | "">("");

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of rows) {
      const e = validateRow(r);
      if (e) out[r.rowId] = e;
    }
    return out;
  }, [rows]);

  const errorCount = Object.keys(errors).length;
  const canCommit = !busy && rows.length > 0 && errorCount === 0 && conflictMode !== "";

  const updateRow = (rowId: string, patch: Partial<PreviewRow>) => {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const handleOpponentChange = (rowId: string, v: OpponentPickerValue) => {
    updateRow(rowId, { opponent: v.opponent, opponent_team_id: v.opponent_team_id });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-3xl text-sa-blue-deep">Review {rows.length} game{rows.length === 1 ? "" : "s"}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Edit any field below. Click an opponent to link a known team — otherwise it's saved as free text.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>

      {warnings.length > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-50/40">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold mb-1">Parser warnings</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                {warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
                {warnings.length > 8 && <li>…and {warnings.length - 8} more</li>}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {errorCount > 0 && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-destructive" />
            <span>{errorCount} row{errorCount === 1 ? " has" : "s have"} errors. Fix or remove before importing.</span>
          </div>
        </Card>
      )}

      <div className="border border-border rounded-lg">
        <div className="grid grid-cols-[110px_88px_minmax(220px,1fr)_110px_minmax(160px,1fr)_60px_40px] gap-2 px-3 py-2 bg-muted/50 text-[11px] uppercase tracking-wider font-bold text-muted-foreground rounded-t-lg">
          <div>Date</div>
          <div>Time</div>
          <div>Opponent</div>
          <div>Location</div>
          <div>Notes</div>
          <div className="text-center">DH</div>
          <div></div>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const err = errors[r.rowId];
            return (
              <li
                key={r.rowId}
                className={`grid grid-cols-[110px_88px_minmax(220px,1fr)_110px_minmax(160px,1fr)_60px_40px] gap-2 px-3 py-2 items-center ${
                  err ? "bg-destructive/5" : ""
                }`}
              >
                <Input
                  type="date"
                  value={r.game_date}
                  onChange={(e) => updateRow(r.rowId, { game_date: e.target.value })}
                  className="h-9"
                />
                <Input
                  type="time"
                  value={r.game_time}
                  onChange={(e) => updateRow(r.rowId, { game_time: e.target.value })}
                  className="h-9"
                />
                <OpponentPicker
                  value={{ opponent: r.opponent, opponent_team_id: r.opponent_team_id }}
                  onChange={(v) => handleOpponentChange(r.rowId, v)}
                  sport={sport}
                  excludeTeamId={teamId}
                  placeholder="Magnolia Heights"
                  disabled={busy}
                />
                <Select
                  value={r.location}
                  onValueChange={(v) => updateRow(r.rowId, { location: v as ScheduleLocation })}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home">Home</SelectItem>
                    <SelectItem value="away">Away</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={r.notes}
                  onChange={(e) => updateRow(r.rowId, { notes: e.target.value })}
                  maxLength={500}
                  className="h-9"
                />
                <div className="text-center text-xs font-mono text-muted-foreground">
                  {r.game_sequence === 2 ? "Leg 2" : r.game_sequence === 1 && rows.some((other) => other.rowId !== r.rowId && other.game_date === r.game_date && other.game_sequence === 2) ? "Leg 1" : "—"}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(r.rowId)}
                  disabled={busy}
                  title="Remove row"
                  className="h-9 w-9"
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
                {err && (
                  <p className="col-span-7 text-xs text-destructive flex items-center gap-1 -mt-1">
                    <AlertCircle className="w-3 h-3" /> {err}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <Card className="p-5">
        <Label className="text-xs uppercase tracking-wider font-bold mb-3 block">If a game already exists on a date</Label>
        <div className="grid sm:grid-cols-3 gap-2">
          {(["error", "skip", "replace"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setConflictMode(mode)}
              disabled={busy}
              className={`text-left p-3 rounded-md border transition-colors ${
                conflictMode === mode
                  ? "border-sa-blue bg-sa-blue/5"
                  : "border-border hover:border-sa-blue/40"
              }`}
            >
              <div className="text-sm font-bold capitalize">
                {mode === "error" ? "Stop and warn" : mode === "skip" ? "Keep existing" : "Replace existing"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {mode === "error" && "Cancel the import if any row collides with an existing game."}
                {mode === "skip" && "Insert new games only; leave any matching dates untouched."}
                {mode === "replace" && "Overwrite the matching games with the new values."}
              </div>
            </button>
          ))}
        </div>
        {conflictMode === "" && (
          <p className="text-xs text-muted-foreground mt-3">Pick one to enable Import.</p>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          onClick={() => conflictMode !== "" && onCommit(rows, conflictMode)}
          disabled={!canCommit}
          className="bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange"
        >
          {busy ? "Importing…" : `Import ${rows.length} game${rows.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
