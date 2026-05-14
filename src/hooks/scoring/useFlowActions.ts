"use client";

import { toast } from "sonner";
import { postEvent, type PostResult } from "@/lib/scoring/events-client";
import { describeEvent } from "@/lib/scoring/at-bat-helpers";
import type {
  AtBatPayload,
  CorrectionPayload,
  GameEventRecord,
  GameSuspendedPayload,
  PitchingChangePayload,
  ReplayState,
  SubstitutionPayload,
  UmpireCallPayload,
} from "@/lib/scoring/types";
import type { UseGameEventsResult } from "./useGameEvents";

export interface UseFlowActionsArgs {
  gameId: string;
  state: ReplayState;
  lastSeq: number;
  names: Map<string, string>;
  lastUndoableEvent: GameEventRecord | null;
  submitting: boolean;
  setSubmitting: UseGameEventsResult["setSubmitting"];
  applyPostResult: UseGameEventsResult["applyPostResult"];
  /** Called after the finalize event lands so the parent can swap to
   *  FinalStub from local state. */
  onFinalized?: () => void;
}

export interface UseFlowActionsResult {
  endHalfInning: () => Promise<void>;
  submitPitchingChange: (newPitcherId: string) => Promise<boolean>;
  submitMoundVisit: () => Promise<{ forcedRemoval: boolean }>;
  submitSubstitution: (payload: SubstitutionPayload) => Promise<boolean>;
  submitUmpireCall: (payload: UmpireCallPayload) => Promise<boolean>;
  editLastPlay: (supersededEventId: string, correctedAtBat: AtBatPayload) => Promise<boolean>;
  finalize: () => Promise<boolean>;
  submitSuspendGame: (payload?: GameSuspendedPayload) => Promise<boolean>;
  submitUndo: () => Promise<void>;
}

/**
 * Inning / lineup / lifecycle actions: end ½, pitching changes, mound
 * visits, substitutions, edit-last-play, finalize, undo.
 */
