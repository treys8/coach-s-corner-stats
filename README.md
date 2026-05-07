# Statly

A high-school baseball stats platform — rosters, schedules, statistics, and (eventually)
spray charts and a public Scores feed. Built as a focused alternative to GameChanger,
optimized for the high school athletic-department workflow rather than club/travel teams.

> Status: multi-tenant SaaS shape is now live (schools → teams → seasons). Self-serve
> school signup, public Scores page, and the tablet PWA for live in-game stat entry are
> still upcoming. See `memory/` notes for product direction.

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

Copy `.env.example` to `.env` and fill in your Supabase project values:

```
NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
```

## Database setup

For a brand-new Supabase project, paste `supabase/setup.sql` into the project's SQL
Editor and run it once. It creates the full schema (schools, teams, players, etc.),
RLS policies, helper functions, glossary, and seeds a demo school for
`treyschill@gmail.com`.

For an existing project upgrading from the v1 (single-team) schema, run
`supabase/migrations/20260507120000_multi_tenant_schema.sql` instead — it drops the
v1 tables and creates the v2 shape.

## Tenancy model

Statly is multi-tenant. The hierarchy is:

```
schools  →  teams (sport, level)  →  team-seasons (year)  →  roster_entries
                                                              ↓
players (persistent across seasons, scoped to a school)
```

A coach belongs to one or more `team_members`. An athletic director belongs to
`school_admins` and inherits access to every team in the school.

Routing is path-prefixed:

- `/` — smart redirect: login → first school → school picker if multiple
- `/login` — magic-link sign-in (school-agnostic)
- `/s/[school]` — school dashboard (list of teams, "Add team" for admins)
- `/s/[school]/[team]` — roster
- `/s/[school]/[team]/team` — team totals & leaderboards
- `/s/[school]/[team]/schedule` — schedule
- `/s/[school]/[team]/upload` — weekly stats upload
- `/s/[school]/[team]/player/[id]` — player detail
- `/auth/callback` — Supabase magic-link handler

## Auth model

Magic-link via Supabase Auth. RLS gates access:

- `is_school_admin(school_id)` — true if the user is in `school_admins` for that school
- `is_team_member(team_id)` — true if the user is in `team_members` for that team OR is
  an admin of the team's school

All data-bearing tables (`players`, `roster_entries`, `stat_snapshots`, `games`,
`csv_uploads`) are gated by `is_team_member()`. The `schools` and `teams` tables are
visible to any member of the school.

Self-serve school signup is the next PR. Until then, schools are seeded via SQL — see
the `DO $$ ... $$` block at the bottom of `setup.sql`.

## Excel template format

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
> in-game stat entry from a tablet PWA is the eventual primary input.

## Seasons

A season runs **Feb 1 – May 31**. After May 31 the season is "closed" — you can't upload
new stats or add games to it. Off-season dates roll back to the most recent season year
(Jun–Dec → that calendar year, Jan → prior calendar year). Logic lives in `src/lib/season.ts`
and the matching `season_year_for(date)` SQL function — keep them in sync.

## Project layout

```
src/
├── app/                                # Next.js App Router
│   ├── layout.tsx                      # root layout, providers
│   ├── globals.css
│   ├── page.tsx                        # / smart redirect / school picker
│   ├── s/[school]/                     # school-scoped routes
│   │   ├── layout.tsx                  # validates school access, provides SchoolContext
│   │   ├── page.tsx                    # school dashboard (teams + add)
│   │   └── [team]/                     # team-scoped routes
│   │       ├── layout.tsx              # validates team access, renders chrome
│   │       ├── page.tsx                # roster
│   │       ├── team/page.tsx           # team totals + leaderboards
│   │       ├── schedule/page.tsx
│   │       ├── upload/page.tsx
│   │       └── player/[id]/page.tsx
│   ├── login/page.tsx
│   ├── auth/callback/route.ts          # magic-link handler
│   └── not-found.tsx
├── middleware.ts                       # refreshes Supabase session cookies
├── components/
│   ├── Layout.tsx                      # team-scoped header/nav/footer chrome
│   ├── Providers.tsx                   # QueryClient, AuthProvider, toasters
│   ├── StatTooltip.tsx
│   └── ui/                             # shadcn primitives
├── contexts/
│   ├── auth.ts                         # AuthContext + useAuth hook
│   └── AuthContext.tsx                 # AuthProvider component
├── integrations/
│   └── supabase/types.ts               # hand-maintained Database types
├── lib/
│   ├── aggregate.ts                    # team rollups
│   ├── csvParser.ts                    # xlsx → ParsedPlayer[]
│   ├── glossary.ts                     # stat name → description
│   ├── season.ts                       # Feb–May season logic
│   ├── snapshots.ts                    # zod schema for JSONB stats
│   ├── supabase/
│   │   ├── client.ts                   # browser client
│   │   ├── server.ts                   # server client
│   │   └── middleware.ts               # cookie-refresh helper
│   ├── contexts/
│   │   ├── school.tsx                  # SchoolContext + useSchool
│   │   └── team.tsx                    # TeamContext + useTeam
│   └── utils.ts
└── test/                               # vitest
```

## Database tables

| Table            | Purpose                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `schools`        | Top-level tenant. Owns branding, slug, name.                             |
| `teams`          | Per-school team. Sport (baseball/softball), level (varsity/JV/etc.).     |
| `school_admins`  | School-wide membership (AD-level access).                                |
| `team_members`   | Per-team membership (coach, scorer, assistant).                          |
| `players`        | Persistent player identity, scoped to a school.                          |
| `roster_entries` | Player-on-team-for-a-season, with jersey number.                         |
| `stat_snapshots` | Weekly cumulative stats for a player on a team.                          |
| `games`          | Schedule + results, per team. `is_final` will gate the public Scores feed.|
| `csv_uploads`    | Audit log of weekly xlsx uploads.                                        |
| `glossary`       | Stat abbreviation reference (global, public-readable).                   |

## Deployment

Hosted on **Vercel**. Push to `main` → auto-deploy. Environment variables are configured
in the Vercel project settings (NOT in the repo).
