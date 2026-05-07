"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/auth";

const supabase = createClient();

export default function SignupPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!loading && session) router.replace("/");
  }, [loading, session, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !schoolName.trim()) return;
    setBusy(true);
    setResult(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { signup: { school_name: schoolName.trim() } },
      },
    });
    setBusy(false);
    setResult(
      error
        ? { ok: false, msg: error.message }
        : { ok: true, msg: `Check ${email} for a sign-in link to finish creating ${schoolName}.` },
    );
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-10">
      <Card className="p-8 shadow-elevated w-full max-w-md">
        <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Statly</p>
        <h2 className="font-display text-4xl text-sa-blue-deep mb-2">Create your school</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Sign up and you&apos;ll be set as the school&apos;s first admin. Add teams and coaches once you&apos;re in.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="school-name" className="mb-1.5 block">School name</Label>
            <Input
              id="school-name"
              type="text"
              required
              autoComplete="organization"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="Magnolia Heights School"
            />
          </div>
          <div>
            <Label htmlFor="email" className="mb-1.5 block">Your email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ad@school.org"
            />
          </div>
          <Button
            type="submit"
            disabled={busy || !email.trim() || !schoolName.trim()}
            className="w-full bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange font-semibold uppercase tracking-wider"
          >
            <Mail className="w-4 h-4 mr-2" />
            {busy ? "Sending…" : "Send magic link"}
          </Button>
          {result && (
            <div
              className={`flex items-start gap-3 p-4 rounded-md ${
                result.ok ? "bg-sa-blue/5 border border-sa-blue/20" : "bg-destructive/5 border border-destructive/20"
              }`}
            >
              {result.ok ? (
                <CheckCircle2 className="w-5 h-5 text-sa-blue flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              )}
              <p className="text-sm">{result.msg}</p>
            </div>
          )}
        </form>
        <p className="text-xs text-center text-muted-foreground mt-6">
          Already have a school?{" "}
          <Link href="/login" className="text-sa-orange font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
