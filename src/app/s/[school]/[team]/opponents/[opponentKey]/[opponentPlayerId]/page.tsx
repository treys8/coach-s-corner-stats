"use client";

// Per-opposing-player page. Reuses the OpposingBatterPanel internals via
// the same /api/opponents/[id]/profile endpoint, then renders the
// game-by-game log inline. All-time history (not season-bounded) per the
// design decision.

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";
import { SprayField, type SprayMarker } from "@/components/spray/SprayField";
import type { OpposingBatterProfile } from "@/lib/opponents/profile";

export default function OpponentPlayerPage({
  params,
}: {
  params: Promise<{ opponentKey: string; opponentPlayerId: string }>;
}) {
  const { opponentKey, opponentPlayerId } = use(params);
  const { school } = useSchool();
  const { team } = useTeam();
  const [profile, setProfile] = useState<OpposingBatterProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/opponents/${opponentPlayerId}/profile`);
        if (!res.ok) {
          if (!cancelled) setError("Couldn't load profile");
          return;
        }
        const data = (await res.json()) as OpposingBatterProfile;
        if (!cancelled) setProfile(data);
      } catch {
        if (!cancelled) setError("Couldn't load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [opponentPlayerId]);

  const markers: SprayMarker[] = profile
    ? profile.sprayPoints.map((p, i) => ({
        id: `${p.game_id}-${i}`,
        result: p.result,
        spray_x: p.x,
        spray_y: p.y,
        description: null,
      }))
    : [];

  return (
    <main className="container mx-auto px-6 py-8 space-y-6">
      <header>
        <Link
          href={`/s/${school.slug}/${team.slug}/opponents/${opponentKey}`}
          className="text-xs text-muted-foreground hover:text-sa-orange uppercase tracking-wider"
        >
          ← Opponent
        </Link>
        <h2 className="font-display text-3xl text-sa-blue-deep mt-1">
          {profile ? formatName(profile) : "Loading…"}
        </h2>
        {profile && (
          <p className="text-sm text-muted-foreground mt-1">
            All-time vs {school.short_name ?? school.name}
          </p>
        )}
      </header>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {profile && (
        <>
          <Card className="p-4">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
              <Stat label="PA" value={profile.line.PA} />
              <Stat label="AB" value={profile.line.AB} />
              <Stat label="AVG" value={fmtPct(profile.line.AVG)} />
              <Stat label="OBP" value={fmtPct(profile.line.OBP)} />
              <Stat label="SLG" value={fmtPct(profile.line.SLG)} />
              <Stat label="HR" value={profile.line.HR} />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center mt-3">
              <Stat label="2B" value={profile.line["2B"]} />
              <Stat label="3B" value={profile.line["3B"]} />
              <Stat label="BB" value={profile.line.BB} />
              <Stat label="HBP" value={profile.line.HBP} />
              <Stat label="SO" value={profile.line.SO} />
              <Stat label="RBI" value={profile.line.RBI} />
            </div>
          </Card>

          {profile.sprayPoints.length > 0 && (
            <Card className="p-4">
              <h3 className="font-display text-sm uppercase tracking-wider text-sa-blue mb-3">
                Spray chart
              </h3>
              <SprayField markers={markers} countsInLegend />
            </Card>
          )}

          {profile.games.length > 0 && (
            <Card className="p-4">
              <h3 className="font-display text-sm uppercase tracking-wider text-sa-blue mb-3">
                Games
              </h3>
              <ul className="space-y-1 text-sm">
                {profile.games.map((g) => (
                  <li key={g.game_id} className="flex justify-between border-b border-border last:border-0 py-1.5">
                    <span>{new Date(g.game_date + "T12:00:00").toLocaleDateString()}</span>
                    <Link
                      href={`/s/${school.slug}/${team.slug}/score/${g.game_id}`}
                      className="text-sa-orange hover:underline"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="font-mono-stat font-bold text-sa-blue-deep text-xl">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function fmtPct(n: number): string {
  if (n === 0) return "—";
  return n.toFixed(3).replace(/^0/, "");
}

function formatName(p: OpposingBatterProfile): string {
  const num = p.identity.jersey_number ? `#${p.identity.jersey_number} ` : "";
  const name = [p.identity.first_name, p.identity.last_name].filter(Boolean).join(" ").trim();
  return `${num}${name || "Opposing batter"}`.trim();
}
