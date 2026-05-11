"use client";

// Opponents list — every opposing team this team has on its schedule,
// with played-vs-upcoming counts and a "Pull roster" affordance when the
// opposing school is a Statly tenant. Drill into one to see your records
// of their players.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";

interface OpponentGroup {
  /** Opaque key for routing — opponent_team_id if Statly-linked, otherwise
   *  the freeform name. */
  routeKey: string;
  display: string;
  opponent_team_id: string | null;
  played: number;
  upcoming: number;
}

const supabase = createClient();
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function OpponentsPage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const [games, setGames] = useState<Array<{
    opponent: string;
    opponent_team_id: string | null;
    game_date: string;
    status: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("games")
        .select("opponent, opponent_team_id, game_date, status")
        .eq("team_id", team.id);
      if (!active) return;
      if (error) {
        toast.error(`Couldn't load games: ${error.message}`);
      } else {
        setGames(data ?? []);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [team.id]);

  const groups = useMemo<OpponentGroup[]>(() => {
    const byKey = new Map<string, OpponentGroup>();
    const today = todayIso();
    for (const g of games) {
      const key = g.opponent_team_id ?? `name:${g.opponent.trim().toLowerCase()}`;
      const existing = byKey.get(key) ?? {
        routeKey: g.opponent_team_id ?? `name:${encodeURIComponent(g.opponent.trim())}`,
        display: g.opponent,
        opponent_team_id: g.opponent_team_id,
        played: 0,
        upcoming: 0,
      };
      const played =
        g.status === "final" ||
        (g.status === "in_progress") ||
        (g.game_date < today);
      if (played) existing.played += 1;
      else existing.upcoming += 1;
      byKey.set(key, existing);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.display.localeCompare(b.display),
    );
  }, [games]);

  return (
    <main className="container mx-auto px-6 py-8 space-y-6">
      <header>
        <h2 className="font-display text-3xl text-sa-blue-deep">Opponents</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Teams this {team.name.toLowerCase()} squad is scheduled against. Drill in
          to see records of their players from games {school.short_name ?? school.name} has scored.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No games on the schedule yet. Add or upload a schedule to populate this list.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map((g) => (
            <li key={g.routeKey}>
              <Link
                href={`/s/${school.slug}/${team.slug}/opponents/${g.routeKey}`}
                className="block hover:no-underline"
              >
                <Card className="p-4 h-full hover:border-sa-orange transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-lg text-sa-blue-deep truncate">
                      {g.display}
                    </p>
                    {g.opponent_team_id && (
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                        Statly
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                    <span>
                      <span className="font-mono-stat font-bold text-sa-blue-deep">{g.played}</span>{" "}
                      played
                    </span>
                    <span>
                      <span className="font-mono-stat font-bold text-sa-blue-deep">{g.upcoming}</span>{" "}
                      upcoming
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
