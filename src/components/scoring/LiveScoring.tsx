"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { replay } from "@/lib/scoring/replay";
import { defaultAdvances } from "@/lib/scoring/advances";
import { INITIAL_STATE } from "@/lib/scoring/types";
import type {
  AtBatPayload,
  AtBatResult,
  Bases,
  CaughtStealingPayload,
  CorrectionPayload,
  DerivedAtBat,
  GameEventRecord,
  K3ReachSource,
  PickoffPayload,
  PitchPayload,
  PitchType,
  PitchingChangePayload,
  ReplayState,
  RunnerAdvance,
  RunnerMovePayload,
  StolenBasePayload,
  SubstitutionPayload,
} from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";
import { DefensiveDiamond, type FielderPosition } from "@/components/scoring/DefensiveDiamond";
import { LiveSprayChart } from "@/components/scoring/LiveSprayChart";
import { OpposingBatterPanel } from "@/components/score/OpposingBatterPanel";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";
import { EditOpposingLineupDialog } from "@/components/scoring/EditOpposingLineupDialog";
import type { OpposingLineupSlot } from "@/lib/scoring/types";
import { GameStatusBar } from "@/components/scoring/GameStatusBar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export interface RosterDisplay {
  id: string;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
}

interface LiveScoringProps {
  gameId: string;
  roster: RosterDisplay[];
  teamShortLabel: string;
  opponentName: string;
  schoolId: string;
  myTeamId: string;
  gameDate: string;
  opponentTeamId: string | null;
}

function nameById(roster: RosterDisplay[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of roster) {
    const num = p.jersey_number ? `#${p.jersey_number} ` : "";
    m.set(p.id, `${num}${p.first_name} ${p.last_name}`);
  }
  return m;
}

const supabase = createClient();

// Non-contact outcomes are one-tap. In-play outcomes arm drag mode on the
// defensive diamond — the user drags the fielder who made the play to the
// ball location, and the drop captures spray (x, y) + fielder_position.
const NON_CONTACT: AtBatResult[] = ["K_swinging", "K_looking", "BB", "IBB", "HBP", "CI"];
const HITS: AtBatResult[] = ["1B", "2B", "3B", "HR"];
const OUTS_IN_PLAY: AtBatResult[] = ["FO", "GO", "LO", "PO"];
// FC and E are in-play with a fielder location; the rest are productive outs
// or multi-out plays that don't need spray.
const OTHER_IN_PLAY: AtBatResult[] = ["FC", "E"];
const PRODUCTIVE: AtBatResult[] = ["SAC", "SF", "DP", "TP"];
const IN_PLAY: AtBatResult[] = [...HITS, ...OUTS_IN_PLAY, ...OTHER_IN_PLAY];
const isInPlay = (r: AtBatResult) => (IN_PLAY as AtBatResult[]).includes(r);

// Auto-RBI from a runner-advance plan, applying PDF §7 exclusions:
// no RBI on errors or GIDP, and no RBI for a run scoring from a base
// where the runner reached on an error (or PB advancement).
function autoRBI(
  advances: RunnerAdvance[],
  result: AtBatResult,
  basesBefore: Bases,
): number {
  if (result === "E" || result === "DP") return 0;
  let count = 0;
  for (const adv of advances) {
    if (adv.to !== "home") continue;
    if (adv.from === "batter") {
      // Batter himself reached and circled (HR or chained advances).
      // PDF: HR always RBI. Other batter-to-home cases inherit the
      // result's RBI eligibility (E/DP already excluded above).
      count += 1;
    } else {
      const src = basesBefore[adv.from];
      if (src && !src.reached_on_error) count += 1;
    }
  }
  return count;
}

const RESULT_LABEL: Record<AtBatResult, string> = {
  K_swinging: "K↘", K_looking: "Kᴸ",
  BB: "BB", IBB: "IBB", HBP: "HBP",
  "1B": "1B", "2B": "2B", "3B": "3B", HR: "HR",
  FO: "Fly out", GO: "Ground out", LO: "Line out", PO: "Popout", IF: "Infield fly",
  FC: "FC", SAC: "SAC", SF: "SF", E: "Error", DP: "DP", TP: "TP",
  CI: "CI",
};

const RESULT_DESC: Partial<Record<AtBatResult, string>> = {
  K_swinging: "Strikeout swinging",
  K_looking: "Strikeout looking",
  BB: "Walk", IBB: "Intentional walk", HBP: "Hit by pitch",
  "1B": "Single", "2B": "Double", "3B": "Triple", HR: "Home run",
  FO: "Flyout", GO: "Groundout", LO: "Lineout", PO: "Popout", IF: "Infield fly",
  FC: "Fielder's choice", E: "Reached on error",
  SAC: "Sacrifice bunt", SF: "Sacrifice fly",
  DP: "Double play", TP: "Triple play",
  CI: "Catcher's interference",
};

