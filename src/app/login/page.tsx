"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth";

export default function LoginPage() {
  const { session, signInWithEmail, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") ? rawNext : null;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!loading && session) router.replace(next ?? "/");
  }, [loading, session, router, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setResult(null);
    const { error } = await signInWithEmail(email.trim(), next ?? undefined);
    setBusy(false);
    setResult(
      error ? { ok: false, msg: error } : { ok: true, msg: `Check ${email} for a sign-in link.` },
    );
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-10">
      <Card className="p-8 shadow-elevated w-full max-w-md">
        <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Coach Sign-in</p>
        <h2 className="font-display text-4xl text-sa-blue-deep mb-2">Welcome back</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Enter your coach email and we'll send a one-time sign-in link.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email" className="mb-1.5 block">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="coach@example.com"
            />
          </div>
          <Button
            type="submit"
            disabled={busy || !email.trim()}
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
          New to Statly?{" "}
          <Link href="/signup" className="text-sa-orange font-semibold hover:underline">
            Create your school
          </Link>
        </p>
      </Card>
    </div>
  );
}
