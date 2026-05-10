import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Sport } from "@/integrations/supabase/types";
import {
  isAssociation,
  isClassification,
  isDivision,
} from "@/lib/school-classifications";
import { ScoresFilters } from "./ScoresFilters";

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

interface SchoolRef {
  slug: string;
  name: string;
  short_name: string | null;
}

interface TeamRef {
  id: string;
  slug: string;
  name: string;
  sport: Sport;
  schools: SchoolRef | null;
}

interface LiveState {
  inning: number;
  half: "top" | "bottom";
  team_score: number;
  opponent_score: number;
  last_event_at: string | null;
  updated_at: string;
}

interface GameRow {
  id: string;
  team_id: string;
  opponent_team_id: string | null;
  opponent: string;
  is_home: boolean;
  game_date: string;
  game_time: string | null;
  team_score: number | null;
  opponent_score: number | null;
  status: GameStatus;
  finalized_at: string | null;
  updated_at: string;
  game_live_state: LiveState | null;
  teams: TeamRef | null;
}

interface ExternalTeam {
  id: string;
  name: string;
  schools: SchoolRef | null;
}

interface LinkRow {
  id: string;
  home_game_id: string;
  visitor_game_id: string;
}

interface SideRef {
  displayName: string;
  shortName: string | null;
}

interface Tile {
  id: string;
  date: string;
  sport: Sport;
  home: SideRef;
  visitor: SideRef;
  homeScore: number | null;
  visitorScore: number | null;
  status: GameStatus;
  liveInning: number | null;
  liveHalf: "top" | "bottom" | null;
  liveLastEventAt: string | null;
  reporterLabel: string | null;
  showUpdated: boolean;
}

const SPORT_LABEL: Record<Sport, string> = { baseball: "Baseball", softball: "Softball" };

const HEARTBEAT_STALE_MS = 24 * 60 * 60 * 1000;
const UPDATED_BADGE_MS = 48 * 60 * 60 * 1000;
// Finalize itself stamps both finalized_at and updated_at; anything inside this
// window is the original write, not a correction.
const FINALIZE_GRACE_MS = 60 * 1000;

const sideFromSchool = (s: SchoolRef | null, fallback?: string): SideRef => ({
  displayName: s?.name ?? fallback ?? "—",
  shortName: s?.short_name ?? null,
});

const sideFromText = (text: string): SideRef => ({ displayName: text, shortName: null });

const sideLabel = (s: SideRef): string => s.shortName ?? s.displayName;

const heartbeatAgeMs = (ts: string | null): number | null =>
  ts ? Date.now() - new Date(ts).getTime() : null;

function buildLinkedTile(home: GameRow, visitor: GameRow): Tile {
  // Once either side flips to final, the public surface treats the game as
  // finalized — heartbeat-stickiness only applies while both records are
  // still actively scoring.
  const bothLive =
    home.status === "in_progress" && visitor.status === "in_progress";
  const homeSide = sideFromSchool(home.teams?.schools ?? null);
  const visitorSide = sideFromSchool(visitor.teams?.schools ?? null);

  let homeScore: number | null = null;
  let visitorScore: number | null = null;
  let liveInning: number | null = null;
  let liveHalf: "top" | "bottom" | null = null;
  let liveLastEventAt: string | null = null;
  let reporterLabel: string | null = null;

  if (bothLive) {
    // Heartbeat-stickiness: home wins if it has ever heartbeated. Falling back
    // to visitor only when home has *never* checked in avoids public-score
    // flip-flop during a weather/lunch pause.
    const homeLs = home.game_live_state;
    const visitorLs = visitor.game_live_state;
    const homeEver = homeLs?.last_event_at ?? null;
    if (homeEver || !visitorLs?.last_event_at) {
      if (homeLs) {
        homeScore = homeLs.team_score;
        visitorScore = homeLs.opponent_score;
        liveInning = homeLs.inning;
        liveHalf = homeLs.half;
        liveLastEventAt = homeLs.last_event_at;
      }
    } else {
      homeScore = visitorLs.opponent_score;
      visitorScore = visitorLs.team_score;
      liveInning = visitorLs.inning;
      liveHalf = visitorLs.half;
      liveLastEventAt = visitorLs.last_event_at;
      reporterLabel = `Reported by ${sideLabel(visitorSide)}`;
    }
  } else if (home.status === "final") {
    // Either both finalized or only home — both cases show home's score.
    homeScore = home.team_score;
    visitorScore = home.opponent_score;
  } else if (visitor.status === "final") {
    // Visitor finalized first; show visitor's number until home catches up.
    homeScore = visitor.opponent_score;
    visitorScore = visitor.team_score;
    reporterLabel = `Reported by ${sideLabel(visitorSide)}`;
  }

  // Updated badge: any UPDATE writes >60s after finalize signal a correction.
  const homeFinal = home.finalized_at ? new Date(home.finalized_at).getTime() : null;
  const visFinal = visitor.finalized_at ? new Date(visitor.finalized_at).getTime() : null;
  const finalAt = [homeFinal, visFinal].filter((t): t is number => t != null).sort((a, b) => a - b)[0] ?? null;
  const latestUpdate = Math.max(
    new Date(home.updated_at).getTime(),
    new Date(visitor.updated_at).getTime(),
  );
  const showUpdated =
    !bothLive &&
    finalAt != null &&
    latestUpdate - finalAt > FINALIZE_GRACE_MS &&
    Date.now() - latestUpdate < UPDATED_BADGE_MS;

  return {
    id: home.id,
    date: home.game_date,
    sport: home.teams?.sport ?? visitor.teams?.sport ?? "baseball",
    home: homeSide,
    visitor: visitorSide,
    homeScore,
    visitorScore,
    status: bothLive ? "in_progress" : "final",
    liveInning,
    liveHalf,
    liveLastEventAt,
    reporterLabel,
    showUpdated,
  };
}

