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
const FIELDING_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

interface Props {
  myTeamId: string;
  gameId: string;
  gameDate: string;
  opponentName: string;
  opponentTeamId: string | null;
  opponentIsPublicRoster: boolean | null;
  draft: OpposingSlotDraft[];
  setDraft: (d: OpposingSlotDraft[]) => void;
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
  opposingPitcherName,
  setOpposingPitcherName,
  opposingPitcherJersey,
  setOpposingPitcherJersey,
  dhCoversPos = "P",
  setDhCoversPos,
  hidePitcher = false,
}: Props) {
  // DH usage is inferred from the draft: a slot tagged "DH" means we're
  // using a DH. A slot tagged "P" means the pitcher bats; otherwise the
  // standalone box below holds the pitcher.
  const hasP = draft.some((s) => s.position === "P");
  const hasDH = draft.some((s) => s.position === "DH");
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
      <h4 className="font-display text-sm uppercase tracking-wider text-sa-blue">
        Opposing lineup ({opponentName})
      </h4>

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
                    // When DH and P are both tagged, the dhCoversPos is
                    // filled by the standalone fielder-only player; no
                    // batter holds it.
                    if (hasDH && hasP && p === dhCoversPos) return false;
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

      {!hidePitcher && hasP && !hasDH && (() => {
        const pSlot = draft.find((s) => s.position === "P");
        const display = pSlot
          ? [
              pSlot.jersey_number ? `#${pSlot.jersey_number}` : null,
              pSlot.last_name?.trim() || null,
            ].filter(Boolean).join(" ")
          : "";
        return (
          <div className="opacity-60">
            <Label className="text-muted-foreground">Opposing starting pitcher</Label>
            <div className="text-sm mt-1">
              {display || "In batting order"} — slot {pSlot?.batting_order ?? "?"}, in lineup.
            </div>
          </div>
        );
      })()}

      {!hidePitcher && !hasP && hasDH && (
        <div>
          <Label>Opposing starting pitcher (DH hits for them)</Label>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-3">
              <Input
                placeholder="#"
                value={opposingPitcherJersey}
                onChange={(e) => setOpposingPitcherJersey(e.target.value)}
              />
            </div>
            <div className="col-span-9">
              <Input
                placeholder="Last name (e.g., Smith)"
                value={opposingPitcherName}
                onChange={(e) => setOpposingPitcherName(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            DH bats; opposing pitcher doesn't bat.
          </p>
        </div>
      )}

      {!hidePitcher && hasP && hasDH && setDhCoversPos && (() => {
        const lineupPositions = new Set(
          draft.map((s) => s.position).filter(Boolean) as string[],
        );
        return (
          <div>
            <Label>DH hits for</Label>
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-3">
                <Select value={dhCoversPos} onValueChange={(v) => setDhCoversPos(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELDING_POSITIONS.filter((p) => p !== "P" && (p === dhCoversPos || !lineupPositions.has(p))).map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Input
                  placeholder="#"
                  value={opposingPitcherJersey}
                  onChange={(e) => setOpposingPitcherJersey(e.target.value)}
                />
              </div>
              <div className="col-span-6">
                <Input
                  placeholder="Last name (e.g., Smith)"
                  value={opposingPitcherName}
                  onChange={(e) => setOpposingPitcherName(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              DH bats; the player at {dhCoversPos} fields but doesn't bat.
            </p>
          </div>
        );
      })()}

      {!hidePitcher && !hasP && !hasDH && (
        <div className="opacity-60">
          <Label className="text-muted-foreground">Opposing starting pitcher</Label>
          <p className="text-sm mt-1 text-amber-600">
            Tag a batting slot as P or DH to continue.
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
