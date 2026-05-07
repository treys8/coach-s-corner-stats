# Coach's Corner Stats

A high-school baseball stats platform — rosters, schedules, statistics, and spray charts.
Built as a focused alternative to GameChanger, optimized for the high school athletic-department
workflow rather than club/travel teams.

> Status: early prototype. Single-team, single-season scaffolding inherited from the initial
> prototype is being refactored into a multi-tenant SaaS (multiple schools, varsity/JV teams,
> persistent player records across seasons). See `memory/` notes for product direction.

## Stack

- **Next.js 15** (App Router) on **Vercel**
- **TypeScript**, **TailwindCSS**, **shadcn/ui**, **Recharts**
- **Supabase** (Postgres + Auth + RLS) via `@supabase/ssr`
- **Vitest** for unit tests; **ESLint** via `next lint`
- `xlsx` (SheetJS) for the legacy weekly-workbook import path

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
npm run test           # vitest, run-once
npm run test:watch
npm run lint
npm run build          # production bundle
```

Copy `.env.example` to `.env.local` and fill in your Supabase project values:

```
NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
```

(Older `VITE_*` names from the Vite-era code no longer work.)

## Database setup

A consolidated schema script lives at `supabase/setup.sql` — paste it into a fresh Supabase
project's SQL Editor and run it once. It creates the tables, RLS policies, helper functions,
and seeds a bootstrap coach email so the first sign-in works.

The script is the concatenation of `supabase/migrations/*.sql` in order; both are kept in
sync. Use the migrations folder for incremental changes from here on.

## Auth model

Coach-only access. Sign-in is magic link via Supabase Auth; access is gated by an allow-list
in `public.coaches` (RLS calls `is_coach()` which checks `auth.jwt() ->> 'email'`).

**Adding a new coach:** run in the Supabase SQL Editor:

```sql
INSERT INTO public.coaches (email) VALUES ('them@example.com');
```

Use lowercase. The function compares case-insensitively but the table is case-sensitive on
insert.

## Excel template format (legacy import path)

The Upload Stats page expects an `.xlsx` workbook with **three sheets** named (case-
insensitively) `Hitting`, `Pitching`, and `Fielding`. If any sheet is missing, the upload
fails up front.

Each sheet must follow this shape:

| Number | Last  | First | …stat columns…    |
| ------ | ----- | ----- | ----------------- |
| 10     | Smith | John  | values per column |
| 7      | Doe   | Jane  | values per column |
| —      | Totals| —     | (skipped)         |
| —      | Glossary…   |       | (skipped)         |

Rules the parser enforces:

- The header row must have `Number`, `Last`, `First` in the first three cells. The parser
  searches the first 5 rows for this and skips any title rows above.
- Stat columns start at column 4. Their names become the keys stored in JSONB.
- Any row whose `Last` or `First` is `Totals`, or whose `Last` contains `Glossary`, is skipped.
- Players are matched across sheets by `First|Last` — so spelling must be consistent across
  Hitting/Pitching/Fielding.
- Stat values that aren't numeric and aren't `-` or blank are kept as strings. Blank and `-`
  are normalized to `"-"`.

If a stat column header isn't in `src/lib/glossary.ts`, the upload still ingests it but you'll
see a warning toast and a console warning.

> The xlsx import path is preserved for now as a migration-friendly bulk-load route. Live
> in-game stat entry from a tablet PWA is the eventual primary input — see roadmap notes.

## Seasons

A season runs **Feb 1 – May 31**. After May 31 the season is "closed" — you can't upload
new stats or add games to it. Off-season dates roll back to the most recent season year
(Jun–Dec → that calendar year, Jan → prior calendar year). Logic lives in `src/lib/season.ts`
and the matching `season_year_for(date)` SQL function — keep them in sync.

## Project layout

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # root layout, Providers, fonts, globals.css
│   ├── globals.css
│   ├── (app)/                    # protected route group
│   │   ├── layout.tsx            # auth gate + chrome (header/footer)
│   │   ├── page.tsx              # / Roster
│   │   ├── player/[id]/page.tsx
│   │   ├── team/page.tsx
│   │   ├── schedule/page.tsx
│   │   └── upload/page.tsx
│   ├── login/page.tsx
│   ├── auth/callback/route.ts    # Supabase magic-link handler
│   └── not-found.tsx
├── middleware.ts                 # refreshes Supabase session cookies
├── components/
│   ├── Layout.tsx                # header/nav/footer chrome
│   ├── Providers.tsx             # QueryClient, Auth, Toasters
│   ├── StatTooltip.tsx
│   └── ui/                       # shadcn primitives
├── contexts/
│   ├── auth.ts                   # context type + useAuth hook
│   └── AuthContext.tsx           # AuthProvider component
├── integrations/
│   └── supabase/types.ts         # generated DB types
├── lib/
│   ├── aggregate.ts              # team rollups (sum vs rate-average classification)
│   ├── csvParser.ts              # xlsx → ParsedPlayer[]
│   ├── glossary.ts               # stat name → description
│   ├── season.ts                 # Feb–May season logic
│   ├── snapshots.ts              # Zod schema for JSONB stats — single boundary
│   ├── supabase/
│   │   ├── client.ts             # browser Supabase client
│   │   ├── server.ts             # server Supabase client
│   │   └── middleware.ts         # cookie-refresh helper for middleware
│   └── utils.ts
└── test/                         # vitest, jsdom env
    ├── aggregate.test.ts
    ├── csvParser.test.ts
    ├── season.test.ts
    └── setup.ts
```

## Database tables (current)

| Table            | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `players`        | Per-season roster. Unique `(season_year, first_name, last_name)`.  |
| `stat_snapshots` | One row per `(player_id, upload_date)` with JSONB stats.           |
| `csv_uploads`    | Audit log: filename, player count, date.                           |
| `games`          | Schedule + results.                                                |
| `glossary`       | Stat abbreviation reference.                                       |
| `coaches`        | Email allowlist for `is_coach()` RLS check.                        |

All data tables enable RLS and use a single `FOR ALL USING (public.is_coach())` policy.

## Deployment

Hosted on **Vercel**. Push to `main` → auto-deploy. Environment variables are configured in
the Vercel project settings (NOT in the repo).