function buildUnlinkedTile(g: GameRow, externals: Map<string, ExternalTeam>): Tile {
  const isLive = g.status === "in_progress";
  const myIsHome = g.is_home;
  const mySide = sideFromSchool(g.teams?.schools ?? null);

  const opponent = g.opponent_team_id ? externals.get(g.opponent_team_id) ?? null : null;
  const opponentSide = opponent
    ? sideFromSchool(opponent.schools, g.opponent)
    : sideFromText(g.opponent);

  const home = myIsHome ? mySide : opponentSide;
  const visitor = myIsHome ? opponentSide : mySide;

  let homeScore: number | null;
  let visitorScore: number | null;
  let liveInning: number | null = null;
  let liveHalf: "top" | "bottom" | null = null;
  let liveLastEventAt: string | null = null;

  if (isLive && g.game_live_state) {
    const ts = g.game_live_state.team_score;
    const os = g.game_live_state.opponent_score;
    homeScore = myIsHome ? ts : os;
    visitorScore = myIsHome ? os : ts;
    liveInning = g.game_live_state.inning;
    liveHalf = g.game_live_state.half;
    liveLastEventAt = g.game_live_state.last_event_at;
  } else {
    homeScore = myIsHome ? g.team_score : g.opponent_score;
    visitorScore = myIsHome ? g.opponent_score : g.team_score;
  }

  // The other side never reported (free-text or just not on Statly), so flag
  // who the public-visible number is from when it isn't the home team.
  const reporterLabel = !myIsHome ? `Reported by ${sideLabel(mySide)}` : null;

  const finalAt = g.finalized_at ? new Date(g.finalized_at).getTime() : null;
  const updatedAt = new Date(g.updated_at).getTime();
  const showUpdated =
    !isLive &&
    finalAt != null &&
    updatedAt - finalAt > FINALIZE_GRACE_MS &&
    Date.now() - updatedAt < UPDATED_BADGE_MS;

  return {
    id: g.id,
    date: g.game_date,
    sport: g.teams?.sport ?? "baseball",
    home,
    visitor,
    homeScore,
    visitorScore,
    status: isLive ? "in_progress" : "final",
    liveInning,
    liveHalf,
    liveLastEventAt,
    reporterLabel,
    showUpdated,
  };
}

// Freshness signal for an in-progress game. Prefer the most recent event; if
// the game just started and has no events yet, fall back to when game_live_state
// itself was created/updated so warming-up tiles aren't hidden right at start.
const liveFreshness = (ls: LiveState | null | undefined): string | null =>
  ls?.last_event_at ?? ls?.updated_at ?? null;

