"use client";

// Single-row typo fixer for an opponent_players record. Edits are bare
// supabase UPDATEs gated by the school-scoped RLS on opponent_players.
// Live games are not affected directly — but next refresh of any view that
// joins opponent_players will pick up the corrected identity.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export interface EditableOpponentPlayer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  jersey_number: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: EditableOpponentPlayer | null;
  onSaved: (updated: EditableOpponentPlayer) => void;
}

export function EditOpposingPlayerDialog({ open, onOpenChange, player, onSaved }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jerseyNumber, setJerseyNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !player) return;
    setFirstName(player.first_name ?? "");
    setLastName(player.last_name ?? "");
    setJerseyNumber(player.jersey_number ?? "");
  }, [open, player]);

  const validationError = ((): string | null => {
    if (!lastName.trim() && !jerseyNumber.trim()) {
      return "Enter a jersey number or last name.";
    }
    return null;
  })();

  const save = async () => {
    if (!player || submitting) return;
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSubmitting(true);
    const next = {
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      jersey_number: jerseyNumber.trim() || null,
    };
    const { error } = await supabase
      .from("opponent_players")
      .update(next)
      .eq("id", player.id);
    setSubmitting(false);
    if (error) {
      toast.error(`Couldn't save: ${error.message}`);
      return;
    }
    onSaved({ id: player.id, ...next });
    toast.success("Saved");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit opposing player</DialogTitle>
          <DialogDescription>
            Fix a typo in this opponent&apos;s name or jersey. Doesn&apos;t change any
            already-recorded at-bats.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-4 gap-3 items-center">
            <Label htmlFor="opp-jersey" className="text-right text-sm">Jersey</Label>
            <Input
              id="opp-jersey"
              value={jerseyNumber}
              onChange={(e) => setJerseyNumber(e.target.value)}
              placeholder="#"
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 gap-3 items-center">
            <Label htmlFor="opp-first" className="text-right text-sm">First</Label>
            <Input
              id="opp-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 gap-3 items-center">
            <Label htmlFor="opp-last" className="text-right text-sm">Last</Label>
            <Input
              id="opp-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="col-span-3"
            />
          </div>
          {validationError && (
            <p className="text-sm text-amber-600 col-span-4 text-right">{validationError}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={submitting || validationError !== null}
            className="bg-sa-orange hover:bg-sa-orange/90"
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
