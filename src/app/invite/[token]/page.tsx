"use client";

import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle } from "lucide-react";

const supabase = createClient();

export default function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const { session, loading } = useAuth();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [error, setError] = useState<string | null>(null);
  const [schoolSlug, setSchoolSlug] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
      return;
    }
    if (firedRef.current) return;
    firedRef.current = true;
    (async () => {
      const { data, error } = await supabase.rpc("accept_school_admin_invite", {
        p_token: token,
      });
      if (error) {
        setError(error.message);
        setState("error");
        return;
      }
      const schoolId = data as string;
      const { data: schoolRow } = await supabase
        .from("schools")
        .select("slug, name")
        .eq("id", schoolId)
        .maybeSingle();
      const row = schoolRow as { slug: string; name: string } | null;
      setSchoolSlug(row?.slug ?? null);
      setSchoolName(row?.name ?? null);
      setState("ok");
      toast.success(`Joined ${row?.name ?? "school"} as admin`);
    })();
  }, [loading, session, router, token]);

  if (state === "working") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Accepting invite…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <Card className="p-8 shadow-elevated w-full max-w-md text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-destructive" />
          <p className="font-display text-2xl text-sa-blue-deep mb-2">
            Couldn&apos;t accept invite
          </p>
          <p className="text-sm text-destructive mb-5">{error}</p>
          <Link href="/">
            <Button variant="outline">Go home</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <Card className="p-8 shadow-elevated w-full max-w-md text-center">
        <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-sa-blue" />
        <p className="font-display text-2xl text-sa-blue-deep mb-2">You&apos;re in!</p>
        <p className="text-sm text-muted-foreground mb-5">
          You&apos;ve been added as an admin{schoolName ? ` for ${schoolName}` : ""}.
        </p>
        {schoolSlug && (
          <Link href={`/s/${schoolSlug}`}>
            <Button className="bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange">
              Go to school
            </Button>
          </Link>
        )}
      </Card>
    </div>
  );
}
