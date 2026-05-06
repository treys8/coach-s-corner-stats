# Coach's Corner Stats

A weekly baseball stats tracker for the Starkville Academy Varsity Volunteers. Coaches upload the team's cumulative season-to-date Excel workbook each week; the app stores each upload as a snapshot so individual and team trends build over time.

## Quick start

```bash
npm install
npm run dev            # http://localhost:8080
npm run test           # vitest, run-once
npm run test:watch
npm run lint
npm run build          # production bundle to dist/
```

Copy `.env.example` to `.env` and fill in your Supabase project values:

```
VITE_SUPABASE_URL="https://<project>.supabase.co"
VITE_SUPABASE_PROJECT_ID="<project-id>"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon key>"
```

## Excel template format

The upload page expects an `.xlsx` workbook with **three sheets** named (case-insensitively) `Hitting`, `Pitching`, and `Fielding`. If any sheet is missing, the upload fails up front.

Each sheet must follow this shape:

| Number | Last  | First | …stat columns…    |
| ------ | ----- | ----- | ----------------- |
| 10     | Smith | John  | values per column |
| 7      | Doe   | Jane  | values per column |
| —      | Totals| —     | (skipped)         |
| —      | Glossary…   |       | (skipped)         |

Rules the parser enforces:

- The header row must have `Number`, `Last`, `First` in the first three cells. The parser searches the first 5 rows for this and skips any title rows above.
- Stat columns start at column 4. Their names become the keys stored in JSONB.
- Any row whose `Last` or `First` is `Totals`, or whose `Last` contains `Glossary`, is skipped.
- Players are matched across sheets by `First|Last` — so spelling must be consistent across Hitting/Pitching/Fielding.
- Stat values that aren't numeric and aren't `-` or blank are kept as strings. Blank and `-` are normalized to `"-"`.

If a stat column header isn't in `src/lib/glossary.ts`, the upload still ingests it but you'll see a warning toast and a `[csvParser]` console warning. Add it to `GLOSSARY` to silence.

## Seasons

A season runs **Feb 1 – May 31**. After May 31 the season is "closed" — you can't upload new stats or add games to it. Off-season dates roll back to the most recent season year (Jun–Dec → that calendar year, Jan → prior calendar year). Logic lives in `src/lib/season.ts` and the matching `season_year_for(date)` SQL function — keep them in sync.

## Auth model

Coach-only. There is no public access and no parent/player view. Sign-in is magic link via Supabase Auth; access is gated by an allowlist in `public.coaches` (RLS calls `is_coach()` which checks `auth.jwt() ->> 'email'`).

**Adding a new coach:** insert their email in the Supabase SQL editor:

```sql
INSERT INTO public.coaches (email) VALUES ('them@example.com');
```

Use lowercase — the function compares case-insensitively but the table is case-sensitive on insert. The new coach can then sign in via magic link and the app will let them through.

The seeded bootstrap coach is in `supabase/migrations/20260506130000_auth_and_rls.sql`.

## Database

Tables live in `supabase/migrations/`. Apply with `supabase db push` or paste into the SQL editor.

| Table            | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `players`        | Per-season roster. Unique `(season_year, first_name, last_name)`. |
| `stat_snapshots` | One row per `(player_id, upload_date)` with JSONB stats.    |
| `csv_uploads`    | Audit log: filename, player count, date.                   |
| `games`          | Schedule + results.                                        |
| `glossary`       | Stat abbreviation reference (currently unused in UI).       |
| `coaches`        | Email allowlist for `is_coach()` RLS check.                |

All tables have RLS enabled with a single `FOR ALL USING (public.is_coach())` policy.

## Project layout

```
src/
├── App.tsx              # routes + AuthProvider + ProtectedRoute
├── components/
│   ├── Layout.tsx       # header, nav, sign-out
│   ├── ProtectedRoute.tsx
│   └── ui/              # shadcn primitives
├── contexts/
│   └── AuthContext.tsx  # session + isCoach state
├── integrations/
│   └── supabase/        # auto-generated client + types
├── lib/
│   ├── aggregate.ts     # team rollups (sum vs rate-average classification)
│   ├── csvParser.ts     # xlsx → ParsedPlayer[]
│   ├── glossary.ts      # stat name → description
│   ├── season.ts        # Feb–May season logic
│   └── snapshots.ts     # Zod schema for JSONB stats — single boundary
├── pages/
│   ├── Roster.tsx
│   ├── PlayerDetail.tsx
│   ├── TeamTotals.tsx
│   ├── Schedule.tsx
│   ├── UploadStats.tsx
│   ├── Login.tsx
│   └── NotFound.tsx
└── test/                # vitest, jsdom env
    ├── aggregate.test.ts
    ├── csvParser.test.ts
    └── season.test.ts
```

## Tech stack

Vite · React 18 · TypeScript · TailwindCSS · shadcn/ui · React Router 6 · React Query · Supabase · Recharts · React Hook Form + Zod · xlsx (SheetJS) · Vitest · Sonner.
