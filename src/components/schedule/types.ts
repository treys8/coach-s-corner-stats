import type { GameLocation, GameResult, GameStatus } from "@/integrations/supabase/types";

export interface Game {
  id: string;
  game_date: string;
  game_time: string | null;
  opponent: string;
  opponent_team_id: string | null;
  location: GameLocation;
  team_score: number | null;
  opponent_score: number | null;
  result: GameResult | null;
  notes: string | null;
  season_year: number;
  status: GameStatus;
  is_final: boolean;
}