export function LiveScoring({
  gameId,
  roster,
  teamShortLabel,
  opponentName,
  schoolId,
  myTeamId,
  gameDate,
  opponentTeamId,
}: LiveScoringProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [state, setState] = useState<ReplayState>(INITIAL_STATE);
  const [events, setEvents] = useState<GameEventRecord[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [pitchChangeOpen, setPitchChangeOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [opposingLineupEditOpen, setOpposingLineupEditOpen] = useState(false);
  const [boxScoreOpen, setBoxScoreOpen] = useState(false);
  const [armedResult, setArmedResult] = useState<AtBatResult | null>(null);
  const [runnerAction, setRunnerAction] = useState<{
    base: "first" | "second" | "third";
    runnerId: string | null;
  } | null>(null);
  const names = useMemo(() => nameById(roster), [roster]);
  // Cache opposing-batter profiles across batter changes so cycling through
  // a 9-deep lineup doesn't refetch the same profiles on every loop.
  const opposingProfileCache = useRef(new Map<string, OpposingBatterProfile>());

  // Box score defaults open on desktop, collapsed on mobile. `useIsMobile`
  // returns false on the SSR pass; sync once the breakpoint is known.
  useEffect(() => {
    setBoxScoreOpen(!isMobile);
  }, [isMobile]);

  // Load all events for this game and run replay() to get the canonical
  // live state. Cheap — Phase 1 has at most a few hundred events per game.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("game_events")
        .select("*")
        .eq("game_id", gameId)
        .order("sequence_number", { ascending: true });
      if (!active) return;
      if (error) {
        toast.error(`Couldn't load events: ${error.message}`);
        setLoading(false);
        return;
      }
      const events = (data ?? []) as unknown as GameEventRecord[];
      setState(replay(events));
      setEvents(events);
      setLastSeq(events.reduce((m, e) => Math.max(m, e.sequence_number), 0));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [gameId]);

  const weAreBatting = state.current_batter_slot !== null && isOurHalf(state.we_are_home, state.half);
  const currentSlot = useMemo(
    () => state.our_lineup.find((s) => s.batting_order === state.current_batter_slot) ?? null,
    [state.our_lineup, state.current_batter_slot],
  );
  const currentOppSlot = useMemo(
    () => state.opposing_lineup.find((s) => s.batting_order === state.current_opp_batter_slot) ?? null,
    [state.opposing_lineup, state.current_opp_batter_slot],
  );
  const currentOpponentBatterId = !weAreBatting ? currentOppSlot?.opponent_player_id ?? null : null;

  // The most recent event a coach can revert. Walks the event log backwards,
  // skipping void/correction events and events already superseded by a prior
  // correction. `game_started` is intentionally not undoable from the live
  // screen (un-finalize lives on the FinalStub).
  const lastUndoableEvent = useMemo(() => {
    const supersededIds = new Set<string>();
    for (const ev of events) {
      if (ev.event_type === "correction") {
        const p = ev.payload as CorrectionPayload;
        supersededIds.add(p.superseded_event_id);
      }
    }
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.event_type === "correction") continue;
      if (supersededIds.has(ev.id)) continue;
      if (ev.event_type === "game_started") return null;
      return ev;
    }
    return null;
  }, [events]);

  const onOutcomePicked = (result: AtBatResult) => {
    if (submitting) return;
    if (isInPlay(result)) {
      // Arm drag mode on the diamond; drop will capture spray + fielder.
      setArmedResult(result);
      return;
    }
    void submitAtBat(result, null);
  };

  // If a posted event caused outs to cross 3, auto-emit `inning_end` so the
  // coach doesn't have to tap End ½ inning every half. Undo can revert this
  // if a CS / pickoff for the 3rd out had follow-up the coach still wants
  // to record.
  const maybeAutoEndHalf = async (
    prevOuts: number,
    snap: { state: ReplayState; events: GameEventRecord[] },
  ) => {
    if (prevOuts >= 3) return;
    if (snap.state.outs < 3) return;
    if (snap.state.status !== "in_progress") return;
    const nextSeq = snap.events.reduce((m, e) => Math.max(m, e.sequence_number), 0) + 1;
    const halfLabel = snap.state.half === "top" ? "Top" : "Bot";
    const inning = snap.state.inning;
    const ok = await postEvent(gameId, {
      client_event_id: `ie-auto-${inning}-${snap.state.half}-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "inning_end",
      payload: { inning, half: snap.state.half },
    });
    if (!ok) return;
    toast.success(`End ${halfLabel} ${inning}. Tap Undo to revert.`);
    await refresh();
  };

  const submitAtBat = async (
    result: AtBatResult,
    spray: { x: number; y: number; fielder: FielderPosition } | null,
    k3Reach?: K3ReachSource,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    const prevOuts = state.outs;
    const batterId = weAreBatting ? currentSlot?.player_id ?? null : null;
    // K3-reach: pitcher gets the K, batter goes to first instead of being out.
    // Override defaultAdvances with an explicit batter→first plan; downstream
    // RBI logic excludes runs from the tainted batter (E/PB) automatically.
    const advances = k3Reach
      ? [{ from: "batter" as const, to: "first" as const, player_id: batterId }]
      : defaultAdvances(state.bases, batterId, result);
    const runs = advances.filter((a) => a.to === "home").length;
    const rbi = autoRBI(advances, result, state.bases);
    // If pitches are logged for this PA, the engine will derive the final
    // count from them — pass the live values along anyway as a hint, with
    // finalCount() as the no-pitch-trail fallback.
    const trailEmpty = state.current_pa_pitches.length === 0;
    const { balls: finalBalls, strikes: finalStrikes } = trailEmpty
      ? finalCount(result, state.current_balls, state.current_strikes)
      : { balls: state.current_balls, strikes: state.current_strikes };

    const payload: AtBatPayload = {
      inning: state.inning,
      half: state.half,
      batter_id: weAreBatting ? currentSlot?.player_id ?? null : null,
      opponent_batter_id: currentOpponentBatterId,
      pitcher_id: weAreBatting ? null : state.current_pitcher_id,
      opponent_pitcher_id: weAreBatting ? state.current_opponent_pitcher_id : null,
      batting_order: weAreBatting ? state.current_batter_slot : state.current_opp_batter_slot,
      result,
      rbi,
      pitch_count: finalBalls + finalStrikes,
      balls: finalBalls,
      strikes: finalStrikes,
      spray_x: spray?.x ?? null,
      spray_y: spray?.y ?? null,
      fielder_position: spray?.fielder ?? null,
      runner_advances: advances,
      description: describePlay(result, runs, currentSlot?.player_id ?? null, names),
      batter_reached_on_k3: k3Reach,
    };

    const nextSeq = lastSeq + 1;
    const clientEventId = `ab-${state.inning}-${state.half}-${nextSeq}`;
    const ok = await postEvent(gameId, {
      client_event_id: clientEventId,
      sequence_number: nextSeq,
      event_type: "at_bat",
      payload,
    });
    if (!ok) {
      setSubmitting(false);
      return;
    }
    // The just-recorded PA changes this opponent's career line. Drop the
    // cached profile so the next cycle through the lineup refetches.
    if (!weAreBatting && currentOpponentBatterId) {
      opposingProfileCache.current.delete(currentOpponentBatterId);
    }
    setArmedResult(null);
    const snap = await refresh();
    if (snap) await maybeAutoEndHalf(prevOuts, snap);
    setSubmitting(false);
  };

  // If this pitch closes the at-bat, auto-emit the corresponding outcome
  // with the next sequence number so the coach doesn't have to tap BB/K/HBP
  // after filling the count. Foul-with-2-strikes and in-play never close
  // the AB. Intentional ball 4 → IBB; pitchout/ball 4 → BB.
  const closingResultForPitch = (pitchType: PitchType): AtBatResult | null => {
    if (pitchType === "ball" && state.current_balls === 3) return "BB";
    if (pitchType === "pitchout" && state.current_balls === 3) return "BB";
    if (pitchType === "intentional_ball" && state.current_balls === 3) return "IBB";
    if (pitchType === "called_strike" && state.current_strikes === 2) return "K_looking";
    if (pitchType === "swinging_strike" && state.current_strikes === 2) return "K_swinging";
    if (pitchType === "foul_tip_caught" && state.current_strikes === 2) return "K_swinging";
    if (pitchType === "hbp") return "HBP";
    return null;
  };

  const submitPitch = async (pitchType: PitchType) => {
    if (submitting) return;
    setSubmitting(true);
    const prevOuts = state.outs;
    const baseSeq = lastSeq + 1;
    const okPitch = await postEvent(gameId, {
      client_event_id: `pitch-${baseSeq}`,
      sequence_number: baseSeq,
      event_type: "pitch",
      payload: { pitch_type: pitchType },
    });
    if (!okPitch) {
      setSubmitting(false);
      return;
    }

    const closing = closingResultForPitch(pitchType);
    if (closing) {
      // The engine prefers the pitch trail over the payload balls/strikes
      // when deriving the AB count; we still pass finalCount as a fallback.
      const batterId = weAreBatting ? currentSlot?.player_id ?? null : null;
      const advances = defaultAdvances(state.bases, batterId, closing);
      const runs = advances.filter((a) => a.to === "home").length;
      const rbi = autoRBI(advances, closing, state.bases);
      const fallback = finalCount(closing, state.current_balls, state.current_strikes);
      const abPayload: AtBatPayload = {
        inning: state.inning,
        half: state.half,
        batter_id: batterId,
        opponent_batter_id: currentOpponentBatterId,
        pitcher_id: weAreBatting ? null : state.current_pitcher_id,
        opponent_pitcher_id: weAreBatting ? state.current_opponent_pitcher_id : null,
        batting_order: weAreBatting ? state.current_batter_slot : state.current_opp_batter_slot,
        result: closing,
        rbi,
        pitch_count: fallback.balls + fallback.strikes,
        balls: fallback.balls,
        strikes: fallback.strikes,
        spray_x: null,
        spray_y: null,
        fielder_position: null,
        runner_advances: advances,
        description: describePlay(closing, runs, batterId, names),
      };
      const okAB = await postEvent(gameId, {
        client_event_id: `ab-auto-${state.inning}-${state.half}-${baseSeq + 1}`,
        sequence_number: baseSeq + 1,
        event_type: "at_bat",
        payload: abPayload,
      });
      if (!okAB) {
        // Pitch persisted but the auto-AB didn't. Refresh so the count
        // updates; coach can tap the outcome manually to finish the PA.
        await refresh();
        setSubmitting(false);
        return;
      }
    }

    const snap = await refresh();
    if (snap) await maybeAutoEndHalf(prevOuts, snap);
    setSubmitting(false);
  };

  const onFielderDrop = (x: number, y: number, fielder: FielderPosition) => {
    if (!armedResult) return;
    void submitAtBat(armedResult, { x, y, fielder });
  };

  const submitMidPA = async (
    eventType: GameEventType,
    payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload,
    clientPrefix: string,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    const prevOuts = state.outs;
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `${clientPrefix}-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: eventType,
      payload,
    });
    setRunnerAction(null);
    if (!ok) {
      setSubmitting(false);
      return;
    }
    const snap = await refresh();
    if (snap) await maybeAutoEndHalf(prevOuts, snap);
    setSubmitting(false);
  };

  const endHalfInning = async () => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `ie-${state.inning}-${state.half}-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "inning_end",
      payload: { inning: state.inning, half: state.half },
    });
    setSubmitting(false);
    if (!ok) return;
    await refresh();
  };

  // In a non-DH game, the new pitcher must occupy a slot in the batting
  // order. If they're not in the lineup yet, we substitute them into the
  // outgoing pitcher's slot and then record the pitching change. If they're
  // already in the lineup as a fielder, we substitute their slot's position
  // to "P" so the diamond and stats reflect the change.
  const submitPitchingChange = async (newPitcherId: string) => {
    if (submitting) return;
    if (newPitcherId === state.current_pitcher_id) return;
    setSubmitting(true);

    const lineupSlotOf = (pid: string | null) =>
      state.our_lineup.find((s) => s.player_id === pid) ?? null;
    const oldSlot = lineupSlotOf(state.current_pitcher_id);
    const newSlot = lineupSlotOf(newPitcherId);

    let leadingSub: SubstitutionPayload | null = null;
    if (!state.use_dh) {
      if (newSlot) {
        // New pitcher is already in the lineup as a fielder — retitle his
        // slot's position to P so the diamond reflects it.
        leadingSub = {
          out_player_id: newPitcherId,
          in_player_id: newPitcherId,
          batting_order: newSlot.batting_order,
          position: "P",
          sub_type: "regular",
        };
      } else if (oldSlot) {
        // New pitcher is on the bench — replace the outgoing pitcher in his
        // batting slot.
        leadingSub = {
          out_player_id: state.current_pitcher_id!,
          in_player_id: newPitcherId,
          batting_order: oldSlot.batting_order,
          position: "P",
          sub_type: "regular",
        };
      }
    }

    let nextSeq = lastSeq + 1;
    if (leadingSub) {
      const okSub = await postEvent(gameId, {
        client_event_id: `sub-pc-${nextSeq}`,
        sequence_number: nextSeq,
        event_type: "substitution",
        payload: leadingSub,
      });
      if (!okSub) {
        setSubmitting(false);
        return;
      }
      nextSeq += 1;
    }

    const payload: PitchingChangePayload = {
      out_pitcher_id: state.current_pitcher_id,
      in_pitcher_id: newPitcherId,
    };
    const ok = await postEvent(gameId, {
      client_event_id: `pc-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "pitching_change",
      payload,
    });
    setSubmitting(false);
    setPitchChangeOpen(false);
    if (!ok) return;
    toast.success(`Pitcher: ${names.get(newPitcherId) ?? "updated"}`);
    await refresh();
  };

  const submitMoundVisit = async () => {
    if (submitting) return;
    if (!state.current_pitcher_id) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `dc-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "defensive_conference",
      payload: {
        pitcher_id: state.current_pitcher_id,
        inning: state.inning,
      },
    });
    setSubmitting(false);
    if (!ok) return;
    // After the conference is recorded, alert at the warning thresholds.
    // Count is post-event since refresh() will re-fold from the server.
    const newCount = state.defensive_conferences.filter(
      (c) => c.pitcher_id === state.current_pitcher_id,
    ).length + 1;
    if (newCount >= 4) {
      toast.warning("4th conference — pitcher must be removed (NFHS 3-4-1)");
      setPitchChangeOpen(true);
    } else if (newCount === 3) {
      toast.warning("3rd conference — next visit forces a pitching change");
    }
    await refresh();
  };

  const submitSubstitution = async (payload: SubstitutionPayload) => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `sub-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "substitution",
      payload,
    });
    setSubmitting(false);
    setSubOpen(false);
    if (!ok) return;
    toast.success(`Sub: ${names.get(payload.in_player_id) ?? "updated"} → slot ${payload.batting_order}`);
    await refresh();
  };

  // Edit the most recent at-bat by issuing a correction event. Receives a
  // fully-built corrected payload from the edit dialog (result, count, and
  // per-runner advances all editable). The dialog owns the bases-before
  // calculation so the user can see and override runner movement.
  const editLastPlay = async (
    supersededEventId: string,
    correctedAtBat: AtBatPayload,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    const correction: CorrectionPayload = {
      superseded_event_id: supersededEventId,
      corrected_event_type: "at_bat",
      corrected_payload: correctedAtBat,
    };
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `corr-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "correction",
      payload: correction,
    });
    setSubmitting(false);
    setEditOpen(false);
    if (!ok) return;
    toast.success("Last play updated");
    await refresh();
  };

  const finalize = async () => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `gf-${gameId}`,
      sequence_number: nextSeq,
      event_type: "game_finalized",
      payload: {},
    });
    setSubmitting(false);
    setConfirmFinalize(false);
    if (!ok) return;
    toast.success("Game finalized");
    // Parent page reads game.status from the games table; trigger a refetch.
    router.refresh();
  };

  // One-tap undo. Posts a void correction superseding the most recent live
  // event (skipping prior corrections + their targets). Undoing a corrected
  // at_bat removes BOTH the original and the correction from replay — the
  // coach goes back to before the play was recorded, which matches the
  // mental model of "step further back."
  const submitUndo = async () => {
    if (submitting || !lastUndoableEvent) return;
    setSubmitting(true);
    const target = lastUndoableEvent;
    const label = describeEvent(target, names);
    const nextSeq = lastSeq + 1;
    const ok = await postEvent(gameId, {
      client_event_id: `undo-${nextSeq}`,
      sequence_number: nextSeq,
      event_type: "correction",
      payload: {
        superseded_event_id: target.id,
        corrected_event_type: null,
        corrected_payload: null,
      } as CorrectionPayload,
    });
    if (!ok) {
      setSubmitting(false);
      return;
    }
    toast.success(`Undid: ${label}`);
    // Hold the submitting flag through refresh so `events` updates before
    // a fast double-tap can re-target the same event.
    await refresh();
    setSubmitting(false);
  };

  // Returns the new snapshot so callers can act on the post-refresh state
  // synchronously without waiting for React to flush the next render
  // (auto-end-half needs to compare prev vs new outs in the same tick).
  const refresh = async (): Promise<{ state: ReplayState; events: GameEventRecord[] } | null> => {
    const { data, error } = await supabase
      .from("game_events")
      .select("*")
      .eq("game_id", gameId)
      .order("sequence_number", { ascending: true });
    if (error) return null;
    const refreshed = (data ?? []) as unknown as GameEventRecord[];
    const newState = replay(refreshed);
    setState(newState);
    setEvents(refreshed);
    setLastSeq(refreshed.reduce((m, e) => Math.max(m, e.sequence_number), 0));
    return { state: newState, events: refreshed };
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading live state…</div>;
  }

  const currentBatterName = currentSlot?.player_id ? names.get(currentSlot.player_id) ?? null : null;
  const pitcherName = state.current_pitcher_id ? names.get(state.current_pitcher_id) ?? null : null;

  return (
    <div className="space-y-3">
      <GameStatusBar
        state={state}
        weAreBatting={weAreBatting}
        teamShortLabel={teamShortLabel}
        opponentName={opponentName}
        currentBatterName={currentBatterName}
        pitcherName={pitcherName}
        canUndo={lastUndoableEvent !== null && !submitting}
        onUndo={() => void submitUndo()}
        onOpenManage={() => setManageOpen(true)}
        lastPlayText={state.last_play_text}
      />

      <BoxScoreToggle open={boxScoreOpen} onToggle={() => setBoxScoreOpen((v) => !v)} />
      {boxScoreOpen && <LineScore state={state} />}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        <div className="space-y-3">
          {armedResult && (
            <div className="flex items-center justify-between flex-wrap gap-2 text-sm rounded-md border bg-muted/40 px-3 py-2">
              <span>
                <span className="text-muted-foreground">Recording </span>
                <span className="font-semibold text-sa-blue-deep">{RESULT_DESC[armedResult] ?? armedResult}</span>
                <span className="text-muted-foreground"> · drag the fielder who made the play to where the ball was.</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void submitAtBat(armedResult, null)}
                  disabled={submitting}
                >
                  Skip location
                </Button>
                <Button size="sm" variant="outline" onClick={() => setArmedResult(null)} disabled={submitting}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <DefensiveDiamond
            state={state}
            names={names}
            weAreBatting={weAreBatting}
            dragMode={!!armedResult && !submitting}
            onFielderDrop={onFielderDrop}
            onRunnerAction={(base, runnerId) => setRunnerAction({ base, runnerId })}
          />
          <PitchPad
            balls={state.current_balls}
            strikes={state.current_strikes}
            disabled={submitting || state.outs >= 3}
            onPitch={submitPitch}
          />
          <OutcomeGrid
            disabled={submitting || state.outs >= 3}
            onPick={onOutcomePicked}
            onK3Reach={(src) => void submitAtBat("K_swinging", null, src)}
            armedResult={armedResult}
          />
        </div>
        <aside className="lg:sticky lg:top-[6rem] lg:self-start space-y-4">
          {!weAreBatting && (
            <OpposingBatterPanel
              opponentPlayerId={currentOpponentBatterId}
              slotLabel={
                currentOppSlot
                  ? formatOpposingSlotLabel(currentOppSlot)
                  : "Set opposing lineup to track batters."
              }
              cache={opposingProfileCache.current}
            />
          )}
          <Card className="p-3">
            <h3 className="font-display text-sm uppercase tracking-wider text-sa-blue mb-2">Spray chart</h3>
            <LiveSprayChart state={state} />
          </Card>
        </aside>
      </div>

      <Sheet open={manageOpen} onOpenChange={setManageOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Manage game</SheetTitle>
            <SheetDescription>Runners, subs, edits, and finalize.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-5">
            <RunnersControls
              bases={state.bases}
              names={names}
              weAreBatting={weAreBatting}
              disabled={submitting}
              onSubmit={submitMidPA}
              onComplete={() => setManageOpen(false)}
            />
            <FlowControls
              onEndHalf={() => { void endHalfInning(); setManageOpen(false); }}
              onPitchingChange={() => { setPitchChangeOpen(true); setManageOpen(false); }}
              onSubstitution={() => { setSubOpen(true); setManageOpen(false); }}
              onEditLastPlay={() => { setEditOpen(true); setManageOpen(false); }}
              onEditOpposingLineup={() => { setOpposingLineupEditOpen(true); setManageOpen(false); }}
              onFinalize={() => { setConfirmFinalize(true); setManageOpen(false); }}
              onMoundVisit={() => { void submitMoundVisit(); setManageOpen(false); }}
              conferencesThisGame={
                state.defensive_conferences.filter(
                  (c) => c.pitcher_id === state.current_pitcher_id,
                ).length
              }
              disabled={submitting}
              outs={state.outs}
              canEdit={state.at_bats.length > 0}
            />
          </div>
        </SheetContent>
      </Sheet>
      <PitchingChangeDialog
        open={pitchChangeOpen}
        onOpenChange={setPitchChangeOpen}
        roster={roster}
        state={state}
        names={names}
        onPick={submitPitchingChange}
        disabled={submitting}
      />
      <SubstitutionDialog
        open={subOpen}
        onOpenChange={setSubOpen}
        state={state}
        roster={roster}
        names={names}
        onSubmit={submitSubstitution}
        disabled={submitting}
      />
      <EditLastPlayDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        gameId={gameId}
        lastAtBat={state.at_bats[state.at_bats.length - 1] ?? null}
        names={names}
        onSubmit={editLastPlay}
        disabled={submitting}
      />
      <FinalizeDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        state={state}
        onConfirm={finalize}
        disabled={submitting}
      />
      <RunnerActionDialog
        action={runnerAction}
        onClose={() => setRunnerAction(null)}
        names={names}
        bases={state.bases}
        onSubmit={submitMidPA}
        disabled={submitting}
      />
      <EditOpposingLineupDialog
        open={opposingLineupEditOpen}
        onOpenChange={setOpposingLineupEditOpen}
        gameId={gameId}
        schoolId={schoolId}
        myTeamId={myTeamId}
        gameDate={gameDate}
        opponentName={opponentName}
        opponentTeamId={opponentTeamId}
        currentLineup={state.opposing_lineup}
        currentOpponentUseDh={state.opponent_use_dh}
        nextSeq={lastSeq + 1}
        onSaved={async () => { await refresh(); }}
      />
    </div>
  );
}

// ---- Sub-components --------------------------------------------------------

function BoxScoreToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-xs uppercase tracking-wider text-muted-foreground hover:text-sa-orange inline-flex items-center gap-1"
    >
      {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      Box score
    </button>
  );
}

const HIT_RESULT_SET: ReadonlySet<AtBatResult> = new Set(["1B", "2B", "3B", "HR"]);

function LineScore({ state }: { state: ReplayState }) {
  const innings = Math.max(7, state.inning);
  // [inningIndex 0..n-1] -> per-side R/H/E.
  // An "E" result means the batter reached on error — credited to the
  // FIELDING team (our usE when fielding, oppE when batting).
  type Cell = { usR: number; oppR: number; usH: number; oppH: number; usE: number; oppE: number };
  const cells: Cell[] = Array.from({ length: innings }, () => ({
    usR: 0, oppR: 0, usH: 0, oppH: 0, usE: 0, oppE: 0,
  }));
  for (const ab of state.at_bats) {
    const idx = ab.inning - 1;
    if (idx < 0 || idx >= cells.length) continue;
    const weBatted = (state.we_are_home && ab.half === "bottom")
      || (!state.we_are_home && ab.half === "top");
    if (weBatted) {
      cells[idx].usR += ab.runs_scored_on_play;
      if (HIT_RESULT_SET.has(ab.result)) cells[idx].usH += 1;
      // We batted and reached on error → opp's defensive error.
      if (ab.result === "E") cells[idx].oppE += 1;
    } else {
      cells[idx].oppR += ab.runs_scored_on_play;
      if (HIT_RESULT_SET.has(ab.result)) cells[idx].oppH += 1;
      // Opp batted and reached on error → our defensive error.
      if (ab.result === "E") cells[idx].usE += 1;
    }
  }
  const totals = cells.reduce(
    (acc, c) => ({
      usR: acc.usR + c.usR, oppR: acc.oppR + c.oppR,
      usH: acc.usH + c.usH, oppH: acc.oppH + c.oppH,
      usE: acc.usE + c.usE, oppE: acc.oppE + c.oppE,
    }),
    { usR: 0, oppR: 0, usH: 0, oppH: 0, usE: 0, oppE: 0 },
  );

  return (
    <Card className="p-3 overflow-x-auto">
      <table className="font-mono-stat text-sm w-full min-w-max">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="text-left pr-3 font-semibold w-12"></th>
            {cells.map((_, i) => (
              <th key={i} className="px-2 text-center">{i + 1}</th>
            ))}
            <th className="px-2 text-center border-l">R</th>
            <th className="px-2 text-center">H</th>
            <th className="px-2 text-center">E</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="pr-3 text-xs uppercase tracking-wider text-sa-blue font-semibold">us</td>
            {cells.map((c, i) => (
              <td key={i} className="px-2 text-center text-sa-blue-deep">{c.usR}</td>
            ))}
            <td className="px-2 text-center text-sa-blue-deep border-l">{totals.usR}</td>
            <td className="px-2 text-center text-sa-blue-deep">{totals.usH}</td>
            <td className="px-2 text-center text-sa-blue-deep">{totals.usE}</td>
          </tr>
          <tr>
            <td className="pr-3 text-xs uppercase tracking-wider text-muted-foreground font-semibold">opp</td>
            {cells.map((c, i) => (
              <td key={i} className="px-2 text-center text-sa-blue-deep">{c.oppR}</td>
            ))}
            <td className="px-2 text-center text-sa-blue-deep border-l">{totals.oppR}</td>
            <td className="px-2 text-center text-sa-blue-deep">{totals.oppH}</td>
            <td className="px-2 text-center text-sa-blue-deep">{totals.oppE}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function PitchPad({
  balls,
  strikes,
  disabled,
  onPitch,
}: {
  balls: number;
  strikes: number;
  disabled: boolean;
  onPitch: (t: PitchType) => void;
}) {
  const pitches: { type: PitchType; label: string; cls: string }[] = [
    { type: "ball", label: "Ball", cls: "bg-sa-blue hover:bg-sa-blue/90 text-white" },
    { type: "called_strike", label: "Called K", cls: "bg-sa-orange hover:bg-sa-orange/90 text-white" },
    { type: "swinging_strike", label: "Swing K", cls: "bg-sa-orange hover:bg-sa-orange/90 text-white" },
    { type: "foul", label: "Foul", cls: "bg-muted hover:bg-muted/80 text-foreground" },
    { type: "in_play", label: "In play", cls: "bg-sa-blue-deep/80 hover:bg-sa-blue-deep text-white" },
    { type: "hbp", label: "HBP", cls: "bg-muted hover:bg-muted/80 text-foreground" },
  ];
  // Less-common pitch types tucked into a secondary row to keep the
  // primary pad uncluttered. Foul-tip-caught is a strike (and records K
  // at 2 strikes); pitchout and intentional_ball both add a ball.
  const auxPitches: { type: PitchType; label: string }[] = [
    { type: "foul_tip_caught", label: "Foul tip" },
    { type: "pitchout", label: "Pitchout" },
    { type: "intentional_ball", label: "Int. ball" },
  ];
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Count</span>
        <span className="font-mono-stat text-3xl text-sa-blue-deep">{balls}-{strikes}</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {pitches.map((p) => (
          <Button
            key={p.type}
            disabled={disabled}
            onClick={() => onPitch(p.type)}
            className={`h-12 text-sm font-bold ${p.cls}`}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {auxPitches.map((p) => (
          <Button
            key={p.type}
            variant="outline"
            disabled={disabled}
            onClick={() => onPitch(p.type)}
            className="h-9 text-xs"
          >
            {p.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Tap pitches as they happen — counter resets at the at-bat outcome.</p>
    </Card>
  );
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

function OutcomeGrid({
  disabled,
  onPick,
  onK3Reach,
  armedResult,
}: {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  onK3Reach: (src: K3ReachSource) => void;
  armedResult: AtBatResult | null;
}) {
  return (
    <div className="space-y-2">
      <ButtonRow disabled={disabled} onPick={onPick} results={NON_CONTACT} variant="default" armedResult={armedResult} />
      <K3ReachRow disabled={disabled} onK3Reach={onK3Reach} />
      <ButtonRow disabled={disabled} onPick={onPick} results={HITS} variant="hit" armedResult={armedResult} />
      <ButtonRow disabled={disabled} onPick={onPick} results={OUTS_IN_PLAY} variant="out" armedResult={armedResult} />
      <ButtonRow disabled={disabled} onPick={onPick} results={OTHER_IN_PLAY} variant="other" armedResult={armedResult} />
      <ButtonRow disabled={disabled} onPick={onPick} results={PRODUCTIVE} variant="out" armedResult={armedResult} />
    </div>
  );
}

function K3ReachRow({
  disabled,
  onK3Reach,
}: {
  disabled: boolean;
  onK3Reach: (src: K3ReachSource) => void;
}) {
  // Uncaught third strike: pitcher gets the K, batter reaches first.
  // Source matters for ER (PB/E unearned, WP earned).
  const buttons: { src: K3ReachSource; label: string }[] = [
    { src: "WP", label: "K-WP" },
    { src: "PB", label: "K-PB" },
    { src: "E", label: "K-E" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {buttons.map((b) => (
        <Button
          key={b.src}
          variant="outline"
          disabled={disabled}
          onClick={() => onK3Reach(b.src)}
          className="text-xs"
          title={`Strikeout, batter reached on ${b.src === "WP" ? "wild pitch" : b.src === "PB" ? "passed ball" : "error"}`}
        >
          {b.label}
        </Button>
      ))}
    </div>
  );
}

function ButtonRow({
  disabled,
  onPick,
  results,
  variant,
  armedResult,
}: {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  results: AtBatResult[];
  variant: "default" | "hit" | "out" | "other";
  armedResult: AtBatResult | null;
}) {
  const cls =
    variant === "hit"
      ? "bg-sa-orange hover:bg-sa-orange/90 text-white"
      : variant === "out"
        ? "bg-muted hover:bg-muted/80 text-foreground"
        : variant === "other"
          ? "bg-sa-blue-deep/80 hover:bg-sa-blue-deep text-white"
          : "bg-sa-blue hover:bg-sa-blue/90 text-white";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {results.map((r) => {
        const isArmed = armedResult === r;
        return (
          <Button
            key={r}
            disabled={disabled || (armedResult !== null && !isArmed)}
            onClick={() => onPick(r)}
            className={`h-16 text-lg font-bold ${cls} ${isArmed ? "ring-4 ring-sa-blue-deep ring-offset-2" : ""}`}
            title={RESULT_DESC[r] ?? r}
          >
            {RESULT_LABEL[r]}
          </Button>
        );
      })}
    </div>
  );
}

function RunnersControls({
  bases,
  names,
  weAreBatting,
  disabled,
  onSubmit,
  onComplete,
}: {
  bases: Bases;
  names: Map<string, string>;
  weAreBatting: boolean;
  disabled: boolean;
  onSubmit: (
    eventType: GameEventType,
    payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload,
    clientPrefix: string,
  ) => void;
  onComplete: () => void;
}) {
  const occupied = (["first", "second", "third"] as const).filter((b) => bases[b] !== null);
  if (occupied.length === 0) return null;

  const BASE_SHORT = { first: "1B", second: "2B", third: "3B" } as const;
  const STEAL_TARGET: Record<"first" | "second" | "third", "second" | "third" | "home"> = {
    first: "second", second: "third", third: "home",
  };
  const STEAL_LABEL = { first: "Steal 2nd", second: "Steal 3rd", third: "Steal home" } as const;

  const steal = (base: "first" | "second" | "third", runnerId: string | null) => {
    const payload: StolenBasePayload = { runner_id: runnerId, from: base, to: STEAL_TARGET[base] };
    onSubmit("stolen_base", payload, `sb-${base}`);
    onComplete();
  };
  const caughtStealing = (base: "first" | "second" | "third", runnerId: string | null) => {
    const payload: CaughtStealingPayload = { runner_id: runnerId, from: base };
    onSubmit("caught_stealing", payload, `cs-${base}`);
    onComplete();
  };
  const pickoff = (base: "first" | "second" | "third", runnerId: string | null) => {
    const payload: PickoffPayload = { runner_id: runnerId, from: base };
    onSubmit("pickoff", payload, `po-${base}`);
    onComplete();
  };
  const allUp = (eventType: GameEventType, prefix: string) => {
    const payload: RunnerMovePayload = { advances: allUpAdvances(bases) };
    onSubmit(eventType, payload, prefix);
    onComplete();
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-sa-blue font-semibold">Runners</h3>
      <div className="space-y-3">
        {occupied.map((b) => {
          const runner = bases[b]!;
          const playerName = weAreBatting && runner.player_id
            ? names.get(runner.player_id) ?? "Runner"
            : "Runner";
          return (
            <div key={b} className="space-y-1">
              <p className="text-xs">
                <span className="font-mono-stat font-bold text-sa-blue-deep mr-2">{BASE_SHORT[b]}</span>
                <span>{playerName}</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => steal(b, runner.player_id)}
                  className="bg-sa-orange hover:bg-sa-orange/90 text-white"
                >
                  {STEAL_LABEL[b]}
                </Button>
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => caughtStealing(b, runner.player_id)}>
                  CS
                </Button>
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => pickoff(b, runner.player_id)}>
                  Pickoff
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="space-y-1 pt-1 border-t">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Advance all</p>
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => allUp("wild_pitch", "wp")}>
            WP
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => allUp("passed_ball", "pb")}>
            PB
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => allUp("balk", "bk")}>
            Balk
          </Button>
        </div>
      </div>
    </div>
  );
}

function FlowControls({
  onEndHalf,
  onPitchingChange,
  onSubstitution,
  onEditLastPlay,
  onEditOpposingLineup,
  onFinalize,
  onMoundVisit,
  conferencesThisGame,
  disabled,
  outs,
  canEdit,
}: {
  onEndHalf: () => void;
  onPitchingChange: () => void;
  onSubstitution: () => void;
  onEditLastPlay: () => void;
  onEditOpposingLineup: () => void;
  onFinalize: () => void;
  onMoundVisit: () => void;
  /** Conferences charged to the CURRENT pitcher this game. Drives the
   *  3-warning / 4-forced-removal copy (NFHS 3-4-1; PDF §28.9). */
  conferencesThisGame: number;
  disabled: boolean;
  outs: number;
  canEdit: boolean;
}) {
  const moundVisitTitle =
    conferencesThisGame >= 4
      ? "4 conferences — pitcher must be removed"
      : conferencesThisGame === 3
        ? "Warning: 3 conferences — next forces a pitching change (NFHS 3-4-1)"
        : `${conferencesThisGame} conferences charged this game`;
  return (
    <div className="flex flex-col gap-2">
      {outs >= 3 && (
        <p className="text-xs uppercase tracking-wider text-sa-orange font-semibold">
          3 outs — end the half-inning to continue
        </p>
      )}
      <Button variant="outline" disabled={disabled} onClick={onEndHalf} className="justify-start">
        End ½ inning
      </Button>
      <Button variant="outline" disabled={disabled} onClick={onSubstitution} className="justify-start">
        Substitution
      </Button>
      <Button variant="outline" disabled={disabled} onClick={onPitchingChange} className="justify-start">
        Pitching change
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={onMoundVisit}
        title={moundVisitTitle}
        className={
          "justify-start " +
          (conferencesThisGame >= 3 ? "border-sa-orange text-sa-orange" : "")
        }
      >
        Mound visit{conferencesThisGame > 0 ? ` (${conferencesThisGame})` : ""}
      </Button>
      <Button
        variant="outline"
        disabled={disabled || !canEdit}
        onClick={onEditLastPlay}
        className="justify-start"
      >
        Edit last play
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={onEditOpposingLineup}
        className="justify-start"
      >
        Edit opposing lineup
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={onFinalize}
        className="justify-start border-sa-orange text-sa-orange hover:bg-sa-orange hover:text-white"
      >
        Finalize game
      </Button>
    </div>
  );
}

function PitchingChangeDialog({
  open,
  onOpenChange,
  roster,
  state,
  names,
  onPick,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  roster: RosterDisplay[];
  state: ReplayState;
  names: Map<string, string>;
  onPick: (id: string) => void;
  disabled: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);

  // Reset confirmation state on open/close.
  useEffect(() => {
    if (!open) setPending(null);
  }, [open]);

  const currentPitcherId = state.current_pitcher_id;
  const currentName = currentPitcherId ? names.get(currentPitcherId) : null;
  const candidates = roster.filter((p) => p.id !== currentPitcherId);

  // Side-effect description for the confirmation step.
  const lineupSlotOf = (pid: string | null) =>
    state.our_lineup.find((s) => s.player_id === pid) ?? null;
  const sideEffect = (newPitcherId: string): string | null => {
    if (state.use_dh) return null;
    const newSlot = lineupSlotOf(newPitcherId);
    const oldSlot = lineupSlotOf(currentPitcherId);
    if (newSlot) {
      return `${names.get(newPitcherId) ?? "Player"} stays in slot ${newSlot.batting_order}; their position becomes P.`;
    }
    if (oldSlot && currentPitcherId) {
      return `${names.get(newPitcherId) ?? "New pitcher"} takes slot ${oldSlot.batting_order} from ${currentName ?? "the current pitcher"}.`;
    }
    return null;
  };

  if (pending) {
    const newName = names.get(pending) ?? "the new pitcher";
    const note = sideEffect(pending);
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm pitching change</DialogTitle>
            <DialogDescription>
              {currentName ? <>{currentName} → {newName}.</> : <>Bring in {newName}.</>}
              {note && <> {note}</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={disabled} onClick={() => setPending(null)}>
              Back
            </Button>
            <Button
              disabled={disabled}
              onClick={() => onPick(pending)}
              className="bg-sa-orange hover:bg-sa-orange/90"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pitching change</DialogTitle>
          <DialogDescription>
            {currentName ? <>Currently on the mound: <span className="font-semibold">{currentName}</span>. Tap a player to bring them in.</> : <>Tap a player to put them on the mound.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {candidates.map((p) => {
              const num = p.jersey_number ? `#${p.jersey_number} ` : "";
              return (
                <Button
                  key={p.id}
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setPending(p.id)}
                  className="h-14 justify-start text-left"
                >
                  <span className="font-mono-stat text-sa-blue-deep mr-2">{num}</span>
                  <span>{p.first_name} {p.last_name}</span>
                </Button>
              );
            })}
          </div>
          {candidates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No other players on the roster.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SUB_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"] as const;

type SubKind = SubstitutionPayload["sub_type"];

function SubstitutionDialog({
  open,
  onOpenChange,
  state,
  roster,
  names,
  onSubmit,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  state: ReplayState;
  roster: RosterDisplay[];
  names: Map<string, string>;
  onSubmit: (payload: SubstitutionPayload) => void;
  disabled: boolean;
}) {
  const [subKind, setSubKind] = useState<SubKind>("regular");
  const [slotOrder, setSlotOrder] = useState<number | null>(null);
  const [inPlayerId, setInPlayerId] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);
  const [originalBase, setOriginalBase] = useState<"first" | "second" | "third" | null>(null);

  // Reset state when the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setSubKind("regular");
      setSlotOrder(null);
      setInPlayerId(null);
      setPosition(null);
      setOriginalBase(null);
    }
  }, [open]);

  const slot = state.our_lineup.find((s) => s.batting_order === slotOrder) ?? null;
  const lineupIds = new Set(
    state.our_lineup.map((s) => s.player_id).filter(Boolean) as string[],
  );
  const benchPlayers = roster.filter(
    (p) => !lineupIds.has(p.id) && p.id !== state.current_pitcher_id,
  );

  // Eligible re-entry slots: starter is currently OUT (slot.player_id !==
  // original_player_id) AND has not already re-entered.
  const reEntrySlots = state.our_lineup.filter(
    (s) => s.is_starter && !s.re_entered && s.player_id !== s.original_player_id && s.original_player_id,
  );

  // Occupied bases — needed for pinch_run / courtesy_run.
  const occupiedBases = (["first", "second", "third"] as const).filter(
    (b) => state.bases[b] !== null,
  );

  // Courtesy-runner role — derived from which baserunner matches the
  // current pitcher / catcher.
  const catcherSlot = state.our_lineup.find((s) => s.position === "C");
  const catcherId = catcherSlot?.player_id ?? null;
  const baseRunnerId = originalBase ? state.bases[originalBase]?.player_id ?? null : null;
  const courtesyRole: "pitcher" | "catcher" | null =
    baseRunnerId === state.current_pitcher_id
      ? "pitcher"
      : baseRunnerId === catcherId
        ? "catcher"
        : null;
  const courtesyAlreadyUsedForRole = courtesyRole
    ? state.courtesy_runners_used.some((c) => c.role === courtesyRole)
    : false;

  const outName = slot?.player_id ? names.get(slot.player_id) ?? null : null;

  const canSubmit = (() => {
    if (disabled) return false;
    if (subKind === "regular" || subKind === "pinch_hit") {
      return !!(slot?.player_id && inPlayerId && inPlayerId !== slot.player_id);
    }
    if (subKind === "pinch_run") {
      return !!(originalBase && baseRunnerId && inPlayerId && inPlayerId !== baseRunnerId);
    }
    if (subKind === "courtesy_run") {
      return !!(originalBase && baseRunnerId && inPlayerId && courtesyRole && !courtesyAlreadyUsedForRole);
    }
    if (subKind === "re_entry") {
      return !!(slotOrder && slot?.original_player_id && inPlayerId === slot.original_player_id);
    }
    return false;
  })();

  const handleSubmit = () => {
    if (subKind === "regular" || subKind === "pinch_hit") {
      if (!slot?.player_id || !inPlayerId || !slotOrder) return;
      onSubmit({
        out_player_id: slot.player_id,
        in_player_id: inPlayerId,
        batting_order: slotOrder,
        position: position ?? slot.position ?? null,
        sub_type: subKind,
      });
      return;
    }
    if (subKind === "pinch_run") {
      if (!originalBase || !baseRunnerId || !inPlayerId) return;
      // Pinch-runner replaces the player in the lineup too. Find their slot.
      const runnerSlot = state.our_lineup.find((s) => s.player_id === baseRunnerId);
      onSubmit({
        out_player_id: baseRunnerId,
        in_player_id: inPlayerId,
        batting_order: runnerSlot?.batting_order ?? 0,
        position: runnerSlot?.position ?? null,
        sub_type: "pinch_run",
        original_base: originalBase,
      });
      return;
    }
    if (subKind === "courtesy_run") {
      if (!originalBase || !baseRunnerId || !inPlayerId) return;
      onSubmit({
        out_player_id: baseRunnerId,
        in_player_id: inPlayerId,
        batting_order: 0, // courtesy runner doesn't take the lineup slot
        position: null,
        sub_type: "courtesy_run",
        original_base: originalBase,
      });
      return;
    }
    if (subKind === "re_entry") {
      if (!slotOrder || !slot?.original_player_id || inPlayerId !== slot.original_player_id) return;
      const outId = slot.player_id ?? "";
      onSubmit({
        out_player_id: outId,
        in_player_id: slot.original_player_id,
        batting_order: slotOrder,
        position: position ?? slot.position ?? null,
        sub_type: "re_entry",
      });
      return;
    }
  };

  const subKindLabel: Record<SubKind, string> = {
    regular: "Regular",
    pinch_hit: "Pinch hit",
    pinch_run: "Pinch run",
    courtesy_run: "Courtesy run (NFHS)",
    re_entry: "Re-entry",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Substitution</DialogTitle>
          <DialogDescription>
            Replace a player. Pinch run swaps the lineup; courtesy run is
            NFHS-only and doesn&apos;t change the batting order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Type</Label>
            <Select value={subKind} onValueChange={(v) => setSubKind(v as SubKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(subKindLabel) as SubKind[]).map((k) => (
                  <SelectItem key={k} value={k}>{subKindLabel[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(subKind === "regular" || subKind === "pinch_hit") && (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lineup slot</Label>
                <Select
                  value={slotOrder ? String(slotOrder) : ""}
                  onValueChange={(v) => {
                    const n = Number(v);
                    setSlotOrder(n);
                    const target = state.our_lineup.find((s) => s.batting_order === n);
                    setPosition(target?.position ?? null);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="— pick slot —" /></SelectTrigger>
                  <SelectContent>
                    {state.our_lineup.map((s) => {
                      const who = s.player_id ? names.get(s.player_id) ?? "—" : "(empty)";
                      return (
                        <SelectItem key={s.batting_order} value={String(s.batting_order)}>
                          {s.batting_order}. {who}{s.position ? ` (${s.position})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {outName && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Coming out: <span className="font-semibold text-sa-blue-deep">{outName}</span>
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Coming in</Label>
                <Select
                  value={inPlayerId ?? ""}
                  onValueChange={(v) => setInPlayerId(v || null)}
                  disabled={!slotOrder}
                >
                  <SelectTrigger><SelectValue placeholder={slotOrder ? "— pick bench player —" : "Pick a slot first"} /></SelectTrigger>
                  <SelectContent>
                    {benchPlayers.length === 0 && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No bench players available.</div>
                    )}
                    {benchPlayers.map((p) => {
                      const num = p.jersey_number ? `#${p.jersey_number} ` : "";
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {num}{p.first_name} {p.last_name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Position</Label>
                <Select
                  value={position ?? ""}
                  onValueChange={(v) => setPosition(v || null)}
                  disabled={!slotOrder}
                >
                  <SelectTrigger><SelectValue placeholder="— position —" /></SelectTrigger>
                  <SelectContent>
                    {SUB_POSITIONS.filter((pos) => pos !== "DH" || state.use_dh).map((pos) => (
                      <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {(subKind === "pinch_run" || subKind === "courtesy_run") && (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Runner on base</Label>
                <Select
                  value={originalBase ?? ""}
                  onValueChange={(v) => setOriginalBase((v || null) as "first" | "second" | "third" | null)}
                >
                  <SelectTrigger><SelectValue placeholder={occupiedBases.length ? "— pick base —" : "No runners on base"} /></SelectTrigger>
                  <SelectContent>
                    {occupiedBases.map((b) => {
                      const id = state.bases[b]?.player_id ?? null;
                      const who = id ? names.get(id) ?? "Runner" : "Runner";
                      return (
                        <SelectItem key={b} value={b}>
                          {b === "first" ? "1B" : b === "second" ? "2B" : "3B"} — {who}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {subKind === "courtesy_run" && originalBase && !courtesyRole && (
                <p className="text-xs text-sa-orange">
                  Courtesy runner is NFHS-only and only valid for the pitcher or catcher of record.
                </p>
              )}
              {subKind === "courtesy_run" && courtesyRole && courtesyAlreadyUsedForRole && (
                <p className="text-xs text-sa-orange">
                  A courtesy runner has already been used for the {courtesyRole} this game.
                </p>
              )}

              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Runner coming in</Label>
                <Select
                  value={inPlayerId ?? ""}
                  onValueChange={(v) => setInPlayerId(v || null)}
                  disabled={!originalBase}
                >
                  <SelectTrigger><SelectValue placeholder={originalBase ? "— pick bench player —" : "Pick a base first"} /></SelectTrigger>
                  <SelectContent>
                    {benchPlayers.length === 0 && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No bench players available.</div>
                    )}
                    {benchPlayers.map((p) => {
                      const num = p.jersey_number ? `#${p.jersey_number} ` : "";
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {num}{p.first_name} {p.last_name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {subKind === "re_entry" && (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Eligible starter slot</Label>
                <Select
                  value={slotOrder ? String(slotOrder) : ""}
                  onValueChange={(v) => {
                    const n = Number(v);
                    setSlotOrder(n);
                    const s = state.our_lineup.find((x) => x.batting_order === n);
                    setInPlayerId(s?.original_player_id ?? null);
                    setPosition(s?.position ?? null);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={reEntrySlots.length ? "— pick slot —" : "No eligible re-entries"} /></SelectTrigger>
                  <SelectContent>
                    {reEntrySlots.map((s) => {
                      const original = s.original_player_id ? names.get(s.original_player_id) ?? "Starter" : "Starter";
                      const current = s.player_id ? names.get(s.player_id) ?? "—" : "(empty)";
                      return (
                        <SelectItem key={s.batting_order} value={String(s.batting_order)}>
                          {s.batting_order}. {original} (currently {current})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  NFHS Rule 3-1-3: a starter may re-enter once, in their original slot.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit} className="bg-sa-orange hover:bg-sa-orange/90">
            Make substitution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EDIT_RESULTS: AtBatResult[] = [
  ...NON_CONTACT,
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

function EditLastPlayDialog({
  open,
  onOpenChange,
  gameId,
  lastAtBat,
  names,
  onSubmit,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  gameId: string;
  lastAtBat: DerivedAtBat | null;
  names: Map<string, string>;
  onSubmit: (supersededEventId: string, correctedAtBat: AtBatPayload) => void;
  disabled: boolean;
}) {
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

  // When the user picks a different result, reseed advances from defaults.
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

// All-runners-up advance plan for WP/PB/Balk — every occupied base moves
// one base forward. Used as the default when the coach taps WP/PB/Balk on
// any runner; user can refine via Edit Last Play if needed (Phase C work).
function allUpAdvances(bases: Bases): RunnerAdvance[] {
  const advances: RunnerAdvance[] = [];
  if (bases.third) advances.push({ from: "third", to: "home", player_id: bases.third.player_id });
  if (bases.second) advances.push({ from: "second", to: "third", player_id: bases.second.player_id });
  if (bases.first) advances.push({ from: "first", to: "second", player_id: bases.first.player_id });
  return advances;
}

function RunnerActionDialog({
  action,
  onClose,
  names,
  bases,
  onSubmit,
  disabled,
}: {
  action: { base: "first" | "second" | "third"; runnerId: string | null } | null;
  onClose: () => void;
  names: Map<string, string>;
  bases: Bases;
  onSubmit: (
    eventType: GameEventType,
    payload: StolenBasePayload | CaughtStealingPayload | PickoffPayload | RunnerMovePayload,
    clientPrefix: string,
  ) => void;
  disabled: boolean;
}) {
  const open = action !== null;
  const runnerName = action?.runnerId ? names.get(action.runnerId) ?? "Runner" : "Runner";
  const stealTarget: "second" | "third" | "home" | null =
    action?.base === "first" ? "second"
    : action?.base === "second" ? "third"
    : action?.base === "third" ? "home"
    : null;
  const stealLabel = stealTarget === "home" ? "Steal home"
    : stealTarget === "third" ? "Steal 3rd"
    : "Steal 2nd";

  const steal = () => {
    if (!action || !stealTarget) return;
    const payload: StolenBasePayload = {
      runner_id: action.runnerId,
      from: action.base,
      to: stealTarget,
    };
    onSubmit("stolen_base", payload, `sb-${action.base}`);
  };
  const caughtStealing = () => {
    if (!action) return;
    const payload: CaughtStealingPayload = { runner_id: action.runnerId, from: action.base };
    onSubmit("caught_stealing", payload, `cs-${action.base}`);
  };
  const pickoff = () => {
    if (!action) return;
    const payload: PickoffPayload = { runner_id: action.runnerId, from: action.base };
    onSubmit("pickoff", payload, `po-${action.base}`);
  };
  const allUp = (eventType: GameEventType, prefix: string) => {
    const payload: RunnerMovePayload = { advances: allUpAdvances(bases) };
    onSubmit(eventType, payload, prefix);
  };

  return (
    <Dialog open={open} onOpenChange={(b) => { if (!b) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{runnerName} on {action?.base === "first" ? "1st" : action?.base === "second" ? "2nd" : "3rd"}</DialogTitle>
          <DialogDescription>
            Pick what happened. Wild pitch, passed ball, and balk advance every runner one base.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 py-2">
          <Button onClick={steal} disabled={disabled} className="bg-sa-orange hover:bg-sa-orange/90 text-white">
            {stealLabel}
          </Button>
          <Button onClick={caughtStealing} disabled={disabled} variant="outline">
            Caught stealing
          </Button>
          <Button onClick={pickoff} disabled={disabled} variant="outline">
            Pickoff out
          </Button>
          <Button onClick={() => allUp("wild_pitch", "wp")} disabled={disabled} variant="outline">
            Wild pitch
          </Button>
          <Button onClick={() => allUp("passed_ball", "pb")} disabled={disabled} variant="outline">
            Passed ball
          </Button>
          <Button onClick={() => allUp("balk", "bk")} disabled={disabled} variant="outline">
            Balk
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={disabled}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinalizeDialog({
  open,
  onOpenChange,
  state,
  onConfirm,
  disabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  state: ReplayState;
  onConfirm: () => void;
  disabled: boolean;
}) {
  const result =
    state.team_score > state.opponent_score ? "Win"
    : state.team_score < state.opponent_score ? "Loss"
    : "Tie";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finalize this game?</DialogTitle>
          <DialogDescription>
            The game will appear as final on the public scoreboard. You can un-finalize from the
            schedule page within 7 days if you need to fix something.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-center space-y-1">
          <p className="font-mono-stat text-4xl text-sa-blue-deep">
            {state.team_score} <span className="text-muted-foreground">–</span> {state.opponent_score}
          </p>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{result}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={disabled} onClick={onConfirm} className="bg-sa-orange hover:bg-sa-orange/90">
            {disabled ? "Finalizing…" : "Yes, finalize"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Helpers ---------------------------------------------------------------

function isOurHalf(weAreHome: boolean, half: "top" | "bottom"): boolean {
  return weAreHome ? half === "bottom" : half === "top";
}

function formatOpposingSlotLabel(slot: OpposingLineupSlot): string {
  const num = slot.jersey_number ? `#${slot.jersey_number} ` : "";
  const name = slot.last_name ?? "";
  const pos = slot.position ? ` · ${slot.position}` : "";
  return `${num}${name}${pos}`.trim() || `Slot ${slot.batting_order}`;
}

interface PostBody {
  client_event_id: string;
  sequence_number: number;
  event_type: string;
  payload: unknown;
}

async function postEvent(gameId: string, body: PostBody): Promise<boolean> {
  const res = await fetch(`/api/games/${gameId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    toast.error(`Couldn't save event: ${detail.error ?? res.statusText}`);
    return false;
  }
  return true;
}

// Auto-fill the count to match the outcome. Walks must be 4 balls; strikeouts
// must be 3 strikes. For balls put in play (hits, in-play outs, FC, E,
// sacs, DP/TP), the contact pitch counts as a strike — bump the strike
// count by one if there's room. HBP is treated as neither.
function finalCount(
  result: AtBatResult,
  balls: number,
  strikes: number,
): { balls: number; strikes: number } {
  if (result === "BB" || result === "IBB") return { balls: 4, strikes };
  if (result === "K_swinging" || result === "K_looking") return { balls, strikes: 3 };
  if (result === "HBP") return { balls, strikes };
  // Hits + in-play outs + FC + E + sacs + DP/TP — the in-play pitch is a strike.
  return { balls, strikes: Math.min(3, strikes + 1) };
}

function describePlay(
  result: AtBatResult,
  runs: number,
  batterId: string | null,
  names: Map<string, string>,
): string {
  const base = RESULT_DESC[result] ?? result;
  const who = batterId
    ? ` by ${names.get(batterId) ?? "us"}`
    : " (opp)";
  if (runs === 0) return `${base}${who}`;
  return `${base}${who} — ${runs} run${runs === 1 ? "" : "s"}`;
}

// Used by the undo toast: a one-liner describing what an event was, before
// we void it. Kept loose — coaches don't need legal-grade event descriptions,
// just enough to recognize what's being reverted.
function describeEvent(event: GameEventRecord, names: Map<string, string>): string {
  switch (event.event_type) {
    case "at_bat": {
      const p = event.payload as AtBatPayload;
      if (p.description) return p.description;
      const result = RESULT_DESC[p.result] ?? p.result;
      const who = p.batter_id ? names.get(p.batter_id) ?? "batter" : "opp";
      return `${result} (${who})`;
    }
    case "pitch": {
      const p = event.payload as PitchPayload;
      const labels: Record<PitchType, string> = {
        ball: "ball",
        called_strike: "called strike",
        swinging_strike: "swinging strike",
        foul: "foul",
        in_play: "in-play",
        hbp: "hit by pitch",
        foul_tip_caught: "foul tip caught",
        pitchout: "pitchout",
        intentional_ball: "intentional ball",
      };
      return labels[p.pitch_type] ?? p.pitch_type;
    }
    case "stolen_base": {
      const p = event.payload as StolenBasePayload;
      return `stolen base (${p.from} → ${p.to})`;
    }
    case "caught_stealing": return "caught stealing";
    case "pickoff": return "pickoff";
    case "wild_pitch": return "wild pitch";
    case "passed_ball": return "passed ball";
    case "balk": return "balk";
    case "error_advance": return "error advance";
    case "inning_end": return "end of ½ inning";
    case "substitution": {
      const p = event.payload as SubstitutionPayload;
      const inName = names.get(p.in_player_id) ?? "sub";
      return `sub (${inName} → slot ${p.batting_order})`;
    }
    case "pitching_change": {
      const p = event.payload as PitchingChangePayload;
      const inName = p.in_pitcher_id ? names.get(p.in_pitcher_id) ?? "new pitcher" : "new pitcher";
      return `pitching change (${inName})`;
    }
    case "defensive_conference": return "mound visit";
    case "position_change": return "position change";
    case "game_started": return "game start";
    case "game_finalized": return "finalize";
    case "correction": return "edit";
    default: return event.event_type;
  }
}
