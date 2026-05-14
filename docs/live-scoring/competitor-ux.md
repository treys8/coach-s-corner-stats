# Live Scoring UX Reference: Competitor Analysis

Reference doc for designing Statly's tablet live-scoring flow. Built from official help docs, cheat sheets, app store reviews, forum discussions, and tutorial walkthroughs. Where exact mechanics differ between sources (often because GameChanger redesigned in 2024–2025), both are noted.

**Compiled:** 2026-05-13.

---

## 1. GameChanger (gc.com) — primary parity target

GameChanger ("GC") is the dominant scorekeeping app in youth and high school baseball. The "Classic" white-icon app was sunset Dec 31, 2023, replaced by the modern "GameChanger" app. In 2024–2025 they shipped a "Streamlined Scoring" redesign on iOS that flattened the pitch menu — important context, because older cheat sheets describe a deeper menu tree than the live app today.

### Screen layout (iPad landscape, current)

- Diamond/field view is the persistent base layer with bases, runners, and a defensive field diagram.
- A "Pitch" baseball icon sits on the pitcher's mound — historically the entry point for every action.
- Post-redesign, a **persistent scoring bar** surfaces Ball, Called Strike, Swing-and-Miss, Foul Ball, Undo, Redo, and "Ball in Play" outside the pitch menu so scorekeepers stay in the field view.
- Spray chart icon lives in the bottom right of the scoring screen and shows the current batter's chart on tap.
- Count, outs, and inning live across the top.

### Q1 — Pitch entry flow

**Common outcomes (one-tap from the bar, post-redesign):**
- Ball
- Called Strike
- Swing and Miss
- Foul Ball
- Ball in Play
- Undo / Redo

**Conditional outcomes (appear only when situation allows):**
- "On Wild Pitch" and "Passed Ball" surface only after at least one pitch has been thrown to the current batter.
- Intentional Walk: a dedicated "Intentional Walk" button skips the requirement to enter four balls in adult divisions.
- Hit by Pitch is its own option in the pitch menu (then drag the batter as the new runner to first).

**Uncommon outcomes (behind the Pitch menu / additional taps):**
- Balk — tap "Balk" in the pitch screen; runners auto-advance one base.
- Pickoff — entered by dragging the runner and selecting "Pickoff Attempt" (then Safe or Out).
- Pitchout — historically inside the deeper pitch menu (not surfaced on the new bar).

The pre-redesign flow was: tap big "Pitch" → modal pops up with Ball / Called Strike / Swing & Miss / Foul Ball / Ball in Play / HBP / Balk / Wild Pitch / Passed Ball / Intentional Walk. The redesign flattens the four most common into a permanent bar so the modal only opens for the long-tail outcomes.

### Q2 — "In play" play picker

When the scorekeeper taps **Ball in Play**, GameChanger does a hit-type picker first, then a result picker, then fielder placement. It is NOT a single spray-chart tap.

**Step-by-step (typical single to right field):**
1. Tap **Ball in Play** (on the persistent bar or from the pitch menu).
2. Modal: pick contact type — **Ground Ball, Hard Ground Ball, Fly Ball, Line Drive, Pop Fly, Bunt**.
3. Modal: pick outcome — **Hit, Out (Batter Out), Error, Fielder's Choice**.
4. If Hit: pick **Single / Double / Triple / Home Run / Inside-the-Park HR**.
5. **Drag the fielder glove** from its position to the spot on the field diagram where the ball was first touched. Tap **Done**.
6. Resolve any runners (separate drag step; see Q3).

**Tap count from "ball is in play" to "play committed" with no runners on:** typically 4–5 taps plus one drag (Ball in Play → contact type → outcome → hit type → drag fielder → Done). With runners on, add a drag per runner.

The fielder-drag step is also how the spray chart gets populated — location is captured in the play-entry flow, not a separate screen (see Q9).

**NOTE (user-supplied 2026-05-13):** The current GC flow appears to have a more outcome-first path where the user picks contact type (e.g., "Ground ball") then is offered shortcut buttons like **"Out at first"** that collapse the full cascade — the shortcut implies the throw destination (1B) and the user only needs to drag the *first* fielder to where the ball was hit. The play is scored as `<dragged_pos>-3` (e.g., 6-3). This is shorter than the 4-step cascade described above. See [[live_scoring_v2_ux_direction]] for how Statly is adopting this outcome-first model.

