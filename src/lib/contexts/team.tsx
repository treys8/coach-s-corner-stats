"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Sport, TeamLevel } from "@/integrations/supabase/types";

export interface Team {
  id: string;
  school_id: string;
  slug: string;
  name: string;
  sport: Sport;
  level: TeamLevel;
  league_type: "mlb" | "nfhs";
  nfhs_state: string | null;
}

export interface TeamContextValue {
  team: Team;
}

const TeamContext = createContext<TeamContextValue | undefined>(undefined);

export const TeamProvider = ({
  value,
  children,
}: {
  value: TeamContextValue;
  children: ReactNode;
}) => <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;

export const useTeam = () => {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used inside a /s/[school]/[team] route");
  return ctx;
};
