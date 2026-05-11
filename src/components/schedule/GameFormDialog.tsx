"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { seasonYearFor, isSeasonClosed } from "@/lib/season";
import { recognizeOpponentTeam } from "@/lib/opponents/recognition";
import type { GameLocation, GameResult } from "@/integrations/supabase/types";
import type { Game } from "./types";

const gameSchema = z.object({
  game_date: z.string().min(1, "Date required"),
  game_time: z.string().optional(),
  opponent: z.string().trim().min(1, "Opponent required").max(100),
  location: z.enum(["home", "away", "neutral"]),
  team_score: z.string().optional(),
  opponent_score: z.string().optional(),
  result: z.enum(["", "W", "L", "T"]).optional(),
  notes: z.string().max(500).optional(),
});

interface FormState {
  game_date: string;
  game_time: string;
  opponent: string;
  location: GameLocation;
  team_score: string;
  opponent_score: string;
  result: "" | GameResult;
  notes: string;
}

const DEFAULT_FORM: FormState = {
  game_date: "", game_time: "", opponent: "", location: "home",
  team_score: "", opponent_score: "", result: "", notes: "",
};

const supabase = createClient();

interface Props {
  teamId: string;
  open: boolean;
  editingGame: Game | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function GameFormDialog({ teamId, open, editingGame, onOpenChange, onSaved }: Props) {
  const [form, setForm] = useState(DEFAULT_FORM);

  // Sync form state whenever the dialog opens (or the editing target changes
  // while open). Reset to DEFAULT_FORM on Add, populate from `editingGame` on
  // Edit. Skipped while closed so we don't churn state for an unseen dialog.
  useEffect(() => {
    if (!open) return;
    if (editingGame) {
      setForm({
        game_date: editingGame.game_date,
        game_time: editingGame.game_time?.slice(0, 5) ?? "",
        opponent: editingGame.opponent,
        location: editingGame.location,
        team_score: editingGame.team_score === null ? "" : String(editingGame.team_score),
        opponent_score: editingGame.opponent_score === null ? "" : String(editingGame.opponent_score),
        result: editingGame.result ?? "",
        notes: editingGame.notes ?? "",
      });
    } else {
      setForm(DEFAULT_FORM);
    }
  }, [open, editingGame]);

  const submit = async () => {
    const parsed = gameSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const yr = seasonYearFor(form.game_date);
    if (isSeasonClosed(yr)) {
      toast.error(`The ${yr} season is closed.`);
      return;
    }
    const trimmedOpponent = form.opponent.trim();

    // Best-effort auto-recognition on Add: if a single Statly tenant exactly
    // matches the opponent name (case-insensitive against name/short_name,
    // same sport+level, opted into discovery), set opponent_team_id so the
    // pre-game roster-pull affordance lights up. Ambiguous or unmatched
    // stays null; the coach can fix via the OpponentPicker in the schedule
    // table. Recognition failures are silently ignored.
    //
    // On Edit we skip recognition entirely — preserving a previously set
    // opponent_team_id (or its absence) avoids surprise relinking when a
    // coach edits date/time on an already-linked row. The schedule-row
    // OpponentPicker remains the explicit override surface.

    // Provisional is_home derivation matching 20260509160000_..._backfill_is_home.sql:
    // home/neutral → true, away → false. Will be refined when the opponent picker
    // wire-up adds an explicit choice for neutral games.
    const basePayload = {
      team_id: teamId,
      game_date: form.game_date,
      game_time: form.game_time || null,
      opponent: trimmedOpponent,
      location: form.location,
      is_home: form.location !== "away",
      team_score: form.team_score === "" ? null : Number(form.team_score),
      opponent_score: form.opponent_score === "" ? null : Number(form.opponent_score),
      result: form.result === "" ? null : form.result,
      notes: form.notes || null,
    };

    let error: { message: string } | null = null;
    if (editingGame) {
      const res = await supabase.from("games").update(basePayload).eq("id", editingGame.id);
      error = res.error;
    } else {
      const recognition = await recognizeOpponentTeam(teamId, trimmedOpponent);
      const opponentTeamId =
        recognition.kind === "match" ? recognition.match.team_id : null;
      const res = await supabase
        .from("games")
        .insert({ ...basePayload, opponent_team_id: opponentTeamId });
      error = res.error;
    }
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingGame ? "Game updated" : "Game added");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">{editingGame ? "Edit Game" : "Add Game"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Date</Label><Input type="date" value={form.game_date} onChange={(e) => setForm({ ...form, game_date: e.target.value })} /></div>
            <div><Label>Time</Label><Input type="time" value={form.game_time} onChange={(e) => setForm({ ...form, game_time: e.target.value })} /></div>
          </div>
          <div><Label>Opponent</Label><Input value={form.opponent} onChange={(e) => setForm({ ...form, opponent: e.target.value })} placeholder="Magnolia Heights" /></div>
          <div>
            <Label>Location</Label>
            <Select value={form.location} onValueChange={(v) => setForm({ ...form, location: v as GameLocation })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="home">Home</SelectItem>
                <SelectItem value="away">Away</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Result</Label>
              <Select value={form.result} onValueChange={(v) => setForm({ ...form, result: v as GameResult })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="W">Win</SelectItem>
                  <SelectItem value="L">Loss</SelectItem>
                  <SelectItem value="T">Tie</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Our score</Label><Input type="number" value={form.team_score} onChange={(e) => setForm({ ...form, team_score: e.target.value })} /></div>
            <div><Label>Their score</Label><Input type="number" value={form.opponent_score} onChange={(e) => setForm({ ...form, opponent_score: e.target.value })} /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={submit} className="bg-sa-blue hover:bg-sa-blue-deep">{editingGame ? "Save Changes" : "Save Game"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