### Q3 — Runner advancement UX

GameChanger uses **drag-and-drop on the diamond**, not tap-to-advance.

- Each runner appears as a token on their current base.
- The scorekeeper **taps and drags a runner** along the basepaths.
- When the drag begins, two drop targets appear: a green **SAFE** box and a red **OUT** box (paired with each base).
- Dropping in SAFE on a base = that runner is now on that base.
- Dropping in OUT records the out and prompts for additional context (e.g., on the rundown, caught stealing, picked off).
- Dropping a runner past home into SAFE prompts "On Last Play" to credit the batter with an RBI vs an unrelated advance.

Common advancement modals fired by the drop:
- **Stolen Base** — runner advances on a non-WP/PB pitch with either an unsuccessful throw or no throw.
- **Caught Stealing** — drag toward target base, drop in OUT, tap each fielder in throw order, Done.
- **Pickoff** — drag back toward previous base, drop in OUT, choose pickoff context.
- **Rundown** — drag to OUT, tap each fielder in the order they touched the ball.

### Q4 — Sac fly / sac bunt detection

GameChanger does **not auto-detect** sac fly purely from "flyout with R3" — the user must select the sac flag, but it only surfaces when the situation allows it.

**Sac fly entry:** Pitch → Ball in Play → Fly Ball → Batter Out → **Sac Fly**. The Sac Fly button only appears in the modal when there is a runner on third with fewer than two outs. Once chosen, the runner auto-scores and the batter gets the sacrifice plus RBI without an additional drag.

**Sac bunt entry:** Pitch → Ball in Play → **Bunt** → either **Sac Bunt (Safe)** if the batter beat it out, or **Batter Out** which auto-advances runners and credits the sacrifice.

So the model is: the app surfaces the sacrifice option contextually inside the existing flow, but does not pre-confirm "Did R3 tag?" — the scorekeeper chooses it.

### Q5 — Fielder's choice

FC is entered as a sub-option of Ball in Play, not as a separate top-level button.

**Flow (user-supplied 2026-05-13, simpler than help-doc cascade):**
- Example: R1 on, batter hits grounder to 2B, force at 2nd.
- 1. Tap **Ground ball** (contact type).
- 2. Drag **2B icon** → field location (where ball was caught).
- 3. Drag **SS icon** → 2nd base bag (where throw was received and out recorded).
- 4. Tap **Done**.
- App recognizes: 2B fielded, threw to SS covering 2nd, R1 out on force, batter safe at 1B → scored as **4-6 FC**.

**Alternative (help-doc cascade):**
1. Pitch → Ball in Play → **Ground Ball** (most common).
2. Tap **Fielder's Choice**.
3. Tap each fielder involved (in touch order).
4. Choose whether the **batter** was Safe or Out at first.
5. The app then prompts **"Which other runner was out?"** with a list of the runners on base — scorekeeper taps the runner that was forced/tagged out.
6. Drag any remaining runners to their final bases.

A specific FC subtype "Runner Forced Home" exists in the help docs as a dedicated scoring path.

**Insight (drag-chain pattern):** the multi-fielder drag IS the scorebook notation. First drag = where ball was first touched (spray point). Subsequent drags = throw sequence. Where the last drag lands = where the out was recorded. From this the engine derives spray, assists, putout, outs recorded, runners forced out, and batter destination. See [[live_scoring_v2_ux_direction]].

### Q6 — Errors mid-play (single + throwing error → R2 scores)

GameChanger handles compound plays as **one play entry with multiple participants**, not two separate entries.

**Single tap path (simple error):** Tap the **Error** button (inside Ball in Play outcomes) → tap the player who made the error. Errors are assigned to a specific fielder.

**Compound plays (hit + error during the throw):**
- The "Advanced Fielding" feature is the dedicated path: it lets the scorekeeper score the throws made on a ball in play and assign throwing errors during the sequence.
- Practical flow: enter the hit normally (e.g., Single), tap each fielder that touched the ball in order, and when a throw is errant the app prompts to tag that throw as the error and assign it to the responsible fielder. Then drag R2 home and drop in SAFE — the scorer credits the extra advance to the error rather than the hit.
- Edits like "Single + scored on error" / "Double + scored on error" / "Triple + scored on error" / "Fielder's Choice + scored on error" are explicit edit categories in the play editor, confirming the model is one play with error annotation, not two stacked plays.

