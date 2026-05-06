export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      csv_uploads: {
        Row: {
          created_at: string
          filename: string | null
          id: string
          notes: string | null
          player_count: number
          season_year: number
          upload_date: string
        }
        Insert: {
          created_at?: string
          filename?: string | null
          id?: string
          notes?: string | null
          player_count?: number
          season_year: number
          upload_date: string
        }
        Update: {
          created_at?: string
          filename?: string | null
          id?: string
          notes?: string | null
          player_count?: number
          season_year?: number
          upload_date?: string
        }
        Relationships: []
      }
      games: {
        Row: {
          created_at: string
          game_date: string
          game_time: string | null
          id: string
          location: string
          notes: string | null
          opponent: string
          opponent_score: number | null
          result: string | null
          season_year: number
          team_score: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_date: string
          game_time?: string | null
          id?: string
          location?: string
          notes?: string | null
          opponent: string
          opponent_score?: number | null
          result?: string | null
          season_year: number
          team_score?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_date?: string
          game_time?: string | null
          id?: string
          location?: string
          notes?: string | null
          opponent?: string
          opponent_score?: number | null
          result?: string | null
          season_year?: number
          team_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      glossary: {
        Row: {
          abbreviation: string
          category: string | null
          created_at: string
          definition: string
          id: string
        }
        Insert: {
          abbreviation: string
          category?: string | null
          created_at?: string
          definition: string
          id?: string
        }
        Update: {
          abbreviation?: string
          category?: string | null
          created_at?: string
          definition?: string
          id?: string
        }
        Relationships: []
      }
      players: {
        Row: {
          created_at: string
          first_name: string
          id: string
          jersey_number: string
          last_name: string
          season_year: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_name: string
          id?: string
          jersey_number: string
          last_name: string
          season_year: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_name?: string
          id?: string
          jersey_number?: string
          last_name?: string
          season_year?: number
          updated_at?: string
        }
        Relationships: []
      }
      stat_snapshots: {
        Row: {
          created_at: string
          id: string
          player_id: string
          season_year: number
          stats: Json
          upload_date: string
          upload_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          season_year: number
          stats: Json
          upload_date: string
          upload_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          season_year?: number
          stats?: Json
          upload_date?: string
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stat_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_season_closed: { Args: { yr: number }; Returns: boolean }
      season_year_for: { Args: { d: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
