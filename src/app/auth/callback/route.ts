import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const isUniqueViolation = (err: { code?: string; message?: string } | null): boolean =>
  err?.code === "23505" || /duplicate key|unique constraint/i.test(err?.message ?? "");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth_callback_failed", url.origin));
  }

  const supabase = await createClient();
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return NextResponse.redirect(new URL("/login?error=auth_callback_failed", url.origin));
  }

  // If this magic-link came from /signup, the user_metadata carries the
  // school they want to create. Provision it now and redirect into it.
  const { data: userResp } = await supabase.auth.getUser();
  const signup = userResp.user?.user_metadata?.signup as
    | { school_name?: string }
    | undefined;

  if (signup?.school_name) {
    const baseSlug = slugify(signup.school_name);
    if (baseSlug) {
      let slug = baseSlug;
      for (let attempt = 0; attempt < 6; attempt++) {
        const { error } = await supabase.rpc("create_school", {
          p_slug: slug,
          p_name: signup.school_name,
        });
        if (!error) {
          // Clear the signup metadata so re-signing-in doesn't re-fire creation.
          await supabase.auth.updateUser({ data: { signup: null } });
          return NextResponse.redirect(new URL(`/s/${slug}`, url.origin));
        }
        if (!isUniqueViolation(error)) {
          // Unknown failure — log and fall through to the default redirect so
          // the user at least lands somewhere usable.
          console.error("create_school failed", error);
          break;
        }
        slug = `${baseSlug}-${attempt + 2}`;
      }
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
