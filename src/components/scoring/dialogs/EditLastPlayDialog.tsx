"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { replay } from "@/lib/scoring/replay";
import { defaultAdvances } from "@/lib/scoring/advances";
import {
  HITS,
  NON_CONTACT,
  OTHER_IN_PLAY,
  OUTS_IN_PLAY,
  PRODUCTIVE,
  RARE_OUTCOMES,
  RESULT_DESC,
  RESULT_LABEL,
  autoRBI,
  describePlay,
} from "@/lib/scoring/at-bat-helpers";
import type {
  AtBatPayload,
  AtBatResult,
  Bases,
  CorrectionPayload,
  DerivedAtBat,
  GameEventRecord,
  RunnerAdvance,
} from "@/lib/scoring/types";

const supabase = createClient();

const EDIT_RESULTS: AtBatResult[] = [
  ...NON_CONTACT,
  ...RARE_OUTCOMES,
  ...HITS,
  ...OUTS_IN_PLAY,
  ...OTHER_IN_PLAY,
  ...PRODUCTIVE,
];

type AdvanceDest = "first" | "second" | "third" | "home" | "out" | "held";
type AdvanceSource = "batter" | "first" | "second" | "third";

interface EditableAdvance {
  source: AdvanceSource;
  player_id: string | null;
  dest: AdvanceDest;
}

const DEST_LABEL: Record<AdvanceDest, string> = {
  first: "1st",
  second: "2nd",
  third: "3rd",
  home: "Home",
  out: "Out",
  held: "Held",
};

function sourceLabel(source: AdvanceSource): string {
  if (source === "batter") return "Batter";
  if (source === "first") return "On 1st";
  if (source === "second") return "On 2nd";
  return "On 3rd";
}

// Build editable advance rows from bases-before plus the batter, seeded
// from a runner_advances list (defaults or existing).
function seedAdvances(
  basesBefore: Bases,
  batterId: string | null,
  seed: RunnerAdvance[],
): EditableAdvance[] {
  const sources: { source: AdvanceSource; player_id: string | null }[] = [
    { source: "batter", player_id: batterId },
  ];
  if (basesBefore.third) sources.push({ source: "third", player_id: basesBefore.third.player_id });
  if (basesBefore.second) sources.push({ source: "second", player_id: basesBefore.second.player_id });
  if (basesBefore.first) sources.push({ source: "first", player_id: basesBefore.first.player_id });

  return sources.map((s) => {
    const match = seed.find((a) => a.from === s.source);
    let dest: AdvanceDest = "held";
    if (match) {
      if (match.to === "home") dest = "home";
      else if (match.to === "out") dest = "out";
      else dest = match.to;
    } else if (s.source === "batter") {
      // Batter wasn't placed by the seed — must be an out (e.g., K, FO).
      dest = "out";
    }
    return { source: s.source, player_id: s.player_id, dest };
  });
}

function editableToRunnerAdvances(rows: EditableAdvance[]): RunnerAdvance[] {
  const out: RunnerAdvance[] = [];
  for (const r of rows) {
    if (r.dest === "held") continue;
    out.push({
      from: r.source,
      to: r.dest,
      player_id: r.player_id,
    });
  }
  return out;
}

