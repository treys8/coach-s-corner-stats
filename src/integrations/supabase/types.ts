// Hand-maintained until we wire up `supabase gen types typescript`.
// Mirrors the schema in supabase/setup.sql.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Sport = "baseball" | "softball";
export type TeamLevel = "varsity" | "jv" | "freshman" | "middle_school";
export type SchoolRole = "owner" | "admin";
export type TeamRole = "coach" | "scorer" | "assistant";
export type GameLocation = "home" | "away" | "neutral";
export type GameResult = "W" | "L" | "T";

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      schools: {
        Row: {
          id: string;
          slug: string;
          name: string;
          short_name: string | null;
          logo_url: string | null;
          primary_color: string | null;
          secondary_color: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          short_name?: string | null;
          logo_url?: string | null;
          primary_color?: string | null;
          secondary_color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["schools"]["Insert"]>;
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          school_id: string;
          slug: string;
          name: string;
          sport: Sport;
          level: TeamLevel;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          slug: string;
          name: string;
          sport: Sport;
          level: TeamLevel;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["teams"]["Insert"]>;
        Relationships: [];
      };
      school_admins: {
        Row: { school_id: string; user_id: string; role: SchoolRole; created_at: string };
        Insert: { school_id: string; user_id: string; role?: SchoolRole; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["school_admins"]["Insert"]>;
        Relationships: [];
      };
      team_members: {
        Row: { team_id: string; user_id: string; role: TeamRole; created_at: string };
        Insert: { team_id: string; user_id: string; role?: TeamRole; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["team_members"]["Insert"]>;
        Relationships: [];
      };
      players: {
        Row: {
          id: string;
          school_id: string;
          first_name: string;
          last_name: string;
          grad_year: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          first_name: string;
          last_name: string;
          grad_year?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["players"]["Insert"]>;
        Relationships: [];
      };
      roster_entries: {
        Row: {
          id: string;
          player_id: string;
          team_id: string;
          season_year: number;
          jersey_number: string | null;
          position: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          player_id: string;
          team_id: string;
          season_year: number;
          jersey_number?: string | null;
          position?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["roster_entries"]["Insert"]>;
        Relationships: [];
      };
      stat_snapshots: {
        Row: {
          id: string;
          team_id: string;
          player_id: string;
          season_year: number;
          upload_date: string;
          upload_id: string | null;
          stats: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          player_id: string;
          season_year: number;
          upload_date: string;
          upload_id?: string | null;
          stats: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["stat_snapshots"]["Insert"]>;
        Relationships: [];
      };
      games: {
        Row: {
          id: string;
          team_id: string;
          season_year: number;
          game_date: string;
          game_time: string | null;
          opponent: string;
          location: GameLocation;
          team_score: number | null;
          opponent_score: number | null;
          result: GameResult | null;
          notes: string | null;
          is_final: boolean;
          finalized_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          season_year: number;
          game_date: string;
          game_time?: string | null;
          opponent: string;
          location?: GameLocation;
          team_score?: number | null;
          opponent_score?: number | null;
          result?: GameResult | null;
          notes?: string | null;
          is_final?: boolean;
          finalized_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["games"]["Insert"]>;
        Relationships: [];
      };
      csv_uploads: {
        Row: {
          id: string;
          team_id: string;
          season_year: number;
          upload_date: string;
          filename: string | null;
          player_count: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          season_year: number;
          upload_date: string;
          filename?: string | null;
          player_count?: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["csv_uploads"]["Insert"]>;
        Relationships: [];
      };
      glossary: {
        Row: { id: string; abbreviation: string; definition: string; category: string | null; created_at: string };
        Insert: { id?: string; abbreviation: string; definition: string; category?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["glossary"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_school_admin: { Args: { p_school: string }; Returns: boolean };
      is_team_member: { Args: { p_team: string }; Returns: boolean };
      is_season_closed: { Args: { yr: number }; Returns: boolean };
      season_year_for: { Args: { d: string }; Returns: number };
    };
    Enums: { [_ in never]: never };
  };
};
