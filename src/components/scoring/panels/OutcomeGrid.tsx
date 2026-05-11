import { Button } from "@/components/ui/button";
import type { AtBatResult } from "@/lib/scoring/types";
import { HITS, NON_CONTACT, OUTS_IN_PLAY, RESULT_DESC, RESULT_LABEL } from "../shared/constants";

export function OutcomeGrid({
  disabled,
  onPick,
  armedResult,
}: {
  disabled: boolean;
  onPick: (r: AtBatResult) => void;
  armedResult: AtBatResult | null;
}) {
  return (
    <div className="space-y-2">
      <ButtonRow disabled={disabled} onPick={onPick} results={NON_CONTACT} variant="default" armedResult={armedResult} />
      <ButtonRow disabled={disabled} onPick={onPick} results={HITS} variant="hit" armedResult={armedResult} />
      <ButtonRow disabled={disabled} onPick={onPick} results={OUTS_IN_PLAY} variant="out" armedResult={armedResult} />
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
  variant: "default" | "hit" | "out";
  armedResult: AtBatResult | null;
}) {
  const cls =
    variant === "hit"
      ? "bg-sa-orange hover:bg-sa-orange/90 text-white"
      : variant === "out"
        ? "bg-muted hover:bg-muted/80 text-foreground"
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
