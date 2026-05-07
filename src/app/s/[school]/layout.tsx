"use client";

import { useEffect, useState, use, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/auth";
import { SchoolProvider, type School } from "@/lib/contexts/school";
import { hexToHsl, lightenHsl } from "@/lib/colors";

const supabase = createClient();

const buildBrandStyle = (school: School): CSSProperties => {
  const style: Record<string, string> = {};
  const primary = hexToHsl(school.primary_color);
  const secondary = hexToHsl(school.secondary_color);
  if (primary) {
    // Header gradient runs from --sa-blue-deep → --sa-blue. Make the deep
    // value the user's primary, derive a slightly lighter end for the gradient.
    style["--sa-blue-deep"] = primary;
    style["--sa-blue"] = lightenHsl(primary, 12);
  }
  if (secondary) {
    style["--sa-orange"] = secondary;
    style["--sa-orange-glow"] = lightenHsl(secondary, 8);
  }
  return style as CSSProperties;
};

export default function SchoolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ school: string }>;
}) {
  const { school: schoolSlug } = use(params);
  const { session, loading } = useAuth();
  const router = useRouter();
  const [school, setSchool] = useState<School | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
      return;
    }

    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("schools")
        .select("id, slug, name, short_name, logo_url, primary_color, secondary_color")
        .eq("slug", schoolSlug)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setNotFound(true);
        return;
      }
      setSchool(data);
      const { data: adminRow } = await supabase
        .from("school_admins")
        .select("school_id")
        .eq("school_id", data.id)
        .maybeSingle();
      if (!active) return;
      setIsAdmin(Boolean(adminRow));
    })();
    return () => {
      active = false;
    };
  }, [loading, session, router, schoolSlug]);

  if (loading || (!school && !notFound)) {
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
          <p className="font-display text-3xl text-sa-blue-deep mb-2">School not found</p>
          <p className="text-sm text-muted-foreground">
            Either the school doesn&apos;t exist or you don&apos;t have access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SchoolProvider value={{ school: school!, isAdmin }}>
      <div style={buildBrandStyle(school!)} className="min-h-screen">
        {children}
      </div>
    </SchoolProvider>
  );
}
