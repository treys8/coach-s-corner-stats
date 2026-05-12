"use client";

import { Button } from "@/components/ui/button";
import { allUpAdvances } from "@/lib/scoring/at-bat-helpers";
import type {
  Bases,
  CaughtStealingPayload,
  PickoffPayload,
  RunnerMovePayload,
  StolenBasePayload,
} from "@/lib/scoring/types";
import type { GameEventType } from "@/integrations/supabase/types";

interface Props {
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
}

const BASE_SHORT = { first: "1B", second: "2B", third: "3B" } as const;
const STEAL_TARGET: Record<"first" | "second" | "third", "second" | "third" | "home"> = {
  first: "second", second: "third", third: "home",
};
const STEAL_LABEL = { first: "Steal 2nd", second: "Steal 3rd", third: "Steal home" } as const;

export function RunnersControls({
  bases,
  names,
  weAreBatting,
  disabled,
  onSubmit,
  onComplete,
}: Props) {
  const occupied = (["first", "second", "third"] as const).filter((b) => bases[b] !== null);
  if (occupied.length === 0) return null;

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
