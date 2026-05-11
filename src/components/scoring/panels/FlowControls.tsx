import { Button } from "@/components/ui/button";

export function FlowControls({
  onEndHalf,
  onPitchingChange,
  onSubstitution,
  onEditLastPlay,
  onFinalize,
  disabled,
  outs,
  canEdit,
}: {
  onEndHalf: () => void;
  onPitchingChange: () => void;
  onSubstitution: () => void;
  onEditLastPlay: () => void;
  onFinalize: () => void;
  disabled: boolean;
  outs: number;
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
      <Button variant="outline" disabled={disabled} onClick={onEndHalf}>
        End ½ inning
      </Button>
      <Button variant="outline" disabled={disabled} onClick={onSubstitution}>
        Substitution
      </Button>
      <Button variant="outline" disabled={disabled} onClick={onPitchingChange}>
        Pitching change
      </Button>
      <Button variant="outline" disabled={disabled || !canEdit} onClick={onEditLastPlay}>
        Edit last play
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={onFinalize}
        className="border-sa-orange text-sa-orange hover:bg-sa-orange hover:text-white"
      >
        Finalize game
      </Button>
      {outs >= 3 && (
        <span className="text-xs uppercase tracking-wider text-sa-orange font-semibold">
          3 outs — end the half-inning to continue
        </span>
      )}
    </div>
  );
}