### Q7 — Substitutions (pitching change, defensive sub, courtesy runner)

Substitutions are accessed by **tapping the player icon** in the field or batting position, not via a separate menu.

- **Defensive sub / pitching change:** tap the fielder icon on the field diagram, choose the incoming player, confirm. The change applies for the remainder of the game until further substitution.
- **Offensive sub:** tap the current batter or runner.
- **Tapping a runner** opens a menu with: **Pinch Runner**, **Special Pinch Runner**, **Courtesy Runner** — courtesy runner is explicitly supported (relevant for HS rules where catchers/pitchers can have a CR).

Forum reports flag substitutions as the trickiest part of GC: correcting lineup errors mid-game is "time consuming" and "required additional post-game editing for plays that had already occurred" — a known pain point.

### Q8 — Undo / redo

- **Undo** is a top-bar button visible at all times in the new scoring bar. Removes the last play.
- **Redo** is also persistent post-redesign.
- For older plays, scorekeepers go to the **Plays tab**, tap the play, then **Edit** to change participants or outcome.
- Editing the pitcher or defensive fielder propagates forward until the next substitution; editing the batter/runner affects only that play.
- The "Enhanced Play Editing" rollout added the ability to retroactively flip outcomes between hits and errors and add "scored on error" annotations.

### Q9 — Spray chart / ball location

Captured **in-line during play entry**, not on a separate screen.

- The "drag the fielder to where the ball was first touched" step on Ball-in-Play populates the spray chart point.
- Tapping the spray chart icon (bottom right of scoring screen) opens an overlay of the current batter's season chart while scoring.
- After the game, season charts are filterable by Hits / Outs / Fly Balls / Line Drives / Ground Balls and surface batting-tendency percentages.

### Q10 — Common user complaints

Synthesized from PissedConsumer reviews, App Store reviews, justuseapp, baseball forums, and the FilterJoe long-form review.

**UX-specific complaints:**
- Substitutions are "the most challenging" aspect — particularly correcting lineup errors mid-game.
- Adding a second parent to a player after creation is "unnecessarily complicated, requiring recreation of player profiles."
- Hard to fix mistakes that weren't caught immediately (the Plays-tab editor exists but isn't discoverable).
- Wished for: a "view which player subbed for who in regular viewing, not just scorebook view."
- For slow-pitch/coach-pitch leagues: missing automatic rover/4th outfielder setting, 1-1 automatic count, time limit — settings have to be changed every game.
- Coach-pitch leagues require a complication workaround that is "difficult to keep up with multiple times each inning."
- Search engine for finding teams is poor.
- Editing complex error scenarios (runners advance on a throwing error) is hard for scorers to figure out.
- "Many good features from the original version were removed and replaced with inferior ones" — a Classic vs new redesign theme.

