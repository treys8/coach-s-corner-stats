import type { GameLocation, GameResult } from "@/integrations/supabase/types";

export interface Game {
  id: string;
  game_date: string;
  game_time: string | null;
  opponent: string;
  location: GameLocation;
  team_score: number | null;
  opponent_score: number | null;
  result: GameResult | null;
  notes: string | null;
  season_year: number;
  is_final: boolean;
}