function isStaleLinked(home: GameRow, visitor: GameRow): boolean {
  if (home.status !== "in_progress" || visitor.status !== "in_progress") return false;
  const homeAge = heartbeatAgeMs(liveFreshness(home.game_live_state));
  const visAge = heartbeatAgeMs(liveFreshness(visitor.game_live_state));
  // Per the architecture doc: hide only when both sides are >24h old. Null
  // freshness means there's no game_live_state at all — treat as stale so a
  // dangling in_progress without any state row doesn't pin to /scores.
  const homeStale = homeAge == null || homeAge > HEARTBEAT_STALE_MS;
  const visStale = visAge == null || visAge > HEARTBEAT_STALE_MS;
  return homeStale && visStale;
}

function isStaleUnlinked(g: GameRow): boolean {
  if (g.status !== "in_progress") return false;
  const age = heartbeatAgeMs(liveFreshness(g.game_live_state));
  return age == null || age > HEARTBEAT_STALE_MS;
}

function buildTiles(
  games: GameRow[],
  links: LinkRow[],
  externals: Map<string, ExternalTeam>,
): Tile[] {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const linkByGameId = new Map<string, { partnerId: string; isHome: boolean }>();
  for (const l of links) {
    linkByGameId.set(l.home_game_id, { partnerId: l.visitor_game_id, isHome: true });
    linkByGameId.set(l.visitor_game_id, { partnerId: l.home_game_id, isHome: false });
  }

  const consumed = new Set<string>();
  const tiles: Tile[] = [];

  for (const g of games) {
    if (consumed.has(g.id)) continue;
    const info = linkByGameId.get(g.id);
    const partner = info ? gameById.get(info.partnerId) : null;
    if (info && partner) {
      const home = info.isHome ? g : partner;
      const visitor = info.isHome ? partner : g;
      consumed.add(home.id);
      consumed.add(visitor.id);
      if (isStaleLinked(home, visitor)) continue;
      tiles.push(buildLinkedTile(home, visitor));
    } else {
      consumed.add(g.id);
      // Partner not in the visible set (e.g. their school flipped public_scores
      // off) — render this side alone with the standard reporter labeling.
      if (isStaleUnlinked(g)) continue;
      tiles.push(buildUnlinkedTile(g, externals));
    }
  }

  return tiles;
}

