"use client";

// Live-game side panel: when the opposing team is batting, shows the
// current opposing batter's career line + spray chart against your school.
// Fetched on each batter change from /api/opponents/[id]/profile.

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SprayField, type SprayMarker } from "@/components/spray/SprayField";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";

interface Props {
  opponentPlayerId: string | null;
  /** Slot context — shown as the header when profile hasn't resolved yet
   *  or when the opponent has no prior PAs to derive stats from. */
  slotLabel: string | null;
  /** Optional caller-owned cache. When provided, the panel will hydrate
   *  immediately from the cache on hit and write back on successful fetch.
   *  Live scoring lifts a Map ref here so cycling through a 9-deep lineup
   *  fetches each batter once instead of once per cycle. */
  cache?: Map<string, OpposingBatterProfile>;
  /** In-game batted-ball markers for this batter, merged into the same
   *  spray chart so the coach sees career + current game together instead
   *  of two side-by-side panels. */
  currentGameMarkers?: SprayMarker[];
  /** ISO date of the current game. Lets the year filter classify in-game
   *  markers (which carry no game_date of their own). */
  currentGameDate?: string;
  /** Current game_id. The career profile is fetched from /api/opponents/.../profile
   *  which returns every persisted at_bat (including any from this game that
   *  have already been written). We strip those rows from the career layer
   *  so they don't double up against the in-game markers passed in. */
  currentGameId?: string;
}

const YEAR_ALL = "all";

