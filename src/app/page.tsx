"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth";

interface SchoolRow {
  id: string;
  slug: string;
  name: string;
}

const supabase = createClient();

export default function HomePage() {
  const { session, loading, signOut } = useAuth();
  const router = useRouter();
  const [schools, setSchools] = useState<SchoolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
      return;
    }

    let active = true;
    (async () => {
      const { data, error } = await supabase.from("schools").select("id, slug, name");
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const list = data ?? [];
      setSchools(list);
      if (list.length === 1) router.replace(`/s/${list[0].slug}`);
    })();
    return () => {
      active = false;
    };
  }, [loading, session, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <Card className="p-8 max-w-md w-full text-center space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-destructive font-bold">
            Database error
          </p>
          <p className="text-sm text-destructive break-words">{error}</p>
          <p className="text-xs text-muted-foreground">
            If this is a fresh setup, the schema migration may not have been applied yet.
          </p>
        </Card>
      </div>
    );
  }

  if (loading || schools === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (schools.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <Card className="p-8 max-w-md w-full text-center space-y-4">
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Statly</p>
          <h2 className="font-display text-3xl text-sa-blue-deep">No schools yet</h2>
          <p className="text-sm text-muted-foreground">
            Your account isn&apos;t linked to a school yet. Create one to get started, or ask an admin
            at an existing school to add you.
          </p>
          <Link
            href="/signup"
            className="block w-full bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange font-semibold uppercase tracking-wider rounded-md py-2.5"
          >
            Create your school
          </Link>
          <Button onClick={signOut} variant="outline" className="w-full">
            Sign out
          </Button>
        </Card>
      </div>
    );
  }

  // schools.length > 1: simple picker
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10">
      <Card className="p-8 max-w-md w-full space-y-4">
        <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Statly</p>
        <h2 className="font-display text-3xl text-sa-blue-deep">Choose a school</h2>
        <ul className="space-y-2">
          {schools.map((s) => (
            <li key={s.id}>
              <Link
                href={`/s/${s.slug}`}
                className="block p-4 border border-border rounded-md hover:border-sa-orange transition-colors"
              >
                <p className="font-display text-xl text-sa-blue-deep">{s.name}</p>
                <p className="text-xs text-muted-foreground">/s/{s.slug}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
