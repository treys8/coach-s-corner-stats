"use client";

import { Button } from "@/components/ui/button";

interface Props {
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
}

export function FlowControls({
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
}: Props) {
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
