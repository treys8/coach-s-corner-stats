// Lookup lists for school association / classification / division.
// Shared by the school Settings form and the public /scores filters so
// dropdown values stay consistent on both sides.

export const ASSOCIATIONS = ["MAIS", "MHSAA"] as const;
export const CLASSIFICATIONS = ["6A", "5A", "4A", "3A", "2A", "1A"] as const;
export const DIVISIONS = ["I", "II", "III"] as const;

export type Association = (typeof ASSOCIATIONS)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type Division = (typeof DIVISIONS)[number];

export const isAssociation = (v: string | null | undefined): v is Association =>
  !!v && (ASSOCIATIONS as readonly string[]).includes(v);
export const isClassification = (v: string | null | undefined): v is Classification =>
  !!v && (CLASSIFICATIONS as readonly string[]).includes(v);
export const isDivision = (v: string | null | undefined): v is Division =>
  !!v && (DIVISIONS as readonly string[]).includes(v);
