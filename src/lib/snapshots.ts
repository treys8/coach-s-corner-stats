// Snapshot stats live in JSONB, so the shape isn't enforced by the database.
// This module is the single boundary where untyped JSONB becomes a typed shape.
import { z } from "zod";

export type Section = "batting" | "pitching" | "fielding";

export const SectionStatsSchema = z.record(z.string(), z.union([z.string(), z.number()]));
export type SectionStats = z.infer<typeof SectionStatsSchema>;

export const SnapshotStatsSchema = z.object({
  batting: SectionStatsSchema.optional(),
  pitching: SectionStatsSchema.optional(),
  fielding: SectionStatsSchema.optional(),
});
export type SnapshotStats = z.infer<typeof SnapshotStatsSchema>;

const EMPTY_STATS: SnapshotStats = {};

/** Coerce a raw JSONB stats blob into our schema. Invalid shapes log and become empty. */
export const parseSnapshotStats = (raw: unknown): SnapshotStats => {
  const result = SnapshotStatsSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn("Snapshot stats failed schema check; treating as empty.", result.error.issues);
  return EMPTY_STATS;
};

/** Get a section block from a snapshot's stats; missing sections return {}. */
export const sectionOf = (
  stats: SnapshotStats | undefined,
  section: Section,
): SectionStats => stats?.[section] ?? {};
