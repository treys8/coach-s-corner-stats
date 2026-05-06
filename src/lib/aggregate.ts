// Stat aggregation across the roster. Counting stats sum, rate stats average.
// Anything not in either list is ignored when aggregating (still shown raw on
// player pages, just not rolled up).
import { sectionOf, type Section, type SnapshotStats } from "@/lib/snapshots";

/** Counting stats — summed across the roster on a given upload date. */
export const SUM_STATS: Record<Section, Set<string>> = {
  batting: new Set(["GP","PA","AB","H","1B","2B","3B","HR","RBI","R","BB","SO","K-L","HBP","SAC","SF","ROE","FC","SB","CS","PIK","QAB","HHB","LOB","2OUTRBI","XBH","TB","PS","2S+3","6+","GIDP","GITP","CI"]),
  pitching: new Set(["GP","GS","BF","#P","W","L","SV","SVO","BS","H","R","ER","BB","SO","K-L","HBP","LOB","BK","PIK","CS","SB","WP","LOO","1ST2OUT","123INN","<13","BBS","LOBB","LOBBS","HR","FB","FBS","CB","CBS","CT","CTS","SL","SLS","CH","CHS","OS","OSS"]),
  fielding: new Set(["TC","A","PO","E","DP","TP","PB","SB","SBATT","CS","PIK","CI","P","C","1B","2B","3B","SS","LF","CF","RF","SF","Total"]),
};

/** Rate stats — averaged across the roster (rough team average). */
export const RATE_STATS: Record<Section, string[]> = {
  batting: ["AVG","OBP","SLG","OPS","BABIP","BA/RISP","SB%","QAB%","C%","BB/K","LD%","FB%","GB%"],
  pitching: ["ERA","WHIP","BAA","SV%","P/IP","P/BF","FIP","S%","FPS%","SM%","K/BF","K/BB","WEAK%","HHB%","GO/AO","BABIP","BA/RISP","SB%","FBS%","FBSW%","FBSM%","CBS%","CTS%","SLS%","CHS%","OSS%"],
  fielding: ["FPCT","CS%"],
};

export type SectionAgg = Record<string, number>;
export type DateAggregation = {
  date: string;
  agg: Record<Section, SectionAgg>;
};

/** Snapshot shape required by aggregateByDate — anything with a date and parsed stats works. */
export interface AggregateInput {
  upload_date: string;
  stats: SnapshotStats;
}

const SECTIONS: Section[] = ["batting", "pitching", "fielding"];

/**
 * Group snapshots by upload_date and roll up stats per section.
 *  - Counting stats (SUM_STATS) are summed across all players on that date.
 *  - Rate stats (RATE_STATS) are averaged across players who recorded a value.
 *  - Unknown stats are dropped from the rollup.
 *
 * Result is sorted by date ascending.
 */
export const aggregateByDate = (snapshots: AggregateInput[]): DateAggregation[] => {
  const byDate = new Map<string, AggregateInput[]>();
  for (const s of snapshots) {
    if (!byDate.has(s.upload_date)) byDate.set(s.upload_date, []);
    byDate.get(s.upload_date)!.push(s);
  }

  const result: DateAggregation[] = [];
  for (const [date, list] of Array.from(byDate.entries()).sort()) {
    const agg: Record<Section, SectionAgg> = { batting: {}, pitching: {}, fielding: {} };
    const rateCounts: Record<Section, Record<string, number>> = { batting: {}, pitching: {}, fielding: {} };

    for (const snap of list) {
      for (const sec of SECTIONS) {
        const block = sectionOf(snap.stats, sec);
        for (const [k, v] of Object.entries(block)) {
          if (typeof v !== "number" || !Number.isFinite(v)) continue;
          if (SUM_STATS[sec].has(k)) {
            agg[sec][k] = (agg[sec][k] ?? 0) + v;
          } else if (RATE_STATS[sec].includes(k)) {
            agg[sec][k] = (agg[sec][k] ?? 0) + v;
            rateCounts[sec][k] = (rateCounts[sec][k] ?? 0) + 1;
          }
        }
      }
    }

    for (const sec of SECTIONS) {
      for (const k of RATE_STATS[sec]) {
        const count = rateCounts[sec][k];
        if (count) agg[sec][k] = agg[sec][k] / count;
      }
    }

    result.push({ date, agg });
  }
  return result;
};
