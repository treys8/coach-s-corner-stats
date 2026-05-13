// Lookup lists for school association / classification / division / region.
// Shared by the school Settings form and the public /scores filters so
// dropdown values stay consistent on both sides.
//
// Only ASSOCIATIONS and CLASSIFICATIONS are required when a school publishes
// scores. DIVISIONS and REGIONS are optional.

export const ASSOCIATIONS = ["MAIS", "MHSAA"] as const;
export const CLASSIFICATIONS = ["6A", "5A", "4A", "3A", "2A", "1A"] as const;
export const DIVISIONS = ["I", "II", "III"] as const;
export const REGIONS = [] as const;

export type Association = (typeof ASSOCIATIONS)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type Division = (typeof DIVISIONS)[number];
export type Region = (typeof REGIONS)[number];

export const isAssociation = (v: string | null | undefined): v is Association =>
  !!v && (ASSOCIATIONS as readonly string[]).includes(v);
export const isClassification = (v: string | null | undefined): v is Classification =>
  !!v && (CLASSIFICATIONS as readonly string[]).includes(v);
export const isDivision = (v: string | null | undefined): v is Division =>
  !!v && (DIVISIONS as readonly string[]).includes(v);
export const isRegion = (v: string | null | undefined): v is Region =>
  !!v && (REGIONS as readonly string[]).includes(v);