**Non-UX complaints (still relevant for positioning):**
- Heavy paywall complaints on Google Play: "horribly pay-walled, inviting users to do all kinds of things and then only after getting their hopes up telling them to pay up."
- ~1/3 of video streams reportedly drop (not our problem since we don't stream).
- Double charges, can't cancel, locked paid accounts, poor support — common subscription complaints.
- Parents lose access to past games after a season.
- "Coach getting hit by a foul ball because he wasn't looking up from his iPad" — anecdotal but a real concern about cognitive load on the scorer.

**Praise (worth preserving in our design):**
- "UI is comparatively easier than iScore."
- Drag-and-drop fielder/runner is "intuitive."
- Undo is appreciated and discoverable.
- Lineup entry requires only a name OR a number — minimal friction at game start.
- Practice/explore mode is well-received for onboarding.

### Q11 — Pricing model

GameChanger's model is **free for coaches, paid for parents/fans, with a Team Pass override**.

- **Coaches and team staff:** All features free.
- **Plus (individual):** $9.99/month or $39.99/year ($3.33/month effective) — unlimited live stream viewing, live play-by-play, box scores, GameStream Radio, alerts.
- **Premium:** Plus + season stats, spray charts, full event videos, highlight clipping.
- **Family Plan:** Up to 4 accounts.
- **Team Pass:** One-time purchase by a team staffer that gives the entire team and followers Plus/Premium for the full season. Bulk pricing for clubs (contact sales).
- **Free tier for fans:** Five baseball/softball live streams free.

The relevant positioning insight: **scorekeeping is free; monetization is on parents wanting streams and stats.** Since Statly explicitly does not stream, we need a different lever — most likely school/team subscriptions for the broader stats/management package.

---

## 2. iScore Baseball (iScore Sports / Faster Than Monkeys)

iOS-only, paid (no free tier). Reputation: the most detail-rich scorekeeping app, but "cumbersome and clunky." Targets serious/advanced scorers, not casual parents.

### Pitch entry flow

iScore tracks more per-pitch detail than GC by default:
- **Pitch type:** scorekeeper can pre-configure each pitcher's arsenal with default velocity, then tap the pitch type label per pitch.
- **Pitch location:** tap inside a pitch-zone widget — inner rectangle = strike zone, outer rectangle = outside the zone, bottom of outer rectangle = ball in dirt.
- **Pitch speed:** "speed wheel" to the left of the pitch area; flick up/down to set velocity.
- **Outcome buttons:** Ball, Strike, Foul, Out (then sub-menu for out type).

So iScore is materially more pitches-per-pitch than GameChanger — fine for showcase teams, way too much for HS parents/parents scoring.

### "In play" / play picker

Driven by an **"interview process"**: after each play, the app asks a chain of questions to nail down the outcome. Sample chain for a single with R2 trying for home:
1. Outcome: Single.
2. "What happened to the batter after reaching first?" → "Safe, at Second, On the Throw."
3. Question continues for each runner.

Settable: **"Minimize Questions" = Yes/No**. With Minimize Questions = Yes, the scorer skips interview prompts for default outcomes ("held up") and only enters deviations. This is the major iScore UX lever and the reason it feels powerful-but-slow.

### Runner advancement

Driven by the interview process rather than direct manipulation. Stolen bases, pickoffs, passed balls are all in the interview tree, with "every stolen base, pick-off and passed ball" tracked individually.

### Sac fly / sac bunt

Surfaced via the interview process when situation allows it — same conditional pattern as GC, but inside a question dialog rather than a button on a contextual modal.

### Substitutions

Two distinct UX choices worth borrowing:
- **Tap the batter icon** to open the offensive sub dialog; **tap a fielder icon** to open defensive sub.
- A toggle at the top of the substitution dialog flips between offensive and defensive — same dialog, switchable mode.
- Critically, iScore deliberately decouples offensive and defensive subs: "make the defensive changes when you see them in the field, and make the offensive changes when you see the player at bat. Things are optimized for 'scoring what you see' as opposed to requiring inside knowledge."

### Undo / redo

**Multilevel undo/redo**: "lets you return to any point in the game, from the first play to the last." More powerful than GC's single-step undo plus play editor.

### Praise & complaints

- Praise: most thorough box scores and statistical output of any youth app; 500+ stats; pitcher arsenal pre-configuration.
- Complaints: cumbersome, clunky, steep learning curve; iOS only; paid; no game-planning tools; not parent-friendly.

---

## 3. DiamondKast (Perfect Game's official app)

Used at Perfect Game tournaments and showcase events. Targets scout-grade data collection — operationally more like iScore than GC.

- Scout-grade pitch data: pitch counts, velocities, locations per pitch.
- Stats sync to the Perfect Game player profile after every event.
- Scorekeepers must be approved per-team before they can score.
- In-app correction allowed during or post-game.

Limited public UX-flow documentation since it's gated behind approval. Less relevant for HS coaches not on the PG circuit.

---

## 4. Honorable mentions

- **Rizzler** — coach-phone-first ("score from the dugout between pitches"); AI lineup builder, pitch count, playing time. Builds an interesting positioning ("for the coach, not the parent") that GC doesn't own.
- **At The Plate** — Windows-first; mostly irrelevant for tablet/iPad.
- **PenScore** — emulates paper scorebook UX on mobile; niche.
- **Baseball Pro Scorekeeping** — used by some indie pro leagues and college summer leagues.

---

## Cross-app patterns / recommendations for Statly

These are the convergent design choices both leading apps make. Diverging from them needs a deliberate reason.

1. **Pitch entry has a persistent bar for the 4 common outcomes (Ball / Called Strike / Swing-Miss / Foul) + one button for "In Play".** GC's 2024 redesign explicitly went this way to cut taps. Statly's existing pitch model (small `PitchPayload` + at_bat event) already supports it; the UI should follow.

2. **Uncommon outcomes (Balk, Intentional Walk, Pitchout, HBP, WP, PB) live behind a "More" menu** and conditionally — e.g., WP/PB only appears if a pitch has been thrown, IBB skips the four-ball requirement.

3. **"In play" is a guided modal cascade, not a spray-chart-first picker.** Sequence: contact type → outcome → hit-type → drag-fielder-to-location → Done. The drag-fielder step *also* sets the spray chart location, killing two birds with one drag.

4. **Runner advancement is drag-and-drop on the diamond with SAFE/OUT drop targets** that appear during the drag. Both GC and (functionally) iScore converge here.

5. **Contextual sacrifice options.** Don't auto-decide sac fly — surface the Sac Fly button only when R3 + < 2 outs + fly-ball outcome. Same for Sac Bunt and FC's "which runner is out?" prompt.

6. **Tap-the-player-icon for substitutions** — both GC and iScore use this affordance. Don't put subs in a top-bar menu.

7. **Single play, multiple participants for compound plays** (single + throwing error). Avoid forcing two play entries — that's the biggest source of "I can't figure out how to score this" complaints.

8. **Multilevel undo, not just last-play undo.** iScore's "any point in the game" undo is what GC's edit-past-play system tries to replicate clumsily. Build the proper undo stack from the start.

9. **HS-specific affordances that GC fudges:** courtesy runner that doesn't enter the game officially (GC has it on the runner menu, but reviews complain it's tucked away), and easier mid-game lineup correction.

