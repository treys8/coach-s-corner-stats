"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  NFHS_DEFAULTS,
  fetchLeagueRules,
  type LeagueRules,
} from "@/lib/scoring/league-defaults";

/** Loads league_rules for (schoolId, seasonYear) once on mount and returns
 *  the resolved rules. Falls through to NFHS defaults when nothing matches
 *  or when the fetch fails — the caller always gets a usable object so
 *  consumers (mercy banner, pitch-count workload) don't have to null-check. */
export function useLeagueRules(
  schoolId: string | null | undefined,
  seasonYear: number | null,
): LeagueRules {
  const [rules, setRules] = useState<LeagueRules>(NFHS_DEFAULTS);

  useEffect(() => {
    if (!schoolId) {
      setRules(NFHS_DEFAULTS);
      return;
    }
    let active = true;
    const supabase = createClient();
    void fetchLeagueRules(supabase, schoolId, seasonYear).then((r) => {
      if (active) setRules(r);
    });
    return () => {
      active = false;
    };
  }, [schoolId, seasonYear]);

  return rules;
}
