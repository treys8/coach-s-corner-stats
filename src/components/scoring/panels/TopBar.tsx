import { Card } from "@/components/ui/card";
import type { ReplayState } from "@/lib/scoring/types";

export function TopBar({ state, weAreBatting }: { state: ReplayState; weAreBatting: boolean }) {
  const teamLabel = weAreBatting ? "↑ batting" : "fielding";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="font-mono-stat text-3xl text-sa-blue-deep">
          <span className="text-muted-foreground text-base mr-2">us</span>
          {state.team_score}
          <span className="text-muted-foreground mx-2">–</span>
          {state.opponent_score}
          <span className="text-muted-foreground text-base ml-2">opp</span>
        </div>
        <div className="text-sm text-sa-blue uppercase tracking-wider font-semibold">
          {state.half === "top" ? "Top" : "Bot"} {state.inning} · {state.outs} out{state.outs === 1 ? "" : "s"} · {teamLabel}
        </div>
      </div>
    </Card>
  );
}