10. **Don't gate stats / spray charts behind a paywall to parents.** GC's biggest sentiment problem is paywall fatigue. Since Statly's monetization isn't streaming, the school-pays model lets us be generous to families.

---

## Sources

- [Basic Scorekeeping – GameChanger](https://help.gc.com/hc/en-us/articles/30710418133005-Basic-Scorekeeping)
- [Advancing Baserunners – GameChanger](https://help.gc.com/hc/en-us/articles/30502355100813-Advancing-Baserunners)
- [Sacrifice Fly / Bunt – GameChanger](https://help.gc.com/hc/en-us/articles/30565609750285-Sacrifice-Fly-Bunt)
- [Fielder's Choice – GameChanger](https://help.gc.com/hc/en-us/articles/30565133227149-Fielder-s-Choice)
- [Score a Runner Forced Home – GameChanger](https://help.gc.com/hc/en-us/articles/30673338796301-Score-a-Runner-Forced-Home)
- [Scoring Errors – GameChanger](https://help.gc.com/hc/en-us/articles/30565065136013-Scoring-Errors)
- [Score a Pickoff – GameChanger](https://help.gc.com/hc/en-us/articles/30672580358029-Score-a-Pickoff)
- [Score a Rundown – GameChanger](https://help.gc.com/hc/en-us/articles/30568094281485-Score-a-Rundown)
- [Editing Past Plays – GameChanger](https://help.gc.com/hc/en-us/articles/360031203911-Editing-Past-Plays)
- [Enhanced Play Editing For Scorekeepers – GameChanger blog](https://gc.com/post/enhanced-play-editing-for-scorekeepers)
- [Streamlined Scoring for Baseball and Softball – GameChanger](https://gc.com/post/new-scoring-experience-for-gamechanger-baseball-softball)
- [Batting/Pitching Season Spray Charts – GameChanger](https://help.gc.com/hc/en-us/articles/360032127111-Batting-Pitching-Season-Spray-Charts)
- [GameChanger Team Pass FAQs](https://help.gc.com/hc/en-us/articles/7286489078413-Team-Pass-FAQs)
- [GameChanger Team Pass pricing page](https://gc.com/pricing/team-pass)
- [Individual Subscription FAQs – GameChanger](https://help.gc.com/hc/en-us/articles/28521445314957-Individual-Subscription-FAQs)
- [Review: GameChanger Scorekeeping App for Youth Baseball – FilterJoe](https://www.filterjoe.com/2015/03/05/review-gamechanger-scorekeeping-app-for-youth-baseball/)
- [GameChanger 101: Tutorial – North Texas Select Baseball](https://www.ntxselectbaseball.com/gamechanger-101-tutorial-a-parents-guide-to-scoring-baseball-games/)
- [GameChanger Scoring Cheat Sheet (Baseball WA, 2024)](https://baseballwa.com.au/wp-content/uploads/2024/05/GC-NEW-SCORING-Cheat-sheet-2024.pdf)
- [Chino Hills Little League – GC Scoring Cheat Sheet](https://dt5602vnjxv0c.cloudfront.net/portals/22970/docs/2024%20chll%20-%20gc%20scoring%20cheat%20sheet.pdf)
- [Santa Cruz Little League – Ball in Play Guidelines](https://dt5602vnjxv0c.cloudfront.net/portals/53455/docs/scorekeeping/gamechanger/gamechanger%20ball%20in%20play%20guidelines.pdf)
- [GameChanger Scorekeeping Summary for Beginners (PDF)](https://dt5602vnjxv0c.cloudfront.net/portals/52001/docs/2024/game%20changer%20scorekeeping%20summary%20for%20beginners.pdf)
- [GameChanger Training Guide – Lineups and Substitutions](https://cdn2.sportngin.com/attachments/document/ecd8-3532921/GameChanger_Training.pdf)
- [Pitch Type and Velocity Tracking – GameChanger](https://help.gc.com/hc/en-us/articles/4579112075021-Pitch-Type-and-Velocity-Tracking)
- [Advanced Fielding – GameChanger (legacy Zendesk)](https://gamechanger.zendesk.com/hc/en-us/articles/215629523-Advanced-Fielding-)
- [212 GameChanger Reviews @ PissedConsumer](https://gamechanger.pissedconsumer.com/review.html)
- [GameChanger app problems / complaints – justuseapp](https://justuseapp.com/en/app/1308415878/gamechanger-team-manager-new/problems)
- [GameChanger Classic Reviews – justuseapp](https://justuseapp.com/en/app/318906314/gamechanger-baseball-softball/reviews)
- [GameChanger App – App Store (iPad reviews)](https://apps.apple.com/us/app/gamechanger/id1308415878?see-all=reviews&platform=ipad)
- [iScore Baseball Features – iScore Sports](https://iscoresports.com/baseball/)
- [iScore Baseball/Softball Scorekeeper User Manual (PDF)](https://cdn1.sportngin.com/attachments/document/f7a3-3123589/User_Manual__iScore_.pdf)
- [iScore User Manual v4.0](http://iscoreleagues.com/manual/)
- [iScore Baseball – App Store](https://apps.apple.com/us/app/iscore-baseball-and-softball/id364364675)
- [Defensive Substitution – ESPN iScore (YouTube)](https://www.youtube.com/watch?v=tVdQObRs2Wo)
- [iScore Forum – Correct way to make substitutions](http://iscoreforum.com/baseball/viewtopic.php?t=6314)
- [GameChanger vs iScore – River Sharks Baseball](https://riversharks.com/gamechanger-vs-iscore/)
- [GameChanger vs iScore – baseballthing.com](https://baseballthing.com/gamechanger-vs-iscore/)
- [The Best Baseball Scorekeeping Apps (And Which Ones to Skip) – chalkandclay](https://chalkandclay.com/baseball-scorekeeping-apps/)
- [Best Baseball Scorekeeping Apps for Coaches in 2026 – Rizzler](https://rizzlersports.com/learn/best-baseball-scorekeeping-apps)
- [DiamondKast Scoring App – App Store](https://apps.apple.com/us/app/diamondkast-scoring-app/id1519866089)
- [DiamondKast Plus Compare – Perfect Game USA](https://www.perfectgame.org/Registration/DiamondKastPlusCompare.aspx)
- [To GameChanger or not to GameChanger – Baseball Fever forum](https://www.baseball-fever.com/forum/general-baseball/amateur-baseball/71366-to-gamechanger-or-not-to-gamechanger)
- [More GameChanger Scoring Questions – Discuss Fastpitch Softball](https://www.discussfastpitch.com/threads/more-gamechanger-scoring-questions.37321/)
- [GameChanger Announces Most Comprehensive Update in 15 Years](https://gc.com/partner-news/gamechanger-announces-most-comprehensive-product-update-in-its-15-year-history)
- [Exclusive: GameChanger Unveils Largest Product Overhaul – YSBR](https://youthsportsbusinessreport.com/exclusive-gamechanger-unveils-largest-product-overhaul-in-15-years/)
