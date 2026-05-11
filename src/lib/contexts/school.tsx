"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface School {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  is_discoverable: boolean;
  public_scores_enabled: boolean;
  is_public_roster: boolean;
  association: string | null;
  classification: string | null;
  division: string | null;
  timezone: string;
}

export interface SchoolContextValue {
  school: School;
  isAdmin: boolean;
}

const SchoolContext = createContext<SchoolContextValue | undefined>(undefined);

export const SchoolProvider = ({
  value,
  children,
}: {
  value: SchoolContextValue;
  children: ReactNode;
}) => <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;

export const useSchool = () => {
  const ctx = useContext(SchoolContext);
  if (!ctx) throw new Error("useSchool must be used inside a /s/[school] route");
  return ctx;
};
