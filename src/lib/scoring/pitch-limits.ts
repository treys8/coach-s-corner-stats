// State-specific pitch-count rules for NFHS (PDF Appendix C, §28.8).
// NFHS mandates rest-day rules but each state association sets the
// thresholds. This file holds a default high-school table used when no
// per-team override is configured. Coaches can override via
// teams.pitch_limits (JSONB).
//
// The numbers below match PDF Appendix C's "common template": this is a
// representative table, NOT every state's actual config. Real state
// associations vary; teams.pitch_limits should be set explicitly when
// the difference matters.

export interface PitchLimitTier {
  /** Inclusive lower bound on pitches thrown that day. */
  pitches_min: number;
  /** Inclusive upper bound. */
  pitches_max: number;
  /** Calendar days of rest required before next outing. */
  days_rest: number;
}

export interface PitchLimitsConfig {
  /** Maximum pitches per day. */
  max_pitches_per_day: number;
  /** Tier table: walk pitches-thrown forward, find the matching tier,
   *  apply that tier's days_rest. */
  rest_days: PitchLimitTier[];
  /** Allow finishing the current batter when max is hit mid-PA. */
  finish_current_batter: boolean;
}

// Common high-school template per PDF Appendix C.
export const DEFAULT_HIGH_SCHOOL_LIMITS: PitchLimitsConfig = {
  max_pitches_per_day: 110,
  rest_days: [
    { pitches_min: 1,  pitches_max: 25,  days_rest: 0 },
    { pitches_min: 26, pitches_max: 40,  days_rest: 1 },
    { pitches_min: 41, pitches_max: 55,  days_rest: 2 },
    { pitches_min: 56, pitches_max: 70,  days_rest: 3 },
    { pitches_min: 71, pitches_max: 85,  days_rest: 4 },
    { pitches_min: 86, pitches_max: 110, days_rest: 4 },
  ],
  finish_current_batter: true,
};

// Junior-high default — lower thresholds.
export const DEFAULT_JUNIOR_HIGH_LIMITS: PitchLimitsConfig = {
  max_pitches_per_day: 85,
  rest_days: [
    { pitches_min: 1,  pitches_max: 25, days_rest: 0 },
    { pitches_min: 26, pitches_max: 40, days_rest: 1 },
    { pitches_min: 41, pitches_max: 55, days_rest: 2 },
    { pitches_min: 56, pitches_max: 70, days_rest: 3 },
    { pitches_min: 71, pitches_max: 85, days_rest: 4 },
  ],
  finish_current_batter: true,
};

/** Look up the rest-day requirement for a pitch count. */
export function restDaysFor(
  pitchesThrown: number,
  config: PitchLimitsConfig = DEFAULT_HIGH_SCHOOL_LIMITS,
): number {
  for (const tier of config.rest_days) {
    if (pitchesThrown >= tier.pitches_min && pitchesThrown <= tier.pitches_max) {
      return tier.days_rest;
    }
  }
  // Above max: max rest tier.
  if (pitchesThrown > config.max_pitches_per_day) {
    return config.rest_days[config.rest_days.length - 1].days_rest;
  }
  return 0;
}
