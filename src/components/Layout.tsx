"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth";

interface LayoutProps {
  children: React.ReactNode;
  schoolSlug: string;
  schoolName: string;
  schoolShortName?: string | null;
  schoolLogoUrl?: string | null;
  teamSlug: string;
  teamName: string;
}

const isActive = (pathname: string, href: string, exact?: boolean) =>
  exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export function Layout({
  children,
  schoolSlug,
  schoolName,
  schoolShortName,
  schoolLogoUrl,
  teamSlug,
  teamName,
}: LayoutProps) {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const base = `/s/${schoolSlug}/${teamSlug}`;
  const headerLabel = schoolShortName?.trim() || schoolName;
  const nav = [
    { href: base, label: "Roster", exact: true },
    { href: `${base}/team`, label: "Team Totals" },
    { href: `${base}/schedule`, label: "Schedule" },
    { href: `${base}/roster`, label: "Upload Roster" },
    { href: `${base}/upload`, label: "Upload Stats" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-gradient-blue text-primary-foreground border-b-4 border-sa-orange">
        <div className="container mx-auto px-6 py-5 flex items-center justify-between gap-6">
          <Link href={`/s/${schoolSlug}`} className="flex items-center gap-3 leading-tight min-w-0">
            {schoolLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={schoolLogoUrl}
                alt={`${schoolName} logo`}
                className="h-12 w-auto max-w-[64px] object-contain drop-shadow"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-semibold truncate">
                {headerLabel}
              </p>
              <h1 className="font-display text-3xl md:text-4xl text-white truncate">{teamName}</h1>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "px-4 py-2 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors",
                  isActive(pathname, n.href, n.exact)
                    ? "bg-sa-orange text-white shadow-orange"
                    : "text-white/80 hover:text-white hover:bg-white/10",
                )}
              >
                {n.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={signOut}
              title={user?.email ? `Signed in as ${user.email}` : "Sign out"}
              className="ml-2 px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider text-white/80 hover:text-white hover:bg-white/10 inline-flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </nav>
        </div>
        <nav className="md:hidden border-t border-white/10 px-4 py-2 flex gap-1 overflow-x-auto">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider whitespace-nowrap",
                isActive(pathname, n.href, n.exact) ? "bg-sa-orange text-white" : "text-white/80",
              )}
            >
              {n.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={signOut}
            className="ml-auto px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider whitespace-nowrap text-white/80 inline-flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t bg-muted/40 py-6 mt-12">
        <div className="container mx-auto px-6 text-center text-xs text-muted-foreground">
          Statly ·{" "}
          <Link href="/scores" className="hover:text-sa-orange">
            Public Scores
          </Link>
        </div>
      </footer>
    </div>
  );
}
