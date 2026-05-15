"use client";

// Live-game side panel: when the opposing team is batting, shows the
// current opposing batter's career line + spray chart against your school.
// Fetched on each batter change from /api/opponents/[id]/profile.

import { memo, useEffect, useMemo, useState } from "react";
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
}

// Memoized: opponentPlayerId / slotLabel / cache are stable across the
// in-PA re-renders driven by pitches and runner moves. Default shallow
// comparison is correct here — slotLabel is a string, cache is a stable
// Map ref from the parent's useRef.
export const OpposingBatterPanel = memo(function OpposingBatterPanel({
  opponentPlayerId,
  slotLabel,
  cache,
}: Props) {
  const [profile, setProfile] = useState<OpposingBatterProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // sprayPoints reference comes from the cached profile and only changes
  // when the opposing batter changes (or their cached profile is refreshed).
  // Keying on `profile` skips the marker rebuild on every parent re-render
  // — there's a parent re-render per pitch / runner move while this panel
  // is mounted. Declared before the early return below so hooks run in a
  // stable order across mount/unmount of the placeholder branch.
  const markers: SprayMarker[] = useMemo(() => {
    if (!profile) return [];
    return profile.sprayPoints.map((p, i) => ({
      id: `${p.game_id}-${i}`,
      result: p.result,
      spray_x: p.x,
      spray_y: p.y,
      description: null,
    }));
  }, [profile]);

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

      {profile && profile.sprayPoints.length > 0 && (
        <div className="-mx-1">
          <SprayField
            markers={markers}
            emptyMessage="No spray points yet."
            countsInLegend
          />
        </div>
      )}
    </Card>
  );
});

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono-stat font-bold text-sa-blue-deep">{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

function fmtPct(n: number): string {
  // .328 -> ".328"
  if (n === 0) return "—";
  return n.toFixed(3).replace(/^0/, "");
}

function formatIdentity(p: OpposingBatterProfile): string {
  const num = p.identity.jersey_number ? `#${p.identity.jersey_number} ` : "";
  const name =
    [p.identity.first_name, p.identity.last_name].filter(Boolean).join(" ").trim();
  return `${num}${name || "Opposing batter"}`.trim();
}