export function useFlowActions({
  gameId,
  state,
  lastSeq,
  names,
  lastUndoableEvent,
  submitting,
  setSubmitting,
  applyPostResult,
  onFinalized,
}: UseFlowActionsArgs): UseFlowActionsResult {
  const endHalfInning = async () => {
    if (submitting) return;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `ie-${state.inning}-${state.half}-${nextSeq}`,
      event_type: "inning_end",
      payload: { inning: state.inning, half: state.half },
    });
    setSubmitting(false);
    if (!result.ok) return;
    applyPostResult(result);
  };

  // In a non-DH game, the new pitcher must occupy a slot in the batting
  // order. If they're not in the lineup yet, we substitute them into the
  // outgoing pitcher's slot and then record the pitching change. If they're
  // already in the lineup as a fielder, we substitute their slot's position
  // to "P" so the diamond and stats reflect the change.
  const submitPitchingChange = async (newPitcherId: string) => {
    if (submitting) return false;
    if (newPitcherId === state.current_pitcher_id) return false;
    setSubmitting(true);

    const lineupSlotOf = (pid: string | null) =>
      state.our_lineup.find((s) => s.player_id === pid) ?? null;
    const oldSlot = lineupSlotOf(state.current_pitcher_id);
    const newSlot = lineupSlotOf(newPitcherId);

    let leadingSub: SubstitutionPayload | null = null;
    if (!state.use_dh) {
      if (newSlot) {
        leadingSub = {
          out_player_id: newPitcherId,
          in_player_id: newPitcherId,
          batting_order: newSlot.batting_order,
          position: "P",
          sub_type: "regular",
        };
      } else if (oldSlot) {
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
    let subResult: PostResult | null = null;
    if (leadingSub) {
      subResult = await postEvent(gameId, {
        client_event_id: `sub-pc-${nextSeq}`,
        event_type: "substitution",
        payload: leadingSub,
      });
      if (!subResult.ok) {
        setSubmitting(false);
        return false;
      }
      nextSeq += 1;
    }

    const payload: PitchingChangePayload = {
      out_pitcher_id: state.current_pitcher_id,
      in_pitcher_id: newPitcherId,
    };
    const result = await postEvent(gameId, {
      client_event_id: `pc-${nextSeq}`,
      event_type: "pitching_change",
      payload,
    });
    setSubmitting(false);
    if (!result.ok) {
      // The leading sub already persisted server-side. Reflect it locally so
      // the lineup view stays consistent.
      if (subResult) applyPostResult(subResult);
      return false;
    }
    toast.success(`Pitcher: ${names.get(newPitcherId) ?? "updated"}`);
    // Thread the leading-sub snapshot into the pitching-change apply so the
    // sub event isn't dropped from the local events array.
    const subSnap = subResult ? applyPostResult(subResult) : null;
    if (subSnap) applyPostResult(result, subSnap);
    else applyPostResult(result);
    return true;
  };

  const submitMoundVisit = async (): Promise<{ forcedRemoval: boolean }> => {
    if (submitting || !state.current_pitcher_id) return { forcedRemoval: false };
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `dc-${nextSeq}`,
      event_type: "defensive_conference",
      payload: {
        pitcher_id: state.current_pitcher_id,
        inning: state.inning,
      },
    });
    setSubmitting(false);
    if (!result.ok) return { forcedRemoval: false };
    // Alert at the warning thresholds. The post-fold count comes from the
    // returned state; fall back to the +1 estimate if state is missing.
    // NFHS 3-4-1 (play-catalog §8.7): 3 per pitcher per inning OR 4 per
    // pitcher per game both force removal.
    const conferences = result.state?.defensive_conferences
      ?? [
        ...state.defensive_conferences,
        { pitcher_id: state.current_pitcher_id, inning: state.inning },
      ];
    const pitcherId = state.current_pitcher_id;
    const newGameCount = conferences.filter((c) => c.pitcher_id === pitcherId).length;
    const newInningCount = conferences.filter(
      (c) => c.pitcher_id === pitcherId && c.inning === state.inning,
    ).length;
    let forcedRemoval = false;
    if (newGameCount >= 4) {
      toast.warning("4th conference — pitcher must be removed (NFHS 3-4-1)");
      forcedRemoval = true;
    } else if (newInningCount >= 3) {
      toast.warning("3rd visit this inning — pitcher must be removed (NFHS 3-4-1)");
      forcedRemoval = true;
    } else if (newGameCount === 3 || newInningCount === 2) {
      toast.warning("Next mound visit forces a pitching change");
    }
    applyPostResult(result);
    return { forcedRemoval };
  };

  const submitUmpireCall = async (payload: UmpireCallPayload): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `uc-${nextSeq}`,
      event_type: "umpire_call",
      payload,
    });
    setSubmitting(false);
    if (!result.ok) return false;
    const labels: Record<UmpireCallPayload["kind"], string> = {
      IFR: "Infield fly",
      obstruction_a: "Obstruction (play being made)",
      obstruction_b: "Obstruction (no play)",
      batter_interference: "Batter interference",
      runner_interference: "Runner interference",
      spectator_interference: "Spectator interference",
      coach_interference: "Coach interference",
    };
    toast.success(`Umpire's call: ${labels[payload.kind]}`);
    applyPostResult(result);
    return true;
  };

  const submitSubstitution = async (payload: SubstitutionPayload): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `sub-${nextSeq}`,
      event_type: "substitution",
      payload,
    });
    setSubmitting(false);
    if (!result.ok) return false;
    toast.success(
      `Sub: ${names.get(payload.in_player_id) ?? "updated"} → slot ${payload.batting_order}`,
    );
    applyPostResult(result);
    return true;
  };

  // Edit the most recent at-bat by issuing a correction event. Receives a
  // fully-built corrected payload from the edit dialog (result, count, and
  // per-runner advances all editable).
  const editLastPlay = async (
    supersededEventId: string,
    correctedAtBat: AtBatPayload,
  ): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const correction: CorrectionPayload = {
      superseded_event_id: supersededEventId,
      corrected_event_type: "at_bat",
      corrected_payload: correctedAtBat,
    };
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `corr-${nextSeq}`,
      event_type: "correction",
      payload: correction,
    });
    setSubmitting(false);
    if (!result.ok) return false;
    toast.success("Last play updated");
    applyPostResult(result);
    return true;
  };

  const finalize = async (): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    const result = await postEvent(gameId, {
      client_event_id: `gf-${gameId}`,
      event_type: "game_finalized",
      payload: {},
    });
    setSubmitting(false);
    if (!result.ok) return false;
    toast.success("Game finalized");
    applyPostResult(result);
    // Hand off to the parent so it can flip its local `game.status` to
    // "final" and render FinalStub.
    onFinalized?.();
    return true;
  };

  // Stage 6a: pause the game. Resume is implicit — any subsequent play-
  // resolving event flips status from 'suspended' back to 'in_progress'
  // (see replay.ts NON_RESUMING_EVENT_TYPES).
  const submitSuspendGame = async (
    payload: GameSuspendedPayload = {},
  ): Promise<boolean> => {
    if (submitting) return false;
    if (state.status === "suspended" || state.status === "final") return false;
    setSubmitting(true);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `gs-${nextSeq}`,
      event_type: "game_suspended",
      payload,
    });
    setSubmitting(false);
    if (!result.ok) return false;
    toast.success("Game suspended");
    applyPostResult(result);
    return true;
  };

  // One-tap undo. Posts a void correction superseding the most recent live
  // event. Undoing a corrected at_bat removes BOTH the original and the
  // correction from replay.
  const submitUndo = async () => {
    if (submitting || !lastUndoableEvent) return;
    setSubmitting(true);
    const target = lastUndoableEvent;
    const label = describeEvent(target, names);
    const nextSeq = lastSeq + 1;
    const result = await postEvent(gameId, {
      client_event_id: `undo-${nextSeq}`,
      event_type: "correction",
      payload: {
        superseded_event_id: target.id,
        corrected_event_type: null,
        corrected_payload: null,
      } as CorrectionPayload,
    });
    if (!result.ok) {
      setSubmitting(false);
      return;
    }
    toast.success(`Undid: ${label}`);
    // Hold the submitting flag through the local fold so `events` updates
    // before a fast double-tap can re-target the same event.
    applyPostResult(result);
    setSubmitting(false);
  };

  return {
    endHalfInning,
    submitPitchingChange,
    submitMoundVisit,
    submitSubstitution,
    submitUmpireCall,
    editLastPlay,
    finalize,
    submitSuspendGame,
    submitUndo,
  };
}