function Counter({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground w-12">{label}</span>
      <Button size="sm" variant="outline" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>−</Button>
      <span className="font-mono-stat text-xl w-6 text-center">{value}</span>
      <Button size="sm" variant="outline" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</Button>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  gameId: string;
  lastAtBat: DerivedAtBat | null;
  names: Map<string, string>;
  onSubmit: (supersededEventId: string, correctedAtBat: AtBatPayload) => void;
  disabled: boolean;
}

export function EditLastPlayDialog({
  open,
  onOpenChange,
  gameId,
  lastAtBat,
  names,
  onSubmit,
  disabled,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [basesBefore, setBasesBefore] = useState<Bases | null>(null);
  const [result, setResult] = useState<AtBatResult | null>(null);
  const [balls, setBalls] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [advances, setAdvances] = useState<EditableAdvance[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load bases-before whenever the dialog opens for a fresh at-bat.
  useEffect(() => {
    if (!open || !lastAtBat) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: e } = await supabase
        .from("game_events")
        .select("*")
        .eq("game_id", gameId)
        .order("sequence_number", { ascending: true });
      if (!active) return;
      if (e) {
        setError(`Couldn't load events: ${e.message}`);
        setLoading(false);
        return;
      }
      const events = (data ?? []) as unknown as GameEventRecord[];
      const target = events.find((ev) => ev.id === lastAtBat.event_id);
      if (!target) {
        setError("Couldn't find the original event.");
        setLoading(false);
        return;
      }
      // For chained edits, lastAtBat.event_id is the previous correction's
      // id. The original at_bat (and any earlier corrections) are in the
      // event log with seq < target.seq but are superseded by later
      // corrections. Strip those out so replay() yields bases-BEFORE the
      // play we're editing, not bases-AFTER an old version of it.
      const supersededIds = new Set<string>();
      for (const ev of events) {
        if (ev.event_type === "correction") {
          const p = ev.payload as CorrectionPayload;
          supersededIds.add(p.superseded_event_id);
        }
      }
      const before = events.filter(
        (ev) =>
          ev.sequence_number < target.sequence_number
          && !supersededIds.has(ev.id),
      );
      const stateBefore = replay(before);
      setBasesBefore(stateBefore.bases);
      setResult(lastAtBat.result);
      setBalls(lastAtBat.balls);
      setStrikes(lastAtBat.strikes);
      setAdvances(seedAdvances(stateBefore.bases, lastAtBat.batter_id, lastAtBat.runner_advances));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [open, lastAtBat, gameId]);

  const onResultChange = (r: AtBatResult) => {
    setResult(r);
    if (basesBefore && lastAtBat) {
      const seeded = defaultAdvances(basesBefore, lastAtBat.batter_id, r);
      setAdvances(seedAdvances(basesBefore, lastAtBat.batter_id, seeded));
    }
  };

  const setRowDest = (idx: number, dest: AdvanceDest) => {
    setAdvances((prev) => prev.map((row, i) => (i === idx ? { ...row, dest } : row)));
  };

  const handleSubmit = () => {
    if (!lastAtBat || !result) return;
    const newAdvances = editableToRunnerAdvances(advances);
    const rbi = basesBefore
      ? autoRBI(newAdvances, result, basesBefore)
      : newAdvances.filter((a) => a.to === "home").length;
    const corrected: AtBatPayload = {
      inning: lastAtBat.inning,
      half: lastAtBat.half,
      batter_id: lastAtBat.batter_id,
      pitcher_id: lastAtBat.pitcher_id,
      opponent_pitcher_id: lastAtBat.opponent_pitcher_id,
      batting_order: lastAtBat.batting_order,
      result,
      rbi,
      pitch_count: balls + strikes,
      balls,
      strikes,
      spray_x: lastAtBat.spray_x,
      spray_y: lastAtBat.spray_y,
      fielder_position: lastAtBat.fielder_position,
      runner_advances: newAdvances,
      description: describePlay(result, rbi, lastAtBat.batter_id, names),
    };
    onSubmit(lastAtBat.event_id, corrected);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit last play</DialogTitle>
          <DialogDescription>
            Adjust the result, count, and runner movement. Spray location and fielder carry
            forward; re-record the play from scratch if those need to change.
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}
        {error && <p className="text-sm text-destructive py-2">{error}</p>}
        {!loading && !error && lastAtBat && result && (
          <div className="space-y-4 py-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Result</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {EDIT_RESULTS.map((r) => (
                  <Button
                    key={r}
                    variant={r === result ? "default" : "outline"}
                    disabled={disabled}
                    onClick={() => onResultChange(r)}
                    className="h-10 font-bold"
                    title={RESULT_DESC[r] ?? r}
                  >
                    {RESULT_LABEL[r]}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Count</p>
              <div className="flex items-center gap-6">
                <Counter label="Balls" max={4} value={balls} onChange={setBalls} />
                <Counter label="Strikes" max={3} value={strikes} onChange={setStrikes} />
                <span className="font-mono-stat text-xl text-sa-blue-deep">{balls}-{strikes}</span>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Runner movement</p>
              <div className="space-y-2">
                {advances.map((row, i) => {
                  const who = row.player_id ? names.get(row.player_id) ?? "—" : sourceLabel(row.source);
                  return (
                    <div key={`${row.source}-${i}`} className="grid grid-cols-12 items-center gap-2">
                      <div className="col-span-5 text-sm">
                        <span className="text-xs uppercase tracking-wider text-muted-foreground">{sourceLabel(row.source)}</span>
                        {row.player_id && (
                          <span className="ml-2 font-semibold text-sa-blue-deep">{who}</span>
                        )}
                      </div>
                      <div className="col-span-7">
                        <Select value={row.dest} onValueChange={(v) => setRowDest(i, v as AdvanceDest)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(DEST_LABEL) as AdvanceDest[]).map((d) => (
                              <SelectItem key={d} value={d}>{DEST_LABEL[d]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
                {advances.length === 0 && (
                  <p className="text-xs text-muted-foreground">No runners.</p>
                )}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={disabled || loading || !!error || !result}
            onClick={handleSubmit}
            className="bg-sa-orange hover:bg-sa-orange/90"
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
