"use client";

// Pre-game picker for the opposing batting order. Three lineup sources
// (Pull from Statly, Use prior lineup, Build new) feed a draft array that
// the parent submits to the upsert_opponent_players RPC and pins onto the
// game_started event's opposing_lineup field. Per-slot identity: jersey
// number OR last name minimum (hard-gate validated in the parent).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  type OpposingSlotDraft,
  buildEmpty,
  loadPriorLineup,
  pullFromStatly,
  slotHasIdentity,
} from "@/lib/opponents/lineup-sources";
import { seasonYearFor } from "@/lib/season";

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"] as const;

interface Props {
  myTeamId: string;
  gameId: string;
  gameDate: string;
  opponentName: string;
  opponentTeamId: string | null;
  opponentIsPublicRoster: boolean | null;
  draft: OpposingSlotDraft[];
  setDraft: (d: OpposingSlotDraft[]) => void;
  useDh: boolean;
  setUseDh: (v: boolean) => void;
  opposingPitcherName: string;
  setOpposingPitcherName: (v: string) => void;
  opposingPitcherJersey: string;
  setOpposingPitcherJersey: (v: string) => void;
  /** Which defensive position the opposing DH bats for. Defaults to "P".
   *  Optional so the mid-game edit dialog (which uses hidePitcher) doesn't
   *  have to provide it — DH coverage is a pre-game concern. */
  dhCoversPos?: string;
  setDhCoversPos?: (v: string) => void;
  /** Hide the opposing starting pitcher fields. Used by the mid-game edit
   *  dialog, since the pitcher is changed via the Pitching change flow, not
   *  through opposing_lineup_edit. */
  hidePitcher?: boolean;
}

