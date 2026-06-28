# Tablet & Phone Layout Audit — Statly (Coach's Corner Stats)

_Generated 2026-06-28 via a 7-surface multi-agent responsive audit (71 agents). Every finding was re-checked against the actual CSS by an adversarial verifier; **49 confirmed, 14 claims refuted and dropped**._

**Severity counts:** 🔴 3 blocker · 🟠 11 major · 🟡 29 minor · ⚪ 6 nit

> Context: mobile is the **primary** environment — a coach scoring a live game one-handed on a phone outdoors, plus parents/fans browsing scores and stat tables on phones. Tablet = iPad portrait (768px) & landscape (1024–1366px). The app's nav only switches to the desktop row at `xl` (1280px), so **every iPad gets the mobile nav**.

## Status — updated 2026-06-28

**✅ Shipped — quick-wins batch (PR #67):**
- **Blocker** — hover-gated row/card actions un-gated on touch via a `can-hover` variant (F6)
- **Blocker** — dialog Save/Confirm reachable via a safe `max-h`+scroll cap (the safe subset of F4)
- iOS focus-zoom killed — input/textarea ≥16px (F3)
- `viewport` export added: `viewportFit:'cover'` + `themeColor` (the export half of F2)
- Mobile nav pills → 44px touch targets (the touch-target half of F5)
- Wide-grid horizontal scroll — opponent stats + CSV import preview wrapped (part of F7)
- Stat glossary tappable — `StatLabel` Tooltip → tap Popover (the StatTooltip half of F8)
- Leaderboard team column visible on phone; PitchRail dock `55vh` → `55dvh`

**✅ Shipped — foundation mechanical batch:**
- New shared primitives: `.pb-safe`/`.pt-safe` utilities (globals.css) + a `touch` variant
  (`@media (hover:none)`, tailwind.config) to bump tap targets on touch only
- **F2** — `pb-safe` applied to the scoring dock + the edit-opposing-lineup sheet footer
- **F5** — active nav tab scrolls into view on route change; right-edge mask-fade affordance;
  desktop-nav switch lowered `xl`→`lg` so iPad landscape gets the full nav
- **F7** — player season table: frozen (`sticky left-0`) Season column + right-edge fade
- **F8** — spray markers (SprayField + LiveSprayChart) now tap to a caption with an enlarged hit
  circle; OutcomeGrid touch-only tap glossary; FlowControls mound-visit warning + DefensiveDiamond
  runner hint surfaced as visible/on-canvas text (`InPlayOutcomeSheet` was already full-word)
- **F9** — 44px floor applied: GameStatusBar icons, RunnersControls, FailedEventsSheet Retry/Discard,
  `tabs.tsx` (touch-gated), settings copy/revoke/remove icons, roster grade/jersey chips (touch-gated)

**✅ Shipped — structural batch (F1, the 3rd blocker):**
- **F1** — the live-scoring shell now escapes the nav chrome as a full-screen focus-mode takeover on
  all breakpoints: `LiveScoring`'s shell + loading branch are `fixed inset-x-0 top-0 z-50 h-[100dvh]
  overflow-hidden`, a body-scroll lock kills the residual double-scroll, and `GameStatusBar` gained a
  top safe-area inset (`pt-[calc(0.5rem_+_env(safe-area-inset-top))]`) to match the dock's `pb-safe`.
  Verified via `/demo-scoring`: status top / diamond middle / dock pinned bottom in one glance, no
  document double-scroll, at phone and desktop widths. **All 3 blockers are now resolved.**

**⏳ Remaining:**
- **F4** — pinned header/footer dialog restructure (deferred: conflicts with 3 dialogs' nested scroll)
- The remaining majors / minors / nits in the punch list below.

## Verdict

Statly's headline scoring controls are genuinely touch-first (pitch/outcome buttons are correctly 48-56px), but the scaffolding around them is not yet ready for a coach scoring one-handed outdoors. Three true blockers sit squarely in the core loop: the live-scoring takeover is rendered inside the global header+nav chrome so its 100dvh shell pushes the Ball/Strike/In-play dock below the fold and the page double-scrolls; the shared Dialog primitive has no height cap or scroll, so the Save/Confirm footer on the very dialogs used to correct a play falls off short or keyboard-covered viewports; and the entire schedule/team action set (Score, Mark Final, Edit, Delete) is hidden behind group-hover, making the primary post-game workflow invisible and unreachable on every phone and iPad. On top of that, fixed-width stat/opponent/CSV grids either clip silently or blow out the page on phones and iPad-portrait, a large amount of help (stat glossaries, play nuance, spray context) is locked in hover/title tooltips that never fire on touch, and sub-44px targets are pervasive in the secondary controls. The encouraging part is leverage: nearly all of it traces to about eight shared primitives — dialog, input/textarea, the Layout nav, a table wrapper, the hover-gating pattern, and a missing viewport/safe-area export — so a focused foundation pass would resolve dozens of findings at once. Tablet fares somewhat better than phone (more width, fewer layout collisions) but still hits the dialog-scroll and hover-gated-action blockers. As it stands I would not call it game-ready for live one-handed phone scoring; it is demo-able but the foundation fixes above are prerequisites before putting it in a coach's hand at a real game.

## Foundation fixes (highest leverage — do these first)

These shared-primitive changes each resolve many findings at once.

### F1. Render the live-scoring takeover OUTSIDE the global nav chrome (route group or fixed inset-0) + dvh + safe-area dock

- **Why:** The in-progress scoring shell is h-[100dvh] but lives inside <main className="flex-1"> beneath Layout's gradient header + xl:hidden 8-tab nav strip (~130-150px), so a viewport-relative 100dvh block starts ~140px down the document and its bottom-pinned Ball/Strike/In-play dock renders below the fold, forcing the whole document to double-scroll. This single structural change is the precondition for the entire 'status top / diamond middle / dock pinned bottom in one glance' premise, and is also where the dock's vh→dvh and safe-area-inset padding must land.
- **Fix:** Move score/[gameId] into a route group whose layout omits <Layout>, OR conditionally skip header/nav/footer for the scoring route in TeamLayout, OR make the shell escape with `fixed inset-0 z-50` instead of `h-[100dvh]`. Then add `pb-[env(safe-area-inset-bottom)]` to the dock and switch its cap to `max-h-[55dvh]`.
- **Files:** `src/components/scoring/LiveScoring.tsx:232`, `src/app/s/[school]/[team]/score/[gameId]/page.tsx:131-155`, `src/app/s/[school]/[team]/layout.tsx:65-77`, `src/components/Layout.tsx:48-115`, `src/components/scoring/PitchRail.tsx:131`

### F2. Add a Next viewport export (viewportFit:'cover' + themeColor) and a safe-area padding utility

- **Why:** layout.tsx exports only metadata, so Next injects the default viewport with no viewportFit:'cover'. Today env(safe-area-inset-*) resolves to 0 — making ALL safe-area padding a silent no-op — the scoring takeover can never reach the notch/home-indicator, and with no themeColor the iOS status/address bar stays white against the dark-blue gradient header. This unblocks edge-to-edge scoring, sticky sheet footers, and the dock safe-area padding from FF1.
- **Fix:** In src/app/layout.tsx add `import type { Viewport } from 'next'` then `export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#001a4d' }`. Add a `.pb-safe`/`.pt-safe` utility wrapping env(safe-area-inset-*) and apply it to the scoring dock and sticky dialog/sheet footers.
- **Files:** `src/app/layout.tsx:5-8`, `src/components/scoring/PitchRail.tsx:131`, `src/components/scoring/EditOpposingLineupDialog.tsx:229-240`

### F3. Set form-control base font-size to 16px to kill iOS focus-zoom

- **Why:** Input is `text-base md:text-sm` (drops to 14px on every iPad and on phones held in landscape) and Textarea is `text-sm` at all widths. iOS/iPadOS Safari auto-zooms the viewport whenever a focused field is <16px, which fires on the live-scoring-in-landscape path, every iPad form, and every Notes textarea. Two one-line edits resolve four separate findings.
- **Fix:** input.tsx: drop `md:text-sm` (keep `text-base` at all widths). textarea.tsx: change `text-sm` → `text-base`. If a denser desktop look is wanted, gate at `lg:` where touch/zoom is not a concern.
- **Files:** `src/components/ui/input.tsx:11`, `src/components/ui/textarea.tsx:11`

### F4. Give the Dialog/AlertDialog primitives a height cap + internal scroll with pinned header/footer

- **Why:** Both primitives are vertically centered with translate-y-[-50%] and have NO max-h / overflow-y, so any tall dialog (EditLastPlay's 20-button grid ~800px+, SubstitutionDialog, GameFormDialog, EndSeasonDialog) overflows top and bottom on a 360x640 phone or any landscape viewport with the keyboard up — clipping the title above and the Save/Confirm/End-Season footer below with no scroll path. This is one shared-primitive edit that resolves the dialog blocker and two majors at once.
- **Fix:** In dialog.tsx and alert-dialog.tsx change the content base to `max-h-[calc(100dvh-2rem)] grid-rows-[auto_1fr_auto] overflow-hidden` and make the body region `overflow-y-auto` so header/footer stay pinned while only the middle scrolls. Relax the inner max-h-[50vh]/[55vh] caps afterward; add `max-h-[40vh] overflow-y-auto` to EditLastPlay's result grid.
- **Files:** `src/components/ui/dialog.tsx:38-39`, `src/components/ui/alert-dialog.tsx:37`, `src/components/scoring/dialogs/EditLastPlayDialog.tsx:293-301`

### F5. Rework the mobile/tablet nav: 44px pills, active-into-view, overflow affordance, lower breakpoint

- **Why:** The xl:hidden strip is what EVERY phone AND every iPad (768-1279px) sees: ~28px pills 4px apart (sub-44px primary nav), no scrollIntoView on the active tab and no edge-fade/chevron (so on Settings/Upload the active pill sits off-screen with no hint more tabs exist), and the full desktop row only appears at xl(1280) so even a 1024px iPad Pro in landscape gets the tiny strip. Resolves four nav findings.
- **Fix:** On the pills use `inline-flex items-center min-h-[44px] py-2.5 text-sm` and `gap-2`. Add a ref to the active <Link> and `scrollIntoView({inline:'center'})` on route change. Add a right-edge `[mask-image:linear-gradient(to_right,#000_85%,transparent)]` or chevron. Lower the desktop-row switch to `lg` (`hidden xl:flex`→`hidden lg:flex`, `xl:hidden`→`lg:hidden`), or collapse to a hamburger Sheet below md.
- **Files:** `src/components/Layout.tsx:66`, `src/components/Layout.tsx:92-108`, `src/components/Layout.tsx:35-44`

### F6. Introduce a can-hover (@media(hover:hover)) variant and stop gating primary actions on group-hover

- **Why:** Per-game-row actions (Score / Mark Final / Edit / Delete) and per-team admin Edit/Delete are `opacity-0 group-hover:opacity-100` — hover never fires on touch, so the primary post-game scoring/edit/delete workflow is invisible AND unreachable on every phone and iPad, while opacity-0 keeps the buttons in layout (squeezing the opponent name) and still hit-testable (a right-edge tap can fire the invisible Delete). One shared variant fixes the schedule blocker and the team-management major.
- **Fix:** Add a `can-hover` Tailwind variant (`@media (hover:hover)`). Replace `opacity-0 group-hover:opacity-100` with `opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100` (GameRow) and `md:opacity-0 md:group-hover:opacity-100` → `opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100` (team card). Touch keeps controls visible; pointer devices keep the reveal.
- **Files:** `src/components/schedule/GameRow.tsx:121`, `src/app/s/[school]/page.tsx:302`, `tailwind.config.ts`

### F7. Adopt one consistent mobile table strategy (overflow-x scroller + min-w + sticky first col, or stacked cards under sm)

- **Why:** Wide fixed-track grids have no shared responsive pattern: the opponent stats grid (~612px) is clipped by a Card `overflow-hidden` so BB/SO/RBI and the edit pencil are silently unreachable; the schedule CSV-import preview (~836px) has no overflow wrapper so it blows out the whole document and overflows iPad-portrait too; and the player season table scrolls but has no frozen Season column or edge affordance so values lose row identity. Resolves two majors and a minor.
- **Fix:** Standard: wrap each wide grid in `<div className="overflow-x-auto">`, give the grid `min-w-[...]` so scroll is discoverable, add a right-edge fade, and `sticky left-0 bg-card z-10` on the first label column. Preferred for phone: `hidden sm:grid` the wide grid and render a stacked key/value card per row below sm. Replace the opponent Card's `overflow-hidden`.
- **Files:** `src/app/s/[school]/[team]/opponents/[opponentKey]/page.tsx:184-201`, `src/components/schedule/ScheduleUploadPreview.tsx:191-207`, `src/app/s/[school]/[team]/player/[id]/page.tsx:283-284`

### F8. Make all hover-only help tap-accessible (StatTooltip, native title= attrs, spray markers)

- **Why:** The primary surfaces are touch, where hover never fires: every stat abbreviation (WHIP/OPS/OBP/FLD%...) is a non-focusable cursor-help span in a Radix Tooltip that Radix deliberately suppresses on touch, so definitions are permanently unreachable; outcome/sac/foul-out nuance and the runner drag hint live only in native title= strings; and spray-chart per-play context lives only in SVG <title> with no onClick. The dotted underline and codes promise help that touch users can never get. Resolves the glossary major plus several scoring/spray/records findings.
- **Fix:** Render StatLabel as a real <button> using a tap-toggle Popover (keep hover for pointers), or show a one-line glossary legend below each stat grid on `sm:`. Replace title= with inline captions / a tappable info affordance for the outcome grid and InPlayOutcomeSheet. Wire onClick on spray markers (with an enlarged invisible hit circle) to render the selected description in a caption under the SVG.
- **Files:** `src/components/StatTooltip.tsx:12-23`, `src/app/s/[school]/[team]/team/page.tsx:236`, `src/app/s/[school]/[team]/player/[id]/page.tsx:142`, `src/components/records/Leaderboard.tsx:56-57`, `src/components/scoring/OutcomeGrid.tsx:96-213`, `src/components/scoring/InPlayOutcomeSheet.tsx:58-77`, `src/components/spray/SprayField.tsx:98`, `src/components/scoring/LiveSprayChart.tsx:172`

### F9. Establish and apply a 44px minimum touch-target convention for secondary controls

- **Why:** The headline pitch/outcome buttons correctly use h-12/h-14, but the surrounding controls cluster at 24-40px across the app: the always-present Undo (40px), runner-action / steal / WP-PB-balk buttons (36-40px), TagUp 'Left early?' (24px), FailedEventsSheet Retry/Discard (28px, Discard is destructive), cross-account link/dispute buttons (28px), settings copy/revoke icons (28px), name-review toggles (~30px), tab triggers (~32px), and grade/jersey chips (~18px). Outdoors one-handed these cause mis-taps, several on destructive or count-critical actions. A shared sizing pass (and pulling consequential actions off card-link tap paths) resolves a dozen findings.
- **Fix:** Define `h-11`(44px)/`size-11` as the floor for interactive controls on touch; bump the listed icon buttons, steppers, banner buttons and chips to `h-11`/`min-h-[44px]`, widen adjacent destructive pairs to `gap-2/gap-3`, and move the grade/jersey chip controls off the full-card <Link> surface so taps don't collide with navigation.
- **Files:** `src/components/scoring/GameStatusBar.tsx:89-153`, `src/components/scoring/RunnersControls.tsx:81-111`, `src/components/scoring/sheets/FailedEventsSheet.tsx:168-176`, `src/app/s/[school]/[team]/page.tsx:295-345`, `src/components/ui/tabs.tsx:15-30`, `src/app/s/[school]/settings/page.tsx:804-863`

## Quick wins (highest value-to-effort)

- Form-control font-size: drop `md:text-sm` in input.tsx:11 and change textarea.tsx:11 `text-sm`→`text-base` — two one-line edits kill iOS focus-zoom on every iPad, phone-landscape, and every textarea (resolves 4 findings).
- Dialog primitive scroll: add `max-h-[calc(100dvh-2rem)]` + internal overflow to dialog.tsx:38-39 and alert-dialog.tsx:37 — one shared edit makes Save/Confirm reachable, clearing a blocker plus two majors across EditLastPlay, GameForm, EndSeason, and stats-import dialogs.
- Drop hover gating on actions: replace `opacity-0 group-hover:opacity-100` (GameRow.tsx:121) and `md:opacity-0 md:group-hover:opacity-100` (s/[school]/page.tsx:302) with a can-hover variant — unblocks the schedule-action blocker and the team-management major in two className edits.
- Viewport export: add the 4-line `export const viewport` (viewportFit:'cover' + themeColor) to src/app/layout.tsx — enables edge-to-edge scoring, makes env() safe-area insets non-zero, and fixes the white status bar.
- Nav pills: `inline-flex items-center min-h-[44px] py-2.5 text-sm gap-2` on Layout.tsx:92-108 — turns the cramped sub-44px primary nav into real touch targets (one className change, every device).
- Wrap the wide grids: add `overflow-x-auto` + `min-w-[...]` around the opponent stats grid (opponents/[opponentKey]/page.tsx:184) and the CSV import preview (ScheduleUploadPreview.tsx:191) — stops the silent clipping and the full-page horizontal blowout.
- Dock cap: change PitchRail.tsx:131 `max-h-[55vh]`→`max-h-[55dvh]` — one-character fix aligning the dock cap with the dvh shell.
- Leaderboard team column: drop `hidden sm:inline` (Leaderboard.tsx:90-94) and truncate instead — restores Varsity/JV disambiguation on phones in one class change.
- StatLabel on touch: convert StatTooltip to a tap Popover (or add a `sm:` glossary legend) so WHIP/OPS/OBP definitions stop being a dead, misleading dotted-underline affordance on every touch device.

## Full punch list (deduped, by severity)

### 🔴 Blocker (3)

#### Live-scoring takeover renders below the fold inside the nav chrome — pitch dock off-screen, page double-scrolls
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Live scoring — core touch surface, Global shell, navigation & responsive foundation
- **Problem:** The in-progress shell is exactly h-[100dvh] but is a child of <main className="flex-1"> inside Layout, beneath the gradient header + xl:hidden 8-tab nav strip (~130-150px) and above a footer. Because dvh is viewport-relative (not parent-relative), the 100dvh block starts ~140px down the document, so its bottom-pinned PitchRail dock with Ball/Strike/In-play sits ~140px below the viewport bottom. The coach sees header+nav+status+part of the diamond but must page-scroll the whole document down to pitch and back up to read the score. The core 'all in one glance' premise is broken on every device that gets the <lg dock layout.
- **Fix:** Render the in_progress/suspended shell outside the nav Layout: a route group whose layout omits <Layout>, conditional skip in TeamLayout, or `fixed inset-0 z-50` instead of h-[100dvh] so it truly covers the viewport. See foundation fix 1.
- **Files:** `src/components/scoring/LiveScoring.tsx:232`, `src/app/s/[school]/[team]/score/[gameId]/page.tsx:131-155`, `src/app/s/[school]/[team]/layout.tsx:65-77`, `src/components/Layout.tsx:48-115`

#### Centered dialogs have no max-height/scroll — Save/Confirm footers fall off-screen mid-game
- **Devices:** phone↕, phone↔, tablet↔  ·  **Surfaces:** Live scoring — dialogs, sheets & opposing lineup, Schedule & opponents, Forms, auth, upload & settings
- **Problem:** DialogContent/AlertDialogContent are fixed elements centered with translate-y(-50%) and have no max-h and no overflow-y-auto (verified no consumer or global CSS adds it). EditLastPlay renders 20 h-10 result buttons in a 2-col grid on phone (~470px) plus count steppers, runner-movement selects, header and footer (~800px+); on a 360x640 phone the title clips above the viewport and Save/Cancel sit below the bottom edge, unreachable — a correction cannot be submitted. The same root cause drops GameFormDialog's Save under the keyboard in portrait and clips it in landscape, and clips EndSeason / stats-import confirm footers on ~390px landscape.
- **Fix:** Cap height and add internal scroll in both primitives (`max-h-[calc(100dvh-2rem)]`, grid-rows pinned header/footer, scrolling body) and cap EditLastPlay's result grid at `max-h-[40vh] overflow-y-auto`. See foundation fix 4.
- **Files:** `src/components/ui/dialog.tsx:38-39`, `src/components/ui/alert-dialog.tsx:37`, `src/components/scoring/dialogs/EditLastPlayDialog.tsx:279-301`, `src/components/scoring/dialogs/SubstitutionDialog.tsx:175`, `src/components/schedule/GameFormDialog.tsx:144-180`, `src/components/season/EndSeasonDialog.tsx:163-202`, `src/app/s/[school]/[team]/upload/stats/page.tsx:526-534`

#### Hover-gated row/card actions are invisible AND mis-tappable on every touch device
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Schedule & opponents, Public scores, landing pages & charts/visualizations
- **Problem:** The schedule per-game action cluster (Score / Mark Final / Edit / Delete) and the per-team admin Edit/Delete overlay are gated behind group-hover, which never fires on touch — so on any phone or iPad a coach cannot start scoring a non-live game, mark it final, edit, delete, rename or delete a team. The primary post-game workflow is unreachable. Worse, opacity-0 keeps the buttons in layout and hit-testable, so they reserve ~80-200px on the right of every row (squeezing the truncated opponent name) and a right-edge tap can fire the invisible Delete (only a JS confirm guards it). Simultaneously invisible and a mis-tap hazard.
- **Fix:** Gate the hover-hide behind @media(hover:hover) so touch keeps opacity-100; bump icon buttons toward 44px and space with gap-2. See foundation fix 6.
- **Files:** `src/components/schedule/GameRow.tsx:121-160`, `src/app/s/[school]/page.tsx:302-320`

### 🟠 Major (7)

#### Mobile nav pills are ~28px tall, 4px apart — primary navigation under 44px
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Global shell, navigation & responsive foundation, Public scores, landing pages & charts/visualizations
- **Problem:** This is the nav every iPad and phone sees (xl:hidden, renders <1280px). Each pill is py-1.5 (6px) + text-xs ≈ 28px tall with gap-1 (4px) between adjacent pills and no min-h/inline-flex. Tapping Roster/Schedule/Score one-handed outdoors frequently lands on the neighbouring tab (clears 24px AA but fails 44px HIG).
- **Fix:** Make them real touch targets: `inline-flex items-center min-h-[44px] py-2.5 text-sm` and widen to `gap-2`; the strip can still scroll horizontally. See foundation fix 5.
- **Files:** `src/components/Layout.tsx:92-108`

#### Diamond letterboxes to the short height in landscape — fielder/runner drag targets shrink to ~11-16px
- **Devices:** phone↔, phone↕  ·  **Surfaces:** Live scoring — core touch surface
- **Problem:** preserveAspectRatio="xMidYMid meet" + w-full h-full sizes the SVG to the SMALLER of the cell's width/height. In phone-landscape the 1fr diamond row is only ~190px tall after status bar + dock, so the diamond becomes a ~190px square floating in a wide letterboxed band. Fielder hit circles (r=4 => 8% => ~15px) and runner chips (r=2.8 => 5.6% => ~11px) fall far below 44px, making 'drag the fielder to the ball' and 'tap an occupied base' effectively un-targetable. Even in portrait these are only ~27px / ~19px.
- **Fix:** Don't let height alone drive the square in landscape: use a two-column landscape layout (diamond left, pitch/outcome controls right) or clamp with min-w/max-h, and enlarge the invisible hit circles (fielder r 4->6, runner tap area ~r4) so targets approach 44px at typical render sizes.
- **Files:** `src/components/scoring/DefensiveDiamond.tsx:344-348`, `src/components/scoring/DefensiveDiamond.tsx:655-674`, `src/components/scoring/DefensiveDiamond.tsx:573`, `src/components/scoring/LiveScoring.tsx:270`

#### Game status bar wraps ~9 controls into 2-3 rows, eating scarce vertical space and shifting the score
- **Devices:** phone↕  ·  **Surfaces:** Live scoring — core touch surface
- **Problem:** At 360px the row's fixed content (five 40px icon buttons + StateChip ~120px + MiniBases 28px + OfflinePill up to ~130px) plus the flex-1 ScoreLine sums ~470-600px vs ~336px available, and with flex-wrap (no overflow/scroll wrapper) it reflows to 2-3 rows. The status bar balloons to ~130-150px tall on the one surface where vertical space is most precious, and the score jumps position as the offline-pill label changes width (Live → Syncing N → Offline · N queued).
- **Fix:** On <sm collapse box/batter/offline-detail into the Manage menu or an overflow button, shrink the score to text-2xl on phone, and use a fixed two-tier layout (score line + single icon-cluster line) instead of flex-wrap so nothing reflows mid-game.
- **Files:** `src/components/scoring/GameStatusBar.tsx:75`, `src/components/scoring/GameStatusBar.tsx:89-153`, `src/components/scoring/GameStatusBar.tsx:185-189`, `src/components/scoring/OfflinePill.tsx:36-63`

#### Wide stat/opponent/CSV data grids lack a mobile strategy — they clip or blow out the page
- **Devices:** phone↕, phone↔, tablet↕  ·  **Surfaces:** Schedule & opponents, Forms, auth, upload & settings, Stats, tables & dashboards
- **Problem:** The opponent stats grid is fixed tracks summing ~612px inside a Card with `overflow-hidden` and no overflow-x wrapper, so BB/SO/RBI and the edit pencil are silently clipped and unreachable on a 375px phone. The schedule CSV-import preview grid (~836px min) has no overflow wrapper at all, so it forces document-level horizontal scroll on phone AND iPad-portrait, hiding the per-row Opponent/Location/Notes/DH/Remove controls — the core 'fix rows before saving' import step. The player season table scrolls correctly but has no frozen Season column and no edge affordance, so scrolling right slides the year label off and values lose row identity.
- **Fix:** Wrap each grid in `overflow-x-auto` with a `min-w-[...]`, add a right-edge fade and `sticky left-0` first column; replace the opponent Card's overflow-hidden. Preferred for phone: `hidden sm:grid` the wide grid and render a stacked key/value card per row below sm. See foundation fix 7.
- **Files:** `src/app/s/[school]/[team]/opponents/[opponentKey]/page.tsx:184-201`, `src/components/schedule/ScheduleUploadPreview.tsx:191-207`, `src/app/s/[school]/[team]/player/[id]/page.tsx:283-284`

#### Roster cards crush the player last name to ~28px wide on phone
- **Devices:** phone↕  ·  **Surfaces:** Stats, tables & dashboards
- **Problem:** At 360px: container px-6 leaves 312px, the 2-col grid gives ~148px/card, p-5 trims it to 108px, and the w-16 (64px) jersey block + gap-4 leave only ~28px for the name column. The text-2xl truncate last name renders as 'R…' for 'Rodriguez'. No sm:/md: override before md=768; math is deterministic. Even a 430px Pro Max gives the name only ~63px.
- **Fix:** Go single-column on narrow phones and shrink the jersey/padding: `grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4`, plus `p-3 sm:p-5`, `w-12 sm:w-16`, `gap-3 sm:gap-4`.
- **Files:** `src/app/s/[school]/[team]/page.tsx:253`, `src/app/s/[school]/[team]/page.tsx:270-271`, `src/app/s/[school]/[team]/page.tsx:278`

#### Stat-abbreviation glossary tooltips are hover/cursor-help only — unreachable on every touch device
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Stats, tables & dashboards, Public scores, landing pages & charts/visualizations
- **Problem:** Every cryptic abbreviation (WHIP, BAA, K/BB, FPCT, OPS, OBP...) is a dotted-underline cursor-help span whose definition only appears in a Radix Tooltip on hover. The trigger is a non-focusable <span> (no tabIndex) and Radix Tooltip deliberately does not open on touch (returns on pointerType==='touch'), so a phone/tablet user can NEVER read what a stat means while the dotted underline visually promises an explanation. No sm:hidden legend fallback exists at any cited site; the inline GLOSSARY Select on team:258 doesn't cover the grids/headers.
- **Fix:** Render StatLabel as a real <button> with a tap-toggle Popover, or show a one-line glossary legend below each stat grid on `sm:`; at minimum drop the misleading cursor-help/dotted-underline on touch. See foundation fix 8.
- **Files:** `src/components/StatTooltip.tsx:12-23`, `src/app/s/[school]/[team]/team/page.tsx:236`, `src/app/s/[school]/[team]/player/[id]/page.tsx:142`, `src/app/s/[school]/[team]/player/[id]/page.tsx:292`, `src/components/records/Leaderboard.tsx:56-57`

#### Grade chip and 'Set jersey?' chip are ~18px tap targets layered over the card-navigation Link
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Stats, tables & dashboards
- **Problem:** The grade dropdown trigger and the 'Set jersey?' link are `px-2 py-0.5 text-[10px]` pills (~18-20px tall, no sm:/md: override) positioned absolute z-10 in opposite top corners of a ~148px card, overlaying the full-card <Link>. On a phone a coach setting a player's grade will mis-tap into the player page instead, and this dropdown is the only inline grade control.
- **Fix:** Give the chips `min-h-[44px]` (py-2 + larger text) and move the grade control off the card-link tap path so taps don't collide with player-detail navigation. See foundation fix 9.
- **Files:** `src/app/s/[school]/[team]/page.tsx:333-345`, `src/app/s/[school]/[team]/page.tsx:295`, `src/app/s/[school]/[team]/page.tsx:321`

### 🟡 Minor (21)

#### Horizontal-scroll nav never scrolls the active tab into view and gives no overflow affordance
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Global shell, navigation & responsive foundation, Public scores, landing pages & charts/visualizations
- **Problem:** At 360px only the first 3-4 of 8 tabs fit. There is no ref/scrollIntoView on the active link and no edge-fade/chevron hint, so on a trailing page (Upload/Settings) the active orange pill is scrolled off-screen — the user can't tell which page they're on or discover that more tabs exist, and there's no hamburger fallback. Tablet-portrait fits all 8, so impact is mainly phones.
- **Fix:** Ref the active <Link> and `scrollIntoView({inline:'center'})` on route change; add a right-edge mask-fade or chevron; or collapse to a Sheet/hamburger below xl. See foundation fix 5.
- **Files:** `src/components/Layout.tsx:92`, `src/components/Layout.tsx:35-44`

#### Nav switches to the cramped mobile strip at xl(1280) — every iPad gets the tiny scroll nav
- **Devices:** tablet↕, tablet↔  ·  **Surfaces:** Global shell, navigation & responsive foundation
- **Problem:** The full desktop nav row is `hidden xl:flex` (>=1280px), so iPad portrait (768) and iPad/iPad Pro landscape (1024-1279) all fall back to the xs uppercase horizontal-scroll strip despite ample width. On a 1024px iPad in landscape this looks broken and wastes space (functional — all tabs scroll-reachable — so minor).
- **Fix:** Lower the switch to `lg`: `hidden xl:flex`→`hidden lg:flex`, `xl:hidden`→`lg:hidden`; for 768 portrait let the desktop row wrap (`flex-wrap`) instead of the strip. See foundation fix 5.
- **Files:** `src/components/Layout.tsx:66`, `src/components/Layout.tsx:92`

#### Inputs drop to 14px at md and Textarea is 14px everywhere — iOS focus-zoom on iPads, phone-landscape, and every textarea
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Global shell, navigation & responsive foundation, Schedule & opponents, Forms, auth, upload & settings
- **Problem:** Input is 16px on phone-portrait but `md:text-sm` makes it 14px at >=768px (every iPad and a phone in landscape >=md), and Textarea is `text-sm` (14px) at all widths. With no viewport/maximum-scale, iOS/iPadOS Safari auto-zooms a focused field <16px — firing on login/signup/settings/upload inputs, the live-scoring-in-landscape path, and every Notes textarea (single field, but unrecoverable without a pinch-out).
- **Fix:** Drop `md:text-sm` from input.tsx (keep text-base at all widths) and change textarea.tsx `text-sm`→`text-base`. See foundation fix 3.
- **Files:** `src/components/ui/input.tsx:11`, `src/components/ui/textarea.tsx:11`, `src/components/schedule/GameFormDialog.tsx:178`

#### Sheet/side-drawer close button is a ~16px corner target with no padding
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Global shell, navigation & responsive foundation
- **Problem:** The only close affordance on a sheet (mobile Sidebar + scoring sheets) is a bare 16px X icon with `absolute right-4 top-4` and no surrounding padding (sr-only span is out of flow), so the hit area is ~16px — hard to hit on touch. Overlay tap-to-dismiss mitigates, so minor.
- **Fix:** Give the Close a real hit area: `flex h-10 w-10 items-center justify-center` (or `p-2 -m-2`) so the target is >=40px while the glyph stays 16px.
- **Files:** `src/components/ui/sheet.tsx:60-63`

#### Several secondary live-scoring controls fall below the 44px touch minimum
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Live scoring — core touch surface
- **Problem:** Headline pitch/outcome buttons are correctly >=44px (h-14/h-12/h-11), but surrounding controls are 24-40px: the always-present Undo (40px), uncaught-third-strike row (40px), runner Steal/CS/Pickoff + WP/PB/Balk (36px), OfflinePill interactive (32px), TagUp Dismiss (28px) and 'Left early?' (24px), and dock More/Direct (36px). Outdoors one-handed these cause mis-taps; 24px is genuinely hard to hit.
- **Fix:** Raise to >=44px: GameStatusBar icon buttons `size-11`, K3-reach and dock More/Direct to `h-11`, RunnersControls to 44px height, and replace TagUp's h-6/h-7 ghost buttons with h-11 tap rows. See foundation fix 9.
- **Files:** `src/components/scoring/GameStatusBar.tsx:89-153`, `src/components/scoring/OutcomeGrid.tsx:155-167`, `src/components/scoring/RunnersControls.tsx:81-111`, `src/components/scoring/OfflinePill.tsx:63`, `src/components/scoring/TagUpChip.tsx:65-80`, `src/components/scoring/PitchRail.tsx:181-201`

#### Mid-game dialog/sheet action buttons sub-44px — including destructive 28px Discard
- **Devices:** phone↕, phone↔  ·  **Surfaces:** Live scoring — dialogs, sheets & opposing lineup
- **Problem:** FailedEventsSheet Retry/Discard are h-7 (28px) and Discard is destructive (drops a queued event), so an outdoor mis-tap can lose a play permanently. EditLastPlay's balls/strikes +/- steppers are h-9 (36px) and ~36px wide; RunnerActionDialog's six rapid steal/WP/PB/balk buttons are h-10 (40px), the design system's own 'too small'. All off the primary scoring surface (which uses h-12/h-14), so minor.
- **Fix:** Bump FailedEventsSheet rows to `h-11 px-3` with spacing between Retry and Discard, give EditLastPlay steppers `h-11 w-11`/size=icon, and switch RunnerActionDialog buttons to `outcomeSm` (h-11). See foundation fix 9.
- **Files:** `src/components/scoring/sheets/FailedEventsSheet.tsx:168-176`, `src/components/scoring/dialogs/EditLastPlayDialog.tsx:137-139`, `src/components/scoring/dialogs/RunnerActionDialog.tsx:88-105`

#### Dock primary pitch row (5-up grid) crowds 'Called K'/'Swing K'/'In play' labels at 360px
- **Devices:** phone↕  ·  **Surfaces:** Live scoring — core touch surface
- **Problem:** Inside the dock at 360px each pitchSm cell is ~52px of text room after gap-1.5 and px-1; Inter-Bold 'Called K'/'Swing K' are ~56-57px, a ~2px/side tight fit. Text doesn't clip (no truncate/overflow-hidden) and the 6px gap keeps neighbors clear, so it reads as snug rather than broken — but on the count-critical row at arm's length it looks cramped.
- **Fix:** Use a clearer split (3 cols x 2 rows) or shorten/allow two-line labels with `text-xs leading-tight whitespace-normal` so they sit comfortably.
- **Files:** `src/components/scoring/PitchRail.tsx:162-173`, `src/components/scoring/PitchRail.tsx:62-68`

#### Scoring nuance and outcome abbreviations live only in hover-only title= attributes
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Live scoring — core touch surface, Live scoring — dialogs, sheets & opposing lineup
- **Problem:** On a touch-only surface there is no hover, so every title= string is invisible: the outcome grid shows terse codes (FC, DP, SF, IF, CI) whose meaning lives only in the title; the mound-visit removal warning, the SF/SAC/IFR rules, and the runner 'drag to SAFE/OUT or tap' hint are hover-gated; and EditLastPlay's 20 result buttons show only codes with plain-English in title=. Partly mitigated (InPlayOutcomeSheet labels are already full words; FlowControls shows a visible count + orange border at >=3), so minor.
- **Fix:** Render explanatory copy inline as a caption/subtitle or behind a tappable info affordance; show the mound-visit 'next visit forces a change' line as visible text; surface the runner drag hint as an on-canvas caption. See foundation fix 8.
- **Files:** `src/components/scoring/OutcomeGrid.tsx:96-213`, `src/components/scoring/InPlayOutcomeSheet.tsx:58-77`, `src/components/scoring/FlowControls.tsx:64-75`, `src/components/scoring/DefensiveDiamond.tsx:570`, `src/components/scoring/dialogs/EditLastPlayDialog.tsx:301-302`

#### Opposing-batter scout panel uses 9-11px microtext and ~20px year-filter pills 4px apart
- **Devices:** phone↕, tablet↕  ·  **Surfaces:** Live scoring — dialogs, sheets & opposing lineup
- **Problem:** When the opponent is batting, the panel (full-width in SidebarSheet on phone) packs PA/AVG/OBP/SLG/HR/SO into six columns with 9px labels and renders year-filter chips ~20px tall (py-0.5) at 11px text, spaced 4px apart (gap-1, under the 24px WCAG floor, no min-h). The 9-11px text is hard to read at arm's length and the tiny pills are easy to mis-tap. Conditionally shown (availableYears>1) with recoverable mis-taps, so minor.
- **Fix:** Raise stat labels to text-[11px]/text-xs and use `grid-cols-3 sm:grid-cols-6` on phone; make YearPill `text-xs px-3 py-1.5 min-h-[36px]` and bump the row to `gap-2`.
- **Files:** `src/components/score/OpposingBatterPanel.tsx:234-245`, `src/components/score/OpposingBatterPanel.tsx:190`, `src/components/score/OpposingBatterPanel.tsx:171`, `src/components/score/OpposingBatterPanel.tsx:259`

#### Opposing-lineup picker's 12-column rows are cramped at 360px inside the p-6 sheet
- **Devices:** phone↕  ·  **Surfaces:** Live scoring — dialogs, sheets & opposing lineup
- **Problem:** The full-width sheet leaves ~312px after p-6; the 12-col row gives the jersey Input only col-span-2 (~45px, ~21px usable after px-3) and the position Select col-span-4 (~99px) where the placeholder/chevron crowd. A 2-digit jersey just fits and codes show fine (inputs are text-base, no zoom), so it's snugness/polish rather than clipped — but editing 9 rows mid-game is fiddly.
- **Fix:** Stack the row on phone (jersey+order on one line, last-name/position on the next) or widen jersey to col-span-3, and reduce sheet padding to `p-4 sm:p-6` to reclaim width.
- **Files:** `src/components/score/OpposingLineupPicker.tsx:167-208`, `src/components/scoring/EditOpposingLineupDialog.tsx:202`

#### 'More ▾' outcome popover opens side=right off a full-width trigger, with 36px items
- **Devices:** phone↕, phone↔  ·  **Surfaces:** Live scoring — dialogs, sheets & opposing lineup
- **Problem:** The 'More ▾' trigger is self-stretch (full rail width) but the popover is told to open side="right" with a fixed w-56 (224px). On a 360px phone there's no room to the right so Radix collision-flips to an unpredictable placement (often covering the trigger) — the sibling pitchPad popover correctly uses side="top" on dock, proving the miss. The CI / Infield-fly items are h-9 (36px), under 44px. (avoidCollisions keeps it on-screen, so not truly off-screen.)
- **Fix:** Use `side="bottom" align="start"` (or top) and `w-[--radix-popover-trigger-width]`; raise items to `h-11`.
- **Files:** `src/components/scoring/InPlayOutcomeSheet.tsx:111-130`

#### Edit-opposing-lineup Save/Cancel is not sticky — coach scrolls past 9 rows (and the keyboard) to submit
- **Devices:** phone↕, phone↔  ·  **Surfaces:** Live scoring — dialogs, sheets & opposing lineup
- **Problem:** The whole picker (9 rows of jersey/name/position + source buttons + helper text) lives in one `h-full overflow-y-auto` scroll container and the Save/Cancel row is its last child with no sticky/fixed. After editing the bottom slots — where the iOS keyboard already covers the lower half — the coach must dismiss the keyboard and scroll to the very bottom to find Save.
- **Fix:** Wrap the body `flex flex-col h-full`, give the picker `flex-1 overflow-y-auto`, and make the button row `sticky bottom-0 bg-background border-t` with safe-area bottom padding.
- **Files:** `src/components/scoring/EditOpposingLineupDialog.tsx:202`, `src/components/scoring/EditOpposingLineupDialog.tsx:229-240`

#### Primary stat tab triggers and stat controls sit under 44px
- **Devices:** phone↕, phone↔  ·  **Surfaces:** Stats, tables & dashboards
- **Problem:** Batting/Pitching/Fielding tabs (h-10 list, py-1.5 triggers ≈ 32px) are the primary section switch on every stat page yet fall short of 44px; the stat-leader Select and sort Button are h-9 (36px); leaderboard list-row links are py-2 (~32-40px). Above WCAG 24px AA so a comfort issue, but easy to miss outdoors one-handed.
- **Fix:** Bump the tab list to `h-11`/`h-12` with py-2.5 triggers on touch, use default `h-11` for Select/sort on phone, and give list-row links `py-3`. See foundation fix 9.
- **Files:** `src/components/ui/tabs.tsx:15-30`, `src/app/s/[school]/[team]/team/page.tsx:251-266`, `src/components/records/Leaderboard.tsx:82`

#### School-wide leaderboard hides the team column on phone — record-holders become indistinguishable
- **Devices:** phone↕, phone↔  ·  **Surfaces:** Stats, tables & dashboards, Public scores, landing pages & charts/visualizations
- **Problem:** In the school-wide view (teamLabelFor provided, records/page.tsx:206), the per-row team label that disambiguates Varsity vs JV is `hidden sm:inline`, so on phone-portrait a record line shows rank+year+jersey+name+value with no team — the view's most distinguishing column is dropped on the most common device. Rows still tap-route, so context-loss only.
- **Fix:** Drop `hidden sm:inline` and render the team as a truncating caption under the name (`block text-[11px] truncate max-w-[88px] sm:max-w-[120px]`).
- **Files:** `src/components/records/Leaderboard.tsx:90-94`

#### Cross-account link/discrepancy banner buttons are h-7 (28px), tightly spaced consequential actions
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Schedule & opponents
- **Problem:** All confirm/link/unlink/score-dispute buttons are h-7 (28px, twMerge overrides size=sm) and the Yes/No pair sits gap-1.5 (6px) apart. These resolve cross-account game links and score disputes, so at 28px and 6px apart they're easy to mis-tap (linking the wrong game or confirming the wrong score). Both banner components are not yet rendered anywhere, so impact is latent.
- **Fix:** Bump to `h-9`/`h-10` and widen the Yes/No pair to `gap-2`. See foundation fix 9.
- **Files:** `src/components/schedule/GameLinkBanner.tsx:168-247`, `src/components/schedule/GameDiscrepancyBanner.tsx:137-144`

#### Relink-banner game-include checkboxes are 14px with no tappable label
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Schedule & opponents
- **Problem:** Each game to include in a bulk relink is toggled by a raw 14px (h-3.5 w-3.5) checkbox; the adjacent date text is a plain <span> with no onClick and not wrapped in <label>, and the parent <li> has zero padding, so the only hit target is ~14px. Default-checked keeps it minor.
- **Fix:** Wrap checkbox + text in a `<label>` so the whole row toggles, enlarge to `h-4 w-4` minimum, and pad the label to ~44px row height.
- **Files:** `src/components/schedule/RelinkSuggestionsBanner.tsx:187-207`

#### Settings admin/invite rows use 28px (h-7 w-7) icon buttons for copy/revoke/remove
- **Devices:** phone↕, phone↔, tablet↕  ·  **Surfaces:** Forms, auth, upload & settings
- **Problem:** Copy / revoke-invite / remove-admin are icon-only buttons at h-7 w-7 (28px) holding a 14px icon, with the copy+revoke pair adjacent in a gap-2 row — ~16px under the 44px target, so a coach copying an invite link can hit Revoke instead. Both destructive actions are confirm()-guarded and 28px clears WCAG 24px AA on an admin-only low-frequency flow, so minor.
- **Fix:** Use `size="icon"` (h-10 w-10, drop p-0) — ideally h-11 w-11 — increase the gap to gap-3, and keep the destructive button visually separated from copy. See foundation fix 9.
- **Files:** `src/app/s/[school]/settings/page.tsx:770`, `src/app/s/[school]/settings/page.tsx:804-813`, `src/app/s/[school]/settings/page.tsx:863`

#### Stats name-review 'Use match' buttons are ~30px tall with 12px text
- **Devices:** phone↕, phone↔  ·  **Surfaces:** Forms, auth, upload & settings
- **Problem:** In the 'Review names before import' dialog, each possible-typo row's accept/undo toggle is `px-3 py-1.5 text-xs border-2` (~30-32px tall, 12px text, no responsive override). These are the per-row did-you-mean merges a coach taps on a phone — under 44px, tightly placed next to row text, and small outdoors.
- **Fix:** Use a real button size: `min-h-[40px] px-3 text-sm` (or reuse Button size=sm at h-9); they already have flex-shrink-0. See foundation fix 9.
- **Files:** `src/app/s/[school]/[team]/upload/stats/page.tsx:564-572`

#### Spray-chart marker details are hover-only (<title>), tiny, and not tappable
- **Devices:** phone↕, phone↔, tablet↕, tablet↔  ·  **Surfaces:** Public scores, landing pages & charts/visualizations, Live scoring — core touch surface
- **Problem:** Each batted-ball dot exposes its play description only via an SVG <title> (mouse-hover), and the <g>/<circle> have no onClick/onPointer and the svg is select-none, so on phones/tablets and the live-scoring tablet tapping a marker shows nothing — the per-play context is unreachable. At viewBox r~1.9 the dots are also ~10-12px (too small to deliberately target). Location+result are still conveyed visually, so minor.
- **Fix:** Wire onClick on the circle to set a selected marker and render its description in a caption under the SVG (or a tap Popover); add an enlarged invisible hit circle per marker. See foundation fix 8.
- **Files:** `src/components/spray/SprayField.tsx:98`, `src/components/scoring/LiveSprayChart.tsx:172`

#### Public /scores filters use 36px select triggers and 10px labels
- **Devices:** phone↕, phone↔, tablet↕  ·  **Surfaces:** Public scores, landing pages & charts/visualizations
- **Problem:** On /scores the four filter dropdowns (Sport/Association/Class/Division) are h-9 (36px, under 44px) in a 2-column grid on phone, with 10px labels. Fans browsing on a phone get cramped, easy-to-mis-tap controls. No iOS-zoom risk (Radix trigger is a button, not native select).
- **Fix:** Bump triggers to `h-11` and labels to `text-xs`.
- **Files:** `src/app/scores/ScoresFilters.tsx:110-114`

#### Destructive team Delete is a 32px target 4px from Edit, layered over the card link
- **Devices:** phone↕, phone↔  ·  **Surfaces:** Public scores, landing pages & charts/visualizations
- **Problem:** On phones the team Edit and Delete buttons are always visible but only h-8 w-8 (32px, overriding the icon default) and 4px apart (gap-1), sitting on the full-card navigation Link. A one-handed fat-finger tap easily hits Delete (which wipes the team's games/roster/stats) or the underlying card link. remove() is confirm()-guarded and isAdmin-gated, so not a one-tap wipe.
- **Fix:** Enlarge to `h-11 w-11`, use `gap-2`, and get the targets out of the link's tap path / separate Edit from the destructive Delete. See foundation fix 9.
- **Files:** `src/app/s/[school]/page.tsx:303-320`

### ⚪ Nit (5)

#### Dock max-height cap uses static vh instead of dvh
- **Devices:** phone↕, phone↔, tablet↕  ·  **Surfaces:** Live scoring — core touch surface
- **Problem:** The shell sizes with h-[100dvh] but the dock caps with max-h-[55vh]. vh resolves to the large viewport, so with the mobile toolbar shown the dock's max height can exceed 55% of the actually-visible area, slightly over-shrinking the 1fr diamond row. Bounded/transient since the cap only bites when content reaches it.
- **Fix:** Use `max-h-[55dvh]` to keep the cap consistent with the shell's dvh sizing. See foundation fix 1.
- **Files:** `src/components/scoring/PitchRail.tsx:131`

#### Compounding container px-6 + Card p-6 + hero p-8 starves dense stat grids at 360px
- **Devices:** phone↕  ·  **Surfaces:** Stats, tables & dashboards
- **Problem:** container px-6 + Card p-6 leaves only ~264px for the grid-cols-3 stat grids on a 360px phone; the player hero adds p-8 (~248px) and forces the text-6xl name to wrap to 2-3 lines. None of these carry a sm: variant. Cells still fit (read-only) and overflow-hidden prevents scroll, so cosmetic.
- **Fix:** Tighten on phone: `px-4 sm:px-6` containers, `p-4 sm:p-6` Cards, `p-5 sm:p-8` player hero — reclaims ~32px for the data.
- **Files:** `src/app/s/[school]/[team]/team/page.tsx:172`, `src/app/s/[school]/[team]/team/page.tsx:230`, `src/app/s/[school]/[team]/player/[id]/page.tsx:208`, `src/app/s/[school]/[team]/records/page.tsx:129`

#### 10-11px stat labels and qualifier notes are near the legibility floor on phone
- **Devices:** phone↕, phone↔  ·  **Surfaces:** Stats, tables & dashboards
- **Problem:** Stat-grid labels and qualifier notes use uppercase, letter-spaced text at 10-11px with no responsive size override, so on a 360px screen these dense all-caps abbreviations sit near the legibility floor in the 3-column cells. Non-interactive, so pure legibility.
- **Fix:** Use `text-xs` (12px) on phone (`text-[11px] sm:text-[10px]` to preserve the tight desktop look) and ease `tracking-wider` at the smallest sizes.
- **Files:** `src/app/s/[school]/[team]/team/page.tsx:235`, `src/app/s/[school]/[team]/team/page.tsx:301`, `src/app/s/[school]/[team]/player/[id]/page.tsx:141`, `src/app/s/[school]/[team]/records/page.tsx:157`

#### Opponent-player game log: 10-11px labels and a bare-text 'Open' link as the only box-score entry
- **Devices:** phone↕  ·  **Surfaces:** Schedule & opponents
- **Problem:** In the per-opponent-player games list the only jump to the box score is the word 'Open' — a padding-less text-sm link inside a py-1.5 <li> (the row itself isn't a Link), giving a ~20px-tall tap target. Stat labels (text-[10px]) and opponent-table headers (text-[11px]) are also small for outdoor reading. Low-traffic admin route, so nit.
- **Fix:** Make the whole row a Link or give 'Open' `py-2 px-3 inline-flex` (~44px); nudge labels to text-xs.
- **Files:** `src/app/s/[school]/[team]/opponents/[opponentKey]/[opponentPlayerId]/page.tsx:119-142`, `src/app/s/[school]/[team]/opponents/[opponentKey]/page.tsx:185`

#### Public scorecard live-state / meta labels render at 10px on phone
- **Devices:** phone↕  ·  **Surfaces:** Public scores, landing pages & charts/visualizations
- **Problem:** On the public scores cards the sport label, the Live/Updated badges, and the 'Live · Top 5 / synced 5m ago' footer are all fixed text-[10px] with no responsive override. The live inning state is genuinely useful to a fan refreshing scores yet is the smallest text on the card. Non-interactive, so readability nit.
- **Fix:** Raise the live-state badge and footer to text-[11px]/text-xs (keep the wide tracking), prioritizing the live inning indicator since it's live data.
- **Files:** `src/app/scores/page.tsx:542`, `src/app/scores/page.tsx:552`, `src/app/scores/page.tsx:567`

## Appendix — all confirmed findings (traceability)

Raw per-surface findings with verifier confidence, before dedup/grouping above.

| Severity | Conf. | Title | Surface |
|---|---|---|---|
| blocker | high | Full-viewport scoring shell is nested inside the global header + nav strip + footer, so the bottom pitch dock renders below the fold and the page double-scrolls | Live |
| blocker | high | Centered dialogs have no max-height or internal scroll — tall mid-game dialogs overflow a 360x640 phone and push Save/Cancel off-screen | Live |
| blocker | high | Per-game-row actions (Score / Mark Final / Edit / Delete) are hover-only — invisible AND mis-tappable on every touch device | Schedule |
| major | high | Mobile nav pills are ~28px tall and 4px apart — primary navigation tap targets far under 44px | Global |
| major | high | In phone-landscape the diamond letterboxes to the short height (~190px square) — fielder/runner drag targets shrink to ~12-16px and the wide side margins are wasted | Live |
| major | high | Game status bar packs ~9 controls into one flex-wrap row that wraps to 2-3 lines on a phone, eating scarce vertical space and shifting the score | Live |
| major | high | Roster cards crush player last name to ~28px wide on phone | Stats, |
| major | high | Stat-abbreviation glossary tooltips are hover/cursor-help only — unreachable on touch | Stats, |
| major | high | Grade chip and 'Set jersey?' chip are ~18px-tall tap targets — the only way to set grade/jersey on phone | Stats, |
| major | high | Opponent stats table is a 600px+ fixed grid clipped by Card overflow-hidden — right columns unreachable on phone | Schedule |
| major | high | Game add/edit dialog has no max-height or internal scroll — Save button is unreachable in landscape / with the keyboard up | Schedule |
| major | high | Schedule CSV preview grid is a fixed ~836px-wide track set with no overflow-x wrapper — blows out the page on phone & iPad-portrait | Forms, |
| major | medium | Dialog / AlertDialog content has no overall max-height or scroll — footer actions get clipped off short (landscape) viewports | Forms, |
| major | high | Team Edit/Delete are hover-gated — invisible & unreachable on touch tablets | Public |
| minor | high | Horizontal-scroll nav never scrolls the active tab into view and gives no overflow affordance — current page hides off-screen | Global |
| minor | high | Nav switches to the cramped mobile strip at xl (1280) — every iPad, even a 1024px iPad Pro in landscape, gets the tiny scroll nav | Global |
| minor | high | No viewport export — viewportFit:"cover", themeColor, and a configured viewport are all absent | Global |
| minor | high | Textarea default text-sm (14px) triggers iOS focus-zoom on every device | Global |
| minor | medium | Input drops to text-sm at md — iOS focus-zoom on every iPad and on phones in landscape | Global |
| minor | high | Sheet/side-drawer close button is a ~16px corner target with no padding | Global |
| minor | medium | Dock primary pitch row (5-up grid, pitchSm) overflows/clips its labels at 360px | Live |
| minor | high | Several secondary scoring controls are below the 44px touch minimum | Live |
| minor | high | Outcome abbreviations, rule warnings, and play definitions are exposed only via title= tooltips that never appear on touch | Live |
| minor | high | Sub-44px touch targets on mid-game action buttons (28px Retry/Discard, 36px count steppers, 40px runner actions) | Live |
| minor | high | Opposing-batter panel uses 9–11px microtext and ~20px-tall year-filter pills spaced 4px apart | Live |
| minor | medium | Opposing-lineup picker's 12-column input rows are too narrow to read at 360px inside the p-6 sheet | Live |
| minor | high | 'More ▾' outcome popover opens to the right of a full-width trigger — risks opening off-screen on phone, and its items are 36px tall | Live |
| minor | high | Edit-opposing-lineup Save/Cancel is not sticky — coach must scroll past all 9 input rows (and the keyboard) to submit | Live |
| minor | high | Player season table scrolls horizontally with no frozen Season column or scroll affordance | Stats, |
| minor | high | Primary tab triggers and stat controls sit under the 44px touch minimum | Stats, |
| minor | high | School-wide leaderboard hides the team column on phone (hidden sm:inline) | Stats, |
| minor | high | Notes textarea uses text-sm (14px) — iOS auto-zooms the dialog on focus | Schedule |
| minor | high | Cross-account link/discrepancy banner buttons are h-7 (28px) — undersized, tightly spaced consequential actions | Schedule |
| minor | high | Relink banner game-include checkboxes are 14px (h-3.5 w-3.5) with no tappable label | Schedule |
| minor | high | Settings admin/invite rows use 28px (h-7 w-7) icon-only buttons for destructive actions | Forms, |
| minor | high | Inputs drop to 14px at md (every iPad) and Textarea is 14px everywhere — triggers iOS focus zoom | Forms, |
| minor | high | Stats name-review 'Use match' buttons are ~30px tall with 12px text | Forms, |
| minor | high | Destructive team Delete is a 32px target 4px from Edit, layered over the card link | Public |
| minor | high | Spray-chart marker details are hover-only (<title>) — lost on every touch device | Public |
| minor | high | Public scores filters use 36px select triggers and 10px labels | Public |
| minor | high | School-wide records hides the team column on phones | Public |
| minor | high | Stat-definition tooltips on records headers are hover-only | Public |
| minor | high | 8-item team nav is a horizontal scroll strip with no active-into-view or overflow affordance | Public |
| nit | medium | Dock height cap uses static vh instead of dvh | Live |
| nit | high | Scoring nuance lives only in hover-only title attributes that never appear on touch — and the Edit-play buttons show cryptic abbreviations | Live |
| nit | medium | Compounding container px-6 + Card p-6 + hero p-8 starves dense stat grids on 360px | Stats, |
| nit | high | 10–11px stat labels/data are hard to read on phone | Stats, |
| nit | high | Opponent-player game log: small text-[10px] labels and a bare text "Open" link as the only scoring entry point | Schedule |
| nit | high | Scorecard live-state / meta labels render at 10px on phone | Public |

---
_Recommended follow-up: validate visually in a device emulator / real iPhone + iPad once the foundation fixes land. Static analysis caught the structural issues; on-device testing confirms the feel._
