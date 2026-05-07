"use client";

import { useEffect, useState, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSchool } from "@/lib/contexts/school";
import { TeamProvider, type Team } from "@/lib/contexts/team";
import { Layout } from "@/components/Layout";

const supabase = createClient();

export default function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = use(params);
  const { school } = useSchool();
  const [team, setTeam] = useState<Team | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, school_id, slug, name, sport, level")
        .eq("school_id", school.id)
        .eq("slug", teamSlug)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setNotFound(true);
        return;
      }
      setTeam(data as Team);
    })();
    return () => {
      active = false;
    };
  }, [school.id, teamSlug]);

  if (!team && !notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <div>
          <p className="font-display text-3xl text-sa-blue-deep mb-2">Team not found</p>
          <p className="text-sm text-muted-foreground">
            Either the team doesn't exist or you don't have access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <TeamProvider value={{ team: team! }}>
      <Layout
        schoolSlug={school.slug}
        schoolName={school.name}
        schoolShortName={school.short_name}
        schoolLogoUrl={school.logo_url}
        teamSlug={team!.slug}
        teamName={team!.name}
      >
        {children}
      </Layout>
    </TeamProvider>
  );
}
