import { Card } from "@/components/ui/card";
import type { ReplayState } from "@/lib/scoring/types";

export function BatterCard({
  state,
  weAreBatting,
  currentSlot,
  names,
}: {
  state: ReplayState;
  weAreBatting: boolean;
  currentSlot: ReplayState["our_lineup"][number] | null;
  names: Map<string, string>;
}) {
  if (!weAreBatting) {
    const pitcherName = state.current_pitcher_id ? names.get(state.current_pitcher_id) : null;
    return (
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Opponent at bat</p>
        <p className="font-display text-xl text-sa-blue-deep">
          Pitching: {pitcherName ?? "(no pitcher set)"}
        </p>
      </Card>
    );
  }
  const batterName = currentSlot?.player_id ? names.get(currentSlot.player_id) : null;
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">At bat — slot {state.current_batter_slot}</p>
      <p className="font-display text-xl text-sa-blue-deep">
        {batterName ?? "(empty slot)"}
        {currentSlot?.position ? <span className="text-muted-foreground text-sm ml-2">{currentSlot.position}</span> : null}
      </p>
    </Card>
  );
}
