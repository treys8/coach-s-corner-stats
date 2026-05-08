import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Sport } from "@/integrations/supabase/types";

export const metadata: Metadata = {
  title: "Scores — Statly",
  description: "High school baseball scores from schools using Statly.",
};

// Re-fetch on each request so finalized games show up promptly without a
// full redeploy. Could swap for ISR with a short revalidate when traffic
// grows; for now `force-dynamic` keeps the data fresh and the auth-gated
// admin views unaffected.
export const dynamic = "force-dynamic";

type GameStatus = "in_progress" | "final";

interface ScoreTileGame {
  id: string;
  game_date: string;
  game_time: string | null;
  opponent: string;
  location: "home" | "away" | "neutral";
  team_score: number | null;
  opponent_score: number | null;
  result: "W" | "L" | "T" | null;
  status: GameStatus;
  finalized_at: string | null;
  game_live_state: {
    inning: number;
    half: "top" | "bottom";
    team_score: number;
    opponent_score: number;
    last_event_at: string | null;
  } | null;
  teams: {
    id: string;
    slug: string;
    name: string;
    sport: Sport;
    schools: { slug: string; name: string; short_name: string | null } | null;
  } | null;
}

const SPORT_LABEL: Record<Sport, string> = { baseball: "Baseball", softball: "Softball" };

const groupByDate = (games: ScoreTileGame[]) => {
  const map = new Map<string, ScoreTileGame[]>();
  for (const g of games) {
    const list = map.get(g.game_date) ?? [];
    list.push(g);
    map.set(g.game_date, list);
  }
  return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
};

const fmtDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

interface ScoresPageProps {
  searchParams: Promise<{ school?: string; sport?: string }>;
}

export default async function ScoresPage({ searchParams }: ScoresPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("games")
    .select(
      "id, game_date, game_time, opponent, location, team_score, opponent_score, result, status, finalized_at, game_live_state(inning, half, team_score, opponent_score, last_event_at), teams!inner(id, slug, name, sport, schools!inner(slug, name, short_name))",
    )
    .in("status", ["in_progress", "final"])
    .order("status", { ascending: true })   // in_progress before final
    .order("game_date", { ascending: false })
    .limit(100);

  if (params.sport === "baseball" || params.sport === "softball") {
    query = query.eq("teams.sport", params.sport);
  }
  if (params.school) {
    query = query.eq("teams.schools.slug", params.school);
  }

  const { data, error } = await query;
  const games = (data ?? []) as unknown as ScoreTileGame[];
  const live = games.filter((g) => g.status === "in_progress");
  const finalGames = games.filter((g) => g.status === "final");
  const grouped = groupByDate(finalGames);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-gradient-blue text-white border-b-4 border-sa-orange">
        <div className="container mx-auto px-6 py-8 flex items-center justify-between gap-6">
          <div>
            <Link href="/" className="text-xs uppercase tracking-[0.2em] text-sa-orange font-semibold hover:underline">
              Statly
            </Link>
            <h1 className="font-display text-5xl md:text-6xl">Scores</h1>
            <p className="text-white/70 mt-2 text-sm">
              Finalized games from schools using Statly. Most recent first.
            </p>
          </div>
          <Link
            href="/login"
            className="hidden sm:inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold uppercase tracking-wider text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            Coach sign-in
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-6 py-10">
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
            Couldn&apos;t load scores: {error.message}
          </div>
        ) : grouped.length === 0 && live.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-12 text-center">
            <p className="font-display text-2xl text-sa-blue-deep mb-2">No games yet</p>
            <p className="text-sm text-muted-foreground">
              {params.school || params.sport
                ? "No games match those filters."
                : "Once coaches finalize games on Statly, they'll show up here."}
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {live.length > 0 && (
              <section>
                <h2 className="font-display text-xl text-sa-orange uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-sa-orange animate-pulse" />
                  Live now
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {live.map((g) => (
                    <ScoreCard key={g.id} game={g} />
                  ))}
                </div>
              </section>
            )}
            {grouped.map(([date, gs]) => (
              <section key={date}>
                <h2 className="font-display text-xl text-sa-blue uppercase tracking-wider mb-3">
                  {fmtDate(date)}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {gs.map((g) => (
                    <ScoreCard key={g.id} game={g} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t bg-muted/40 py-6 mt-12">
        <div className="container mx-auto px-6 text-center text-xs text-muted-foreground">
          Statly · <Link href="/login" className="hover:text-sa-orange">Coach sign-in</Link>
        </div>
      </footer>
    </div>
  );
}

function ScoreCard({ game }: { game: ScoreTileGame }) {
  const team = game.teams;
  const school = team?.schools;
  if (!team || !school) return null;
  const isLive = game.status === "in_progress";
  const liveScore = game.game_live_state;

  const teamScore = isLive
    ? (liveScore?.team_score ?? null)
    : game.team_score;
  const opponentScore = isLive
    ? (liveScore?.opponent_score ?? null)
    : game.opponent_score;

  const won = !isLive && game.result === "W";
  const lost = !isLive && game.result === "L";
  const accent = isLive
    ? "border-sa-orange shadow-orange"
    : won ? "border-sa-blue/60" : lost ? "border-sa-orange/60" : "border-border";
  const inningLabel = liveScore
    ? `${liveScore.half === "top" ? "Top" : "Bot"} ${liveScore.inning}`
    : null;

  return (
    <div className={`p-4 bg-card border rounded-lg shadow-card flex items-center gap-4 ${accent}`}>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {SPORT_LABEL[team.sport]}
        </p>
        <p className="font-display text-lg text-sa-blue-deep truncate">
          {school.short_name || school.name}
          <span className="text-muted-foreground font-normal"> · {team.name}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {game.location === "home" ? "vs" : game.location === "away" ? "@" : "neutral"}{" "}
          <span className="font-semibold text-foreground">{game.opponent}</span>
        </p>
        {isLive && (
          <p className="text-[10px] uppercase tracking-wider text-sa-orange font-bold mt-1 flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-sa-orange animate-pulse" />
            Live · {inningLabel ?? "warming up"}
            {liveScore?.last_event_at && (
              <span className="text-muted-foreground font-normal normal-case">
                · {syncedAgo(liveScore.last_event_at)}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="text-right">
        {teamScore !== null && opponentScore !== null ? (
          <p className="font-mono-stat text-2xl font-bold text-sa-blue-deep">
            {teamScore} <span className="text-muted-foreground">–</span> {opponentScore}
          </p>
        ) : (
          <p className="font-mono-stat text-sm text-muted-foreground">{isLive ? "starting" : "final"}</p>
        )}
        {!isLive && game.result && (
          <p className={`text-[10px] font-bold uppercase tracking-wider ${
            won ? "text-sa-blue" : lost ? "text-sa-orange" : "text-muted-foreground"
          }`}>
            {game.result}
          </p>
        )}
      </div>
    </div>
  );
}

function syncedAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `synced ${min}m ago`;
  const hr = Math.round(min / 60);
  return `synced ${hr}h ago`;
}
