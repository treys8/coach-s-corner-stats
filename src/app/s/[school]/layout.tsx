"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/auth";
import { SchoolProvider, type School } from "@/lib/contexts/school";

const supabase = createClient();

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
        .select("id, slug, name, short_name, primary_color, secondary_color")
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
            Either the school doesn't exist or you don't have access.
          </p>
        </div>
      </div>
    );
  }

  return <SchoolProvider value={{ school: school!, isAdmin }}>{children}</SchoolProvider>;
}
