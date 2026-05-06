import { NavLink, Outlet } from "react-router-dom";
import { LogOut } from "lucide-react";
import logo from "@/assets/sa-logo.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth";

const nav = [
  { to: "/", label: "Roster", end: true },
  { to: "/team", label: "Team Totals" },
  { to: "/schedule", label: "Schedule" },
  { to: "/upload", label: "Upload Stats" },
];

const Layout = () => {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-gradient-blue text-primary-foreground border-b-4 border-sa-orange">
        <div className="container mx-auto px-6 py-5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img src={logo} alt="Starkville Academy SA logo" className="h-12 w-auto drop-shadow" />
            <div className="leading-tight">
              <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-semibold">Starkville Academy</p>
              <h1 className="font-display text-3xl md:text-4xl text-white">Varsity Volunteers</h1>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "px-4 py-2 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors",
                    isActive
                      ? "bg-sa-orange text-white shadow-orange"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  )
                }
              >
                {n.label}
              </NavLink>
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
        {/* Mobile nav */}
        <nav className="md:hidden border-t border-white/10 px-4 py-2 flex gap-1 overflow-x-auto">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider whitespace-nowrap",
                  isActive ? "bg-sa-orange text-white" : "text-white/80"
                )
              }
            >
              {n.label}
            </NavLink>
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
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t bg-muted/40 py-6 mt-12">
        <div className="container mx-auto px-6 text-center text-xs text-muted-foreground">
          Starkville Academy Varsity Volunteers · Spring 2026
        </div>
      </footer>
    </div>
  );
};

export default Layout;
