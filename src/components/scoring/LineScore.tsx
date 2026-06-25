"use client";

import { Card } from "@/components/ui/card";
import type { AtBatResult, ReplayState } from "@/lib/scoring/types";

const HIT_RESULT_SET: ReadonlySet<AtBatResult> = new Set(["1B", "2B", "3B", "HR"]);

export function LineScore({ state }: { state: ReplayState }) {
  const innings = Math.max(7, state.inning);
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

  // Highlight the column for the inning in progress.
  const currentIdx = state.inning - 1;
  const colHi = (i: number) => (i === currentIdx ? " bg-sa-orange/10" : "");

  return (
    <Card className="p-3 overflow-x-auto rounded-xl shadow-e2">
      <table className="font-mono-stat text-sm w-full min-w-max">
        <thead>
          <tr className="text-eyebrow">
            <th className="text-left pr-3 w-12"></th>
            {cells.map((_, i) => (
              <th key={i} className={`px-2.5 py-1.5 text-center${colHi(i)}`}>{i + 1}</th>
            ))}
            <th className="px-2.5 py-1.5 text-center border-l text-sa-blue font-bold">R</th>
            <th className="px-2.5 py-1.5 text-center text-sa-blue font-bold">H</th>
            <th className="px-2.5 py-1.5 text-center text-sa-blue font-bold">E</th>
          </tr>
        </thead>
        <tbody>
          <tr className="odd:bg-muted/30 hover:bg-sa-blue/5">
            <td className="pr-3 text-[10px] font-bold uppercase tracking-[0.12em] text-sa-blue">us</td>
            {cells.map((c, i) => (
              <td key={i} className={`px-2.5 py-1.5 text-center text-sa-blue-deep${colHi(i)}`}>{c.usR}</td>
            ))}
            <td className="px-2.5 py-1.5 text-center text-stat-xl text-base text-sa-blue border-l">{totals.usR}</td>
            <td className="px-2.5 py-1.5 text-center text-stat-xl text-base text-sa-blue-deep">{totals.usH}</td>
            <td className="px-2.5 py-1.5 text-center text-stat-xl text-base text-sa-blue-deep">{totals.usE}</td>
          </tr>
          <tr className="odd:bg-muted/30 hover:bg-sa-blue/5">
            <td className="pr-3 text-eyebrow">opp</td>
            {cells.map((c, i) => (
              <td key={i} className={`px-2.5 py-1.5 text-center text-sa-blue-deep${colHi(i)}`}>{c.oppR}</td>
            ))}
            <td className="px-2.5 py-1.5 text-center text-stat-xl text-base text-sa-blue border-l">{totals.oppR}</td>
            <td className="px-2.5 py-1.5 text-center text-stat-xl text-base text-sa-blue-deep">{totals.oppH}</td>
            <td className="px-2.5 py-1.5 text-center text-stat-xl text-base text-sa-blue-deep">{totals.oppE}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}
