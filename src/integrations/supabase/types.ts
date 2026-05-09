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
export type GameStatus = "draft" | "in_progress" | "final";
export type GameResultType = "regulation" | "shortened" | "forfeit" | "suspended";
export type InningHalf = "top" | "bottom";

export type GameEventType =
  | "at_bat"
  | "stolen_base"
  | "caught_stealing"
  | "pickoff"
  | "wild_pitch"
  | "passed_ball"
  | "balk"
  | "error_advance"
  | "substitution"
  | "pitching_change"
  | "position_change"
  | "game_started"
  | "inning_end"
  | "game_finalized"
  | "correction";

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
          is_discoverable: boolean;
          public_scores_enabled: boolean;
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
          is_discoverable?: boolean;
          public_scores_enabled?: boolean;
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
        Row: {
          school_id: string;
          user_id: string;
          role: SchoolRole;
          allow_coach_contact: boolean;
          created_at: string;
        };
        Insert: {
          school_id: string;
          user_id: string;
          role?: SchoolRole;
          allow_coach_contact?: boolean;
          created_at?: string;
        };
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
          source: "xlsx" | "tablet";
          game_id: string | null;
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
          source?: "xlsx" | "tablet";
          game_id?: string | null;
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
          opponent_team_id: string | null;
          is_home: boolean;
          game_sequence: number;
          result_type: GameResultType;
          location: GameLocation;
          team_score: number | null;
          opponent_score: number | null;
          result: GameResult | null;
          notes: string | null;
          status: GameStatus;
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
          opponent_team_id?: string | null;
          is_home: boolean;
          game_sequence?: number;
          result_type?: GameResultType;
          location?: GameLocation;
          team_score?: number | null;
          opponent_score?: number | null;
          result?: GameResult | null;
          notes?: string | null;
          status?: GameStatus;
          is_final?: boolean;
          finalized_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["games"]["Insert"]>;
        Relationships: [];
      };
      game_events: {
        Row: {
          id: string;
          game_id: string;
          client_event_id: string;
          sequence_number: number;
          event_type: GameEventType;
          payload: Json;
          supersedes_event_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          client_event_id: string;
          sequence_number: number;
          event_type: GameEventType;
          payload: Json;
          supersedes_event_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["game_events"]["Insert"]>;
        Relationships: [];
      };
      at_bats: {
        Row: {
          id: string;
          game_id: string;
          event_id: string;
          inning: number;
          half: InningHalf;
          batting_order: number | null;
          batter_id: string | null;
          pitcher_id: string | null;
          opponent_pitcher_id: string | null;
          result: string;
          rbi: number;
          pitch_count: number;
          balls: number;
          strikes: number;
          spray_x: number | null;
          spray_y: number | null;
          fielder_position: string | null;
          runs_scored_on_play: number;
          outs_recorded: number;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          event_id: string;
          inning: number;
          half: InningHalf;
          batting_order?: number | null;
          batter_id?: string | null;
          pitcher_id?: string | null;
          opponent_pitcher_id?: string | null;
          result: string;
          rbi?: number;
          pitch_count?: number;
          balls?: number;
          strikes?: number;
          spray_x?: number | null;
          spray_y?: number | null;
          fielder_position?: string | null;
          runs_scored_on_play?: number;
          outs_recorded?: number;
          description?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["at_bats"]["Insert"]>;
        Relationships: [];
      };
      game_opponent_pitchers: {
        Row: { id: string; game_id: string; name: string; created_at: string };
        Insert: { id?: string; game_id: string; name: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["game_opponent_pitchers"]["Insert"]>;
        Relationships: [];
      };
      game_live_state: {
        Row: {
          game_id: string;
          inning: number;
          half: InningHalf;
          outs: number;
          runner_first: string | null;
          runner_second: string | null;
          runner_third: string | null;
          team_score: number;
          opponent_score: number;
          last_play_text: string | null;
          last_event_at: string | null;
          updated_at: string;
        };
        Insert: {
          game_id: string;
          inning?: number;
          half?: InningHalf;
          outs?: number;
          runner_first?: string | null;
          runner_second?: string | null;
          runner_third?: string | null;
          team_score?: number;
          opponent_score?: number;
          last_play_text?: string | null;
          last_event_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["game_live_state"]["Insert"]>;
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
      game_links: {
        Row: {
          id: string;
          home_game_id: string;
          visitor_game_id: string;
          confirmed_at: string;
          confirmed_by: string | null;
        };
        Insert: {
          id?: string;
          home_game_id: string;
          visitor_game_id: string;
          confirmed_at?: string;
          confirmed_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["game_links"]["Insert"]>;
        Relationships: [];
      };
      score_discrepancies: {
        Row: {
          id: string;
          game_link_id: string;
          home_acct_home_score: number | null;
          home_acct_visitor_score: number | null;
          vis_acct_home_score: number | null;
          vis_acct_visitor_score: number | null;
          home_self_confirmed: boolean;
          visitor_self_confirmed: boolean;
          opened_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          game_link_id: string;
          home_acct_home_score?: number | null;
          home_acct_visitor_score?: number | null;
          vis_acct_home_score?: number | null;
          vis_acct_visitor_score?: number | null;
          home_self_confirmed?: boolean;
          visitor_self_confirmed?: boolean;
          opened_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["score_discrepancies"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_school_admin: { Args: { p_school: string }; Returns: boolean };
      is_team_member: { Args: { p_team: string }; Returns: boolean };
      is_season_closed: { Args: { yr: number }; Returns: boolean };
      season_year_for: { Args: { d: string }; Returns: number };
      create_school: {
        Args: { p_slug: string; p_name: string };
        Returns: Database["public"]["Tables"]["schools"]["Row"];
      };
      upsert_roster: {
        Args: {
          p_school: string;
          p_team: string;
          p_season: number;
          p_players: Json;
          p_has_number: boolean;
          p_has_position: boolean;
          p_has_grad_year: boolean;
        };
        Returns: Array<{ player_id: string; first_name: string; last_name: string }>;
      };
      ingest_stats_workbook: {
        Args: {
          p_school: string;
          p_team: string;
          p_upload_date: string;
          p_filename: string;
          p_players: Json;
          p_replace: boolean;
        };
        Returns: Array<{ upload_id: string; snapshot_count: number }>;
      };
      game_match_candidates: {
        Args: { p_my_game_id: string };
        Returns: Array<{
          candidate_game_id: string;
          game_date: string;
          game_time: string | null;
          game_sequence: number;
          status: GameStatus;
          is_home: boolean;
        }>;
      };
      confirm_game_link: {
        Args: { p_home_game_id: string; p_visitor_game_id: string };
        Returns: string;
      };
      unlink_games: { Args: { p_link_id: string }; Returns: void };
      confirm_my_score: { Args: { p_link_id: string }; Returns: void };
      find_relink_suggestions: {
        Args: { p_team_id: string };
        Returns: Array<{
          game_id: string;
          game_date: string;
          game_time: string | null;
          opponent_text: string;
          candidate_school_id: string;
          candidate_school_name: string;
          candidate_school_short_name: string | null;
          candidate_team_id: string;
          candidate_team_name: string;
          candidate_team_level: TeamLevel;
        }>;
      };
      apply_relink: {
        Args: { p_game_ids: string[]; p_target_team_id: string };
        Returns: number;
      };
    };
    Enums: { [_ in never]: never };
  };
};
