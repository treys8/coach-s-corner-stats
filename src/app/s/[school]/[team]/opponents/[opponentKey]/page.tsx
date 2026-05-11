"use client";

// Per-opponent drill-in. `opponentKey` is either a UUID (the opposing
// Statly team's team_id) or "name:<urlencoded>" (freeform opponent text).
// Shows the players you've faced from this opponent with per-player
// aggregate batting lines. Click into a player for the per-player page.

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";
import {
  EditOpposingPlayerDialog,
  type EditableOpponentPlayer,
} from "@/components/opponents/EditOpposingPlayerDialog";

interface OpponentRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  jersey_number: string | null;
}

interface AbRow {
  opponent_batter_id: string | null;
  result: string;
  rbi: number;
  game_id: string;
}

const HIT_RESULTS = new Set(["1B", "2B", "3B", "HR"]);
const NON_AB_RESULTS = new Set(["BB", "IBB", "HBP", "SAC", "SF", "CI"]);

const supabase = createClient();

export default function OpponentDetailPage({
  params,
}: {
  params: Promise<{ opponentKey: string }>;
}) {
  const { opponentKey } = use(params);
  const { school } = useSchool();
  const { team } = useTeam();

  const decoded = useMemo(() => decodeOpponentKey(opponentKey), [opponentKey]);
  const [players, setPlayers] = useState<OpponentRow[]>([]);
  const [atBats, setAtBats] = useState<AbRow[]>([]);
  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditableOpponentPlayer | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);

      // Identify games against this opponent so we can scope at_bats.
      const gamesQuery = supabase
        .from("games")
        .select("id, opponent, opponent_team_id")
        .eq("team_id", team.id);
      const gamesRes =
        decoded.kind === "team"
          ? await gamesQuery.eq("opponent_team_id", decoded.value)
          : await gamesQuery
              .ilike("opponent", decoded.value)
              .is("opponent_team_id", null);

      if (!active) return;
      if (gamesRes.error) {
        toast.error(`Couldn't load games: ${gamesRes.error.message}`);
        setLoading(false);
        return;
      }
      const gameRows = gamesRes.data ?? [];
      if (gameRows.length === 0) {
        setDisplayName(decoded.kind === "name" ? decoded.value : "Unknown opponent");
        setPlayers([]);
        setAtBats([]);
        setLoading(false);
        return;
      }
      setDisplayName(gameRows[0].opponent ?? decoded.value);

      // Opponent players who batted against us in these games.
      const gameIds = gameRows.map((g) => g.id);
      const abRes = await supabase
        .from("at_bats")
        .select("opponent_batter_id, result, rbi, game_id")
        .in("game_id", gameIds)
        .not("opponent_batter_id", "is", null);
      if (!active) return;
      if (abRes.error) {
        toast.error(`Couldn't load at-bats: ${abRes.error.message}`);
        setLoading(false);
        return;
      }
      const abs = (abRes.data ?? []) as unknown as AbRow[];
      setAtBats(abs);

      const playerIds = Array.from(
        new Set(abs.map((a) => a.opponent_batter_id).filter(Boolean) as string[]),
      );
      if (playerIds.length === 0) {
        setPlayers([]);
        setLoading(false);
        return;
      }
      const playersRes = await supabase
        .from("opponent_players")
        .select("id, first_name, last_name, jersey_number")
        .in("id", playerIds);
      if (!active) return;
      if (playersRes.error) {
        toast.error(`Couldn't load opponent players: ${playersRes.error.message}`);
      } else {
        setPlayers((playersRes.data ?? []) as OpponentRow[]);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [team.id, decoded]);

  // Aggregate per-player line from the loaded at_bats.
  const lineByPlayer = useMemo(() => {
    const out = new Map<string, { PA: number; AB: number; H: number; HR: number; SO: number; BB: number; RBI: number }>();
    for (const ab of atBats) {
      if (!ab.opponent_batter_id) continue;
      const line = out.get(ab.opponent_batter_id) ?? { PA: 0, AB: 0, H: 0, HR: 0, SO: 0, BB: 0, RBI: 0 };
      line.PA += 1;
      if (!NON_AB_RESULTS.has(ab.result)) line.AB += 1;
      if (HIT_RESULTS.has(ab.result)) line.H += 1;
      if (ab.result === "HR") line.HR += 1;
      if (ab.result === "BB" || ab.result === "IBB") line.BB += 1;
      if (ab.result === "K_swinging" || ab.result === "K_looking") line.SO += 1;
      line.RBI += ab.rbi;
      out.set(ab.opponent_batter_id, line);
    }
    return out;
  }, [atBats]);

  const rows = useMemo(() => {
    return players
      .map((p) => ({
        player: p,
        line: lineByPlayer.get(p.id) ?? { PA: 0, AB: 0, H: 0, HR: 0, SO: 0, BB: 0, RBI: 0 },
      }))
      .sort((a, b) => {
        // PA desc, then jersey num asc as tiebreaker
        if (b.line.PA !== a.line.PA) return b.line.PA - a.line.PA;
        return (a.player.jersey_number ?? "").localeCompare(b.player.jersey_number ?? "");
      });
  }, [players, lineByPlayer]);

  return (
    <main className="container mx-auto px-6 py-8 space-y-6">
      <header>
        <Link
          href={`/s/${school.slug}/${team.slug}/opponents`}
          className="text-xs text-muted-foreground hover:text-sa-orange uppercase tracking-wider"
        >
          ← Opponents
        </Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h2 className="font-display text-3xl text-sa-blue-deep">{displayName}</h2>
          {decoded.kind === "team" && (
            <Badge variant="secondary" className="uppercase tracking-wider text-[10px]">Statly tenant</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Players you've faced from this opponent. Click a row for spray chart + game-by-game log.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No at-bats recorded against this opponent yet.
        </p>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[80px_minmax(0,1fr)_60px_60px_60px_60px_60px_60px_60px_40px] gap-2 px-4 py-2 bg-muted/50 text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
            <div>#</div>
            <div>Player</div>
            <div className="text-right">PA</div>
            <div className="text-right">AB</div>
            <div className="text-right">H</div>
            <div className="text-right">HR</div>
            <div className="text-right">BB</div>
            <div className="text-right">SO</div>
            <div className="text-right">RBI</div>
            <div></div>
          </div>
          <ul>
            {rows.map(({ player, line }) => (
              <li
                key={player.id}
                className="border-t border-border grid grid-cols-[80px_minmax(0,1fr)_60px_60px_60px_60px_60px_60px_60px_40px] gap-2 px-4 py-3 hover:bg-accent/40 transition-colors text-sm items-center"
              >
                <Link
                  href={`/s/${school.slug}/${team.slug}/opponents/${opponentKey}/${player.id}`}
                  className="font-mono-stat font-bold hover:text-sa-orange"
                >
                  {player.jersey_number ?? "—"}
                </Link>
                <Link
                  href={`/s/${school.slug}/${team.slug}/opponents/${opponentKey}/${player.id}`}
                  className="truncate hover:text-sa-orange"
                >
                  {[player.first_name, player.last_name].filter(Boolean).join(" ") || "—"}
                </Link>
                <div className="text-right font-mono-stat">{line.PA}</div>
                <div className="text-right font-mono-stat">{line.AB}</div>
                <div className="text-right font-mono-stat">{line.H}</div>
                <div className="text-right font-mono-stat">{line.HR}</div>
                <div className="text-right font-mono-stat">{line.BB}</div>
                <div className="text-right font-mono-stat">{line.SO}</div>
                <div className="text-right font-mono-stat">{line.RBI}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 justify-self-end"
                  title="Edit name / jersey"
                  onClick={() => setEditing(player)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <EditOpposingPlayerDialog
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        player={editing}
        onSaved={(updated) => {
          setPlayers((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
          setEditing(null);
        }}
      />
    </main>
  );
}

function decodeOpponentKey(
  raw: string,
): { kind: "team"; value: string } | { kind: "name"; value: string } {
  if (raw.startsWith("name:")) {
    return { kind: "name", value: decodeURIComponent(raw.slice("name:".length)) };
  }
  return { kind: "team", value: raw };
}
