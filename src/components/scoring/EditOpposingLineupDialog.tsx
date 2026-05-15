"use client";

// Mid-game opposing-lineup editor. Wraps the same OpposingLineupPicker the
// pre-game form uses. Saves by:
//   1) upsert_opponent_players  (any new/edited identity flushes to the table)
//   2) post an opposing_lineup_edit event with the resolved lineup
// The replay engine then replaces state.opposing_lineup wholesale and (only
// when the prior lineup was empty) resets current_opp_batter_slot to 1.

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { postEvent } from "@/lib/scoring/events-client";
import { OpposingLineupPicker } from "@/components/score/OpposingLineupPicker";
import {
  buildEmpty,
  toLineupSlot,
  type OpposingSlotDraft,
} from "@/lib/opponents/lineup-sources";
import type { Json } from "@/integrations/supabase/types";
import type {
  OpposingLineupEditPayload,
  OpposingLineupSlot,
} from "@/lib/scoring/types";

const supabase = createClient();

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameId: string;
  schoolId: string;
  myTeamId: string;
  gameDate: string;
  opponentName: string;
  opponentTeamId: string | null;
  /** Current opposing lineup from replay state (seeds the picker). */
  currentLineup: OpposingLineupSlot[];
  /** Called after a successful save so the parent can refresh replay state. */
  onSaved: () => Promise<void> | void;
}