export function OpposingBatterPanel({
  opponentPlayerId,
  slotLabel,
  cache,
  currentGameMarkers,
  currentGameDate,
  currentGameId,
}: Props) {
  const [profile, setProfile] = useState<OpposingBatterProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<string>(YEAR_ALL);

  useEffect(() => {
    if (!opponentPlayerId) {
      setProfile(null);
      return;
    }
    const cached = cache?.get(opponentPlayerId);
    if (cached) {
      setProfile(cached);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setProfile(null);
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/opponents/${opponentPlayerId}/profile`);
        if (!res.ok) {
          if (!cancelled) setError("Couldn't load opponent profile");
          return;
        }
        const data = (await res.json()) as OpposingBatterProfile;
        if (cancelled) return;
        cache?.set(opponentPlayerId, data);
        setProfile(data);
      } catch {
        if (!cancelled) setError("Couldn't load opponent profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [opponentPlayerId, cache]);

  // Career markers carry their own game_date; in-game markers borrow the
  // active game's date so the year filter can classify them too. The career
  // layer drops any rows from the current game — those are sourced from
  // `currentGameMarkers` instead, avoiding double-counting after a reload
  // (the profile API returns persisted at_bats including the live game).
  const careerMarkersWithYear = useMemo(() => {
    if (!profile) return [] as Array<{ marker: SprayMarker; year: string }>;
    return profile.sprayPoints
      .filter((p) => !currentGameId || p.game_id !== currentGameId)
      .map((p, i) => ({
        marker: {
          id: `career-${p.game_id}-${i}`,
          result: p.result,
          spray_x: p.x,
          spray_y: p.y,
          description: null,
        },
        year: yearOf(p.game_date),
      }));
  }, [profile, currentGameId]);

  const currentMarkersWithYear = useMemo(() => {
    const y = currentGameDate ? yearOf(currentGameDate) : null;
    return (currentGameMarkers ?? []).map((m) => ({ marker: m, year: y ?? "" }));
  }, [currentGameMarkers, currentGameDate]);

  // Unique years, newest first, used to populate the filter buttons.
  const availableYears = useMemo(() => {
    const set = new Set<string>();
    for (const { year } of careerMarkersWithYear) if (year) set.add(year);
    for (const { year } of currentMarkersWithYear) if (year) set.add(year);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [careerMarkersWithYear, currentMarkersWithYear]);

  // Reset the year filter when the batter changes so a stale year selection
  // from the previous PA doesn't accidentally hide the new batter's data.
  useEffect(() => {
    setYear(YEAR_ALL);
  }, [opponentPlayerId]);

  const markers: SprayMarker[] = useMemo(() => {
    const combined = [...careerMarkersWithYear, ...currentMarkersWithYear];
    const filtered = year === YEAR_ALL ? combined : combined.filter((m) => m.year === year);
    return filtered.map((m) => m.marker);
  }, [careerMarkersWithYear, currentMarkersWithYear, year]);

  if (!opponentPlayerId) {
    return (
      <Card className="p-4 space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          At the plate
        </p>
        <p className="text-sm">
          {slotLabel ?? "No opposing batter set."}
        </p>
      </Card>
    );
  }

  const identityLabel = profile
    ? formatIdentity(profile)
    : slotLabel ?? "Opposing batter";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            At the plate
          </p>
          <p className="font-display text-lg text-sa-blue-deep">{identityLabel}</p>
        </div>
        {profile && (
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
            {profile.games.length} game{profile.games.length === 1 ? "" : "s"} vs you
          </Badge>
        )}
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading career…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {profile && profile.line.PA > 0 && (
        <div className="grid grid-cols-6 gap-2 text-center text-xs">
          <Stat label="PA" value={profile.line.PA} />
          <Stat label="AVG" value={fmtPct(profile.line.AVG)} />
          <Stat label="OBP" value={fmtPct(profile.line.OBP)} />
          <Stat label="SLG" value={fmtPct(profile.line.SLG)} />
          <Stat label="HR" value={profile.line.HR} />
          <Stat label="SO" value={profile.line.SO} />
        </div>
      )}

      {profile && profile.line.PA === 0 && !loading && (
        <p className="text-xs text-muted-foreground">
          First time we've faced this batter.
        </p>
      )}

      {(careerMarkersWithYear.length > 0 || currentMarkersWithYear.length > 0) && (
        <div className="-mx-1 space-y-2">
          {availableYears.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 px-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
                Year
              </span>
              <YearPill
                label="All"
                active={year === YEAR_ALL}
                onClick={() => setYear(YEAR_ALL)}
              />
              {availableYears.map((y) => (
                <YearPill
                  key={y}
                  label={y}
                  active={year === y}
                  onClick={() => setYear(y)}
                />
              ))}
            </div>
          )}
          <SprayField
            markers={markers}
            emptyMessage={
              year === YEAR_ALL
                ? "No spray points yet."
                : `No spray points in ${year}.`
            }
            countsInLegend
          />
        </div>
      )}
    </Card>
  );
}

function YearPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-[11px] px-2 py-0.5 rounded-full border transition-colors " +
        (active
          ? "bg-sa-blue-deep text-white border-sa-blue-deep"
          : "bg-transparent text-muted-foreground border-border hover:bg-muted")
      }
    >
      {label}
    </button>
  );
}

function yearOf(isoDate: string): string {
  // ISO dates start with YYYY — safe to slice; defensively fall back to the
  // full string if something upstream hands us a non-ISO value.
  return /^\d{4}/.test(isoDate) ? isoDate.slice(0, 4) : isoDate;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono-stat font-bold text-sa-blue-deep">{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

function fmtPct(n: number): string {
  // Baseball convention: AVG/OBP/SLG render as .XXX with any leading digit
  // before the decimal stripped. e.g. 0.328 -> ".328", 1.000 -> ".000",
  // 2.000 -> ".000". Empty state keeps "—" so a zero-PA batter doesn't look
  // like a real .000 line.
  if (n === 0) return "—";
  return n.toFixed(3).replace(/^\d+/, "");
}

function formatIdentity(p: OpposingBatterProfile): string {
  const num = p.identity.jersey_number ? `#${p.identity.jersey_number} ` : "";
  const name =
    [p.identity.first_name, p.identity.last_name].filter(Boolean).join(" ").trim();
  return `${num}${name || "Opposing batter"}`.trim();
}