const groupByDate = (tiles: Tile[]) => {
  const map = new Map<string, Tile[]>();
  for (const t of tiles) {
    const list = map.get(t.date) ?? [];
    list.push(t);
    map.set(t.date, list);
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
  searchParams: Promise<{
    school?: string;
    sport?: string;
    association?: string;
    classification?: string;
    division?: string;
  }>;
}

export default async function ScoresPage({ searchParams }: ScoresPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("games")
    .select(
      "id, team_id, opponent_team_id, opponent, is_home, game_date, game_time, team_score, opponent_score, status, finalized_at, updated_at, game_live_state(inning, half, team_score, opponent_score, last_event_at, updated_at), teams!inner(id, slug, name, sport, schools!inner(slug, name, short_name))",
    )
    .in("status", ["in_progress", "final"])
    .order("status", { ascending: true })
    .order("game_date", { ascending: false })
    .limit(200);

  if (params.sport === "baseball" || params.sport === "softball") {
    query = query.eq("teams.sport", params.sport);
  }
  if (params.school) {
    query = query.eq("teams.schools.slug", params.school);
  }
  if (isAssociation(params.association)) {
    query = query.eq("teams.schools.association", params.association);
  }
  if (isClassification(params.classification)) {
    query = query.eq("teams.schools.classification", params.classification);
  }
  if (isDivision(params.division)) {
    query = query.eq("teams.schools.division", params.division);
  }

  const { data: gamesData, error } = await query;
  const games = (gamesData ?? []) as unknown as GameRow[];

  const gameIds = games.map((g) => g.id);
  // Two parallel .in() queries instead of one .or().in() — keeps each URL well
  // under PostgREST's length limit at 200 visible games and dodges supabase-js
  // comma-escaping edge cases inside .or() clauses.
  const [homeLinksResp, visitorLinksResp] = gameIds.length
    ? await Promise.all([
        supabase
          .from("game_links")
          .select("id, home_game_id, visitor_game_id")
          .in("home_game_id", gameIds),
        supabase
          .from("game_links")
          .select("id, home_game_id, visitor_game_id")
          .in("visitor_game_id", gameIds),
      ])
    : [{ data: [] as LinkRow[] }, { data: [] as LinkRow[] }];
  const linksById = new Map<string, LinkRow>();
  for (const row of [...(homeLinksResp.data ?? []), ...(visitorLinksResp.data ?? [])] as LinkRow[]) {
    linksById.set(row.id, row);
  }
  const links = Array.from(linksById.values());

  // Resolve opponent_team_id -> { name, school } for unlinked games whose
  // opposing team isn't already in our query result.
  const inResultTeamIds = new Set(games.map((g) => g.team_id));
  const externalIds = Array.from(
    new Set(
      games
        .map((g) => g.opponent_team_id)
        .filter((id): id is string => !!id && !inResultTeamIds.has(id)),
    ),
  );
  const externalsResp = externalIds.length
    ? await supabase
        .from("teams")
        .select("id, name, schools!inner(slug, name, short_name)")
        .in("id", externalIds)
    : { data: [] as ExternalTeam[], error: null };
  const externals = new Map<string, ExternalTeam>(
    ((externalsResp.data ?? []) as unknown as ExternalTeam[]).map((t) => [t.id, t]),
  );

  const tiles = buildTiles(games, links, externals);
  const live = tiles.filter((t) => t.status === "in_progress");
  const finals = tiles.filter((t) => t.status === "final");
  const grouped = groupByDate(finals);

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
        <ScoresFilters />
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
            Couldn&apos;t load scores: {error.message}
          </div>
        ) : grouped.length === 0 && live.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-12 text-center">
            <p className="font-display text-2xl text-sa-blue-deep mb-2">No games yet</p>
            <p className="text-sm text-muted-foreground">
              {params.school ||
              params.sport ||
              params.association ||
              params.classification ||
              params.division
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
                  {live.map((t) => (
                    <ScoreCard key={t.id} tile={t} />
                  ))}
                </div>
              </section>
            )}
            {grouped.map(([date, ts]) => (
              <section key={date}>
                <h2 className="font-display text-xl text-sa-blue uppercase tracking-wider mb-3">
                  {fmtDate(date)}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ts.map((t) => (
                    <ScoreCard key={t.id} tile={t} />
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

function ScoreCard({ tile }: { tile: Tile }) {
  const isLive = tile.status === "in_progress";
  const accent = isLive ? "border-sa-orange shadow-orange" : "border-border";
  const inningLabel =
    tile.liveInning != null && tile.liveHalf
      ? `${tile.liveHalf === "top" ? "Top" : "Bot"} ${tile.liveInning}`
      : null;
  const footerParts = [
    tile.reporterLabel,
    isLive && tile.liveLastEventAt ? syncedAgo(tile.liveLastEventAt) : null,
  ].filter(Boolean);

  return (
    <div className={`p-4 bg-card border rounded-lg shadow-card ${accent}`}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {SPORT_LABEL[tile.sport]}
        </p>
        <div className="flex items-center gap-1.5">
          {tile.showUpdated && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sa-blue/10 text-sa-blue">
              Updated
            </span>
          )}
          {isLive && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-sa-orange flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-sa-orange animate-pulse" />
              Live{inningLabel ? ` · ${inningLabel}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <SidePanel side={tile.visitor} score={tile.visitorScore} />
        <span className="text-muted-foreground font-mono-stat">@</span>
        <SidePanel side={tile.home} score={tile.homeScore} alignRight />
      </div>

      {footerParts.length > 0 && (
        <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          {footerParts.join(" · ")}
        </p>
      )}
    </div>
  );
}

function SidePanel({
  side,
  score,
  alignRight,
}: {
  side: SideRef;
  score: number | null;
  alignRight?: boolean;
}) {
  return (
    <div className={`flex-1 min-w-0 flex items-center gap-3 ${alignRight ? "justify-end text-right" : ""}`}>
      {alignRight && (
        <span className="font-mono-stat text-2xl font-bold text-sa-blue-deep">
          {score ?? "—"}
        </span>
      )}
      <p className="font-display text-base text-sa-blue-deep truncate">
        {side.shortName ?? side.displayName}
      </p>
      {!alignRight && (
        <span className="font-mono-stat text-2xl font-bold text-sa-blue-deep ml-auto">
          {score ?? "—"}
        </span>
      )}
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