export function OpposingLineupPicker({
  myTeamId,
  gameId,
  gameDate,
  opponentName,
  opponentTeamId,
  opponentIsPublicRoster,
  draft,
  setDraft,
  useDh,
  setUseDh,
  opposingPitcherName,
  setOpposingPitcherName,
  opposingPitcherJersey,
  setOpposingPitcherJersey,
  dhCoversPos = "P",
  setDhCoversPos,
  hidePitcher = false,
}: Props) {
  const [loadingSource, setLoadingSource] = useState<"pull" | "prior" | null>(null);

  const updateSlot = (idx: number, patch: Partial<OpposingSlotDraft>) => {
    setDraft(draft.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const handlePull = async () => {
    if (!opponentTeamId) return;
    setLoadingSource("pull");
    try {
      const next = await pullFromStatly(opponentTeamId, seasonYearFor(gameDate));
      if (next.length === 0) {
        toast.error(`${opponentName} hasn't published a current-season roster.`);
      } else {
        setDraft(padToNine(next));
      }
    } catch (e) {
      toast.error(`Couldn't pull roster: ${(e as Error).message}`);
    } finally {
      setLoadingSource(null);
    }
  };

  const handlePrior = async () => {
    setLoadingSource("prior");
    try {
      const prior = await loadPriorLineup({
        myTeamId,
        opponentTeamId,
        opponentName,
        excludeGameId: gameId,
      });
      if (prior === null) {
        toast.error(`No prior game vs ${opponentName} has an opposing lineup on file yet.`);
      } else {
        setDraft(padToNine(prior));
      }
    } catch (e) {
      toast.error(`Couldn't load prior lineup: ${(e as Error).message}`);
    } finally {
      setLoadingSource(null);
    }
  };

  const canPull = !!opponentTeamId && opponentIsPublicRoster !== false;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="font-display text-sm uppercase tracking-wider text-sa-blue">
          Opposing lineup ({opponentName})
        </h4>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={useDh} onCheckedChange={(v) => setUseDh(!!v)} />
          Opponent uses DH
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPull || loadingSource !== null}
          onClick={handlePull}
        >
          {loadingSource === "pull" ? "Pulling…" : `Pull ${opponentName}'s roster`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loadingSource !== null}
          onClick={handlePrior}
        >
          {loadingSource === "prior" ? "Loading…" : "Use prior lineup"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loadingSource !== null}
          onClick={() => setDraft(buildEmpty())}
        >
          Clear / build new
        </Button>
        {!canPull && opponentTeamId === null && (
          <p className="text-xs text-muted-foreground">
            {opponentName} isn't on Statly yet — type their lineup below.
          </p>
        )}
        {opponentTeamId !== null && opponentIsPublicRoster === false && (
          <p className="text-xs text-muted-foreground">
            {opponentName} has hidden their roster.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {draft.map((slot, i) => (
          <div key={slot.batting_order} className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-1 text-right font-mono-stat font-bold text-sa-blue-deep">
              {slot.batting_order}
            </div>
            <div className="col-span-2">
              <Input
                placeholder="#"
                value={slot.jersey_number ?? ""}
                onChange={(e) => updateSlot(i, { jersey_number: e.target.value || null })}
                className={!slotHasIdentity(slot) ? "border-amber-300" : ""}
              />
            </div>
            <div className="col-span-5">
              <Input
                placeholder="Last name"
                value={slot.last_name ?? ""}
                onChange={(e) => updateSlot(i, { last_name: e.target.value || null })}
                className={!slotHasIdentity(slot) ? "border-amber-300" : ""}
              />
            </div>
            <div className="col-span-4">
              <Select
                value={slot.position ?? ""}
                onValueChange={(v) => updateSlot(i, { position: v || null })}
              >
                <SelectTrigger className={!slot.position ? "border-amber-300" : ""}>
                  <SelectValue placeholder="position" />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.filter((p) => {
                    if (p === slot.position) return true;
                    if (p === "DH" && !useDh) return false;
                    // Hide the DH-covered position from batting-order slots
                    // — that position is filled by the standalone box.
                    if (useDh && dhCoversPos !== "P" && p === dhCoversPos) return false;
                    return true;
                  }).map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Each slot needs a jersey number or last name and a defensive position.
          All 9 fielding positions (P, C, 1B, 2B, 3B, SS, LF, CF, RF) must be assigned.
        </p>
      </div>

      {useDh && !hidePitcher && (
        <div>
          <Label>
            {dhCoversPos === "P"
              ? "Opposing starting pitcher"
              : `Opposing player at ${dhCoversPos} (their DH hits for them)`}
          </Label>
          <div className="grid grid-cols-12 gap-2">
            {setDhCoversPos && (
              <div className="col-span-3">
                <Select value={dhCoversPos} onValueChange={(v) => setDhCoversPos(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {POSITIONS.filter((p) => p !== "DH").map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="col-span-3">
              <Input
                placeholder="#"
                value={opposingPitcherJersey}
                onChange={(e) => setOpposingPitcherJersey(e.target.value)}
              />
            </div>
            <div className={setDhCoversPos ? "col-span-6" : "col-span-9"}>
              <Input
                placeholder="Last name (e.g., Smith)"
                value={opposingPitcherName}
                onChange={(e) => setOpposingPitcherName(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {dhCoversPos === "P"
              ? "DH bats; opposing pitcher doesn't bat."
              : `DH bats; the player at ${dhCoversPos} fields but doesn't bat. The opposing pitcher must be tagged P in one of the batting slots above.`}
          </p>
        </div>
      )}
    </section>
  );
}

function padToNine(slots: OpposingSlotDraft[]): OpposingSlotDraft[] {
  if (slots.length >= 9) return slots.slice(0, 9);
  const padded = [...slots];
  while (padded.length < 9) {
    padded.push({
      batting_order: padded.length + 1,
      opponent_player_id: null,
      external_player_id: null,
      opponent_team_id: null,
      jersey_number: null,
      first_name: null,
      last_name: null,
      position: null,
      is_dh: false,
    });
  }
  // Renumber so batting_order matches array index after a partial pull.
  return padded.map((s, i) => ({ ...s, batting_order: i + 1 }));
}