export function EditOpposingLineupDialog({
  open,
  onOpenChange,
  gameId,
  schoolId,
  myTeamId,
  gameDate,
  opponentName,
  opponentTeamId,
  currentLineup,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<OpposingSlotDraft[]>(() => seedDraft(currentLineup, opponentTeamId));
  const [opponentIsPublicRoster, setOpponentIsPublicRoster] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Stable per-open idempotency key so retries (offline outbox replay,
  // double-clicks) collide on the server-side UNIQUE(game_id, client_event_id)
  // instead of double-recording the lineup change. Reset every time the
  // dialog opens so a subsequent edit is its own event.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => randomKey());

  // DH usage is derived from the draft: a slot tagged "DH" means DH is
  // in play. The seeded draft already encodes the prior opponent_use_dh
  // via its slot positions.
  const useDh = draft.some((s) => s.position === "DH");

  // Reseed every time the dialog opens so the picker starts from the live
  // replay state, not a stale local draft from the previous open.
  useEffect(() => {
    if (!open) return;
    setDraft(seedDraft(currentLineup, opponentTeamId));
    setIdempotencyKey(randomKey());
  }, [open, currentLineup, opponentTeamId]);

  // Detect whether the opposing school has a public roster so Pull-from-Statly
  // can advertise (or hide) the affordance accurately. Mirrors PreGameForm.
  useEffect(() => {
    if (!open || !opponentTeamId) {
      setOpponentIsPublicRoster(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("teams")
        .select("schools!inner(is_public_roster)")
        .eq("id", opponentTeamId)
        .maybeSingle();
      if (cancelled) return;
      const row = data as unknown as { schools: { is_public_roster: boolean } } | null;
      setOpponentIsPublicRoster(row?.schools.is_public_roster ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, opponentTeamId]);

  const validationError = ((): string | null => {
    const missing = draft.findIndex(
      (s) =>
        (s.jersey_number?.trim().length ?? 0) === 0 &&
        (s.last_name?.trim().length ?? 0) === 0,
    );
    if (missing !== -1) {
      return `Slot ${missing + 1} needs a jersey number or last name.`;
    }
    return null;
  })();

  const save = async () => {
    if (submitting) return;
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSubmitting(true);

    type UpsertRow = {
      client_ref: string;
      opponent_team_id: string | null;
      external_player_id: string | null;
      first_name: string | null;
      last_name: string | null;
      jersey_number: string | null;
      bats: string | null;
      throws: string | null;
      grad_year: number | null;
    };

    const upsertRows: UpsertRow[] = draft.map((s, i) => ({
      client_ref: `slot-${i}`,
      opponent_team_id: s.opponent_team_id ?? opponentTeamId,
      external_player_id: s.external_player_id,
      first_name: s.first_name?.trim() || null,
      last_name: s.last_name?.trim() || null,
      jersey_number: s.jersey_number?.trim() || null,
      bats: null,
      throws: null,
      grad_year: null,
    }));

    const upsertRes = await supabase.rpc("upsert_opponent_players", {
      p_school: schoolId,
      p_rows: upsertRows as unknown as Json,
    });
    if (upsertRes.error) {
      setSubmitting(false);
      toast.error(`Couldn't save opposing lineup: ${upsertRes.error.message}`);
      return;
    }
    const idByRef = new Map<string, string>();
    for (const r of upsertRes.data ?? []) {
      idByRef.set(r.client_ref, r.opponent_player_id);
    }

    const opposingLineup: OpposingLineupSlot[] = draft.map((s, i) => {
      const oppId = idByRef.get(`slot-${i}`) ?? s.opponent_player_id ?? null;
      return toLineupSlot({ ...s, opponent_player_id: oppId });
    });

    const payload: OpposingLineupEditPayload = {
      opposing_lineup: opposingLineup,
      opponent_use_dh: useDh,
    };

    // Route through postEvent so an offline edit lands in the outbox
    // instead of failing with a network toast. The server is idempotent
    // on (game_id, client_event_id) — `idempotencyKey` is stable for the
    // lifetime of this open, so an outbox replay can't double-record.
    const result = await postEvent(gameId, {
      client_event_id: `opplineup-${idempotencyKey}`,
      event_type: "opposing_lineup_edit",
      payload,
    });
    if (result.kind === "error") {
      setSubmitting(false);
      return;
    }
    if (result.kind === "queued") {
      setSubmitting(false);
      toast.success("Lineup change queued — will sync when online.");
      onOpenChange(false);
      return;
    }

    await onSaved();
    setSubmitting(false);
    toast.success("Opposing lineup updated");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit opposing lineup</SheetTitle>
          <SheetDescription>
            Fix typos, swap in pinch hitters, or update positions mid-game. Saves a new
            event so the prior lineup remains in the replay history.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <OpposingLineupPicker
            myTeamId={myTeamId}
            gameId={gameId}
            gameDate={gameDate}
            opponentName={opponentName}
            opponentTeamId={opponentTeamId}
            opponentIsPublicRoster={opponentIsPublicRoster}
            draft={draft}
            setDraft={setDraft}
            opposingPitcherName=""
            setOpposingPitcherName={() => {}}
            opposingPitcherJersey=""
            setOpposingPitcherJersey={() => {}}
            hidePitcher
          />
          {validationError && (
            <p className="text-sm text-amber-600">{validationError}</p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2 border-t">
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
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Stable per-open idempotency key — uses crypto.randomUUID where available
// (modern browsers in secure contexts), falls back to a Math.random
// composite so dev / older environments still produce a non-colliding id.
function randomKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function seedDraft(
  lineup: OpposingLineupSlot[],
  opponentTeamId: string | null,
): OpposingSlotDraft[] {
  if (lineup.length === 0) return buildEmpty();
  // Pad to 9 if the lineup is short (defensive — replay should always emit 9).
  const padded: OpposingLineupSlot[] = [...lineup];
  while (padded.length < 9) {
    padded.push({
      batting_order: padded.length + 1,
      opponent_player_id: null,
      jersey_number: null,
      last_name: null,
      position: null,
      is_dh: false,
    });
  }
  return padded.slice(0, 9).map<OpposingSlotDraft>((s) => ({
    batting_order: s.batting_order,
    opponent_player_id: s.opponent_player_id,
    external_player_id: null,
    opponent_team_id: opponentTeamId,
    jersey_number: s.jersey_number,
    first_name: null,
    last_name: s.last_name,
    position: s.position,
    is_dh: s.is_dh,
  }));
}
