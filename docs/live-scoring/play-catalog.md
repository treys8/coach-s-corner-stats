# Statly Play Catalog (v0.1 DRAFT)

> **DRAFT — needs review before treating as canonical engine spec.**
> Compiled by user 2026-05-13; Claude review pass 2026-05-13.
> Known issues and open questions are listed at the top. Items below them are the working catalog; once issues are resolved this becomes the engine source-of-truth.

---

## Known Issues & Open Questions

**STATUS (2026-05-13 Q&A pass):**
- ✅ **6.14 PB earned/unearned** — User decided to KEEP current "normally earned" wording. Engine still computes ER per OSR rules at half-inning close; the catalog stays as written for coach-facing copy.
- ✅ **8.6 / 11.6 / 17.4 Pitcher re-entry** — RESOLVED via NFHS 3-1-2 verification; items updated.
- ✅ **11.1 PH count** — FIXED. "PH inherits the count from the previous batter."
- ✅ **Notation conventions** — All 6 LOCKED (F2, E5T, L6, "DP" suffix, SF7, F2(f)).
- ⏭ **Gap-fillers (8 proposed)** — SKIPPED for v2; revisit as real games surface need.
- ⏭ **12.11 Continuous batting order** — DEFERRED to v3 (v2 stays 9-batter varsity-only).
- 🟡 **1.6 Dropped K + E2, 10.7 RBI judgment, 2.13 IFR force-removal, 2.16 bunt intentional drop, 10.12 inherited runners, 5.10 hit by batted ball** — Still open; tighten during implementation when each comes up.

Item numbers below reference the entries in the catalog body.

### Factual issues to fix

1. **6.14 (Runner Scores on Passed Ball) — incorrect.** Currently says run is "normally earned." Per OSR 9.16(a), runs scoring as a result of a PB are **unearned** — PB is treated like an error during the "reconstruct the inning" rule. Compare to WP (6.12), which correctly is noted as earned. Fix: change to "Run normally **unearned** (PB is treated like an error for reconstruction even though it is not charged as one in the stat sheet)."

2. **8.6 / 11.6 / 17.4 Pitcher re-entry — RESOLVED 2026-05-13.** Verification agent confirmed: under NFHS 3-1-2, a starting pitcher **MAY** return to pitch later in the same game, subject to (a) faced at least one batter as pitcher, (b) not removed via 4th defensive charged conference, (c) re-entry not already used, (d) once per inning limit, (e) state pitch-count rules may bar return independently, (f) P/DH carve-out (started as P/DH then relieved on mound → cannot return to pitch). Items 8.6, 11.6, 17.4, and Appendix B item 4 have been updated below.

3. **11.1 Pinch Hitter — wording is ambiguous.** Currently says: *"PH inherits any count from previous batter? — NO, count carries to new batter"* — these phrases contradict. Actual rule: **PH inherits the count.** Rewrite as: *"PH inherits the count from the previous batter (e.g., if original batter was 2-1 when removed, PH starts at 2-1)."*

4. **1.6 Dropped K — "K + E2 if catcher errored on recoverable ball" is imprecise.** A dropped catchable ball with no subsequent throw = **PB**, not E2. E2 applies only when the catcher recovers the ball and makes a wild throw to 1B. Clarify.

5. **10.7 Run scores on error — RBI judgment rule is incomplete.** Per OSR 9.04(b), the precise question is "would R3 have scored without the error?" Specifically: RBI is credited if R3 would have scored on a hit/sac/out anyway, and the error only affected the batter's advance or other runners. Tighten the wording.

### Gaps to fill

Items I'd add for completeness (see Claude review for details):
- **Intentional drop** of fly/line drive (OBR 5.09(a)(12)) — distinct from IFR, applies to bunts and line drives
- **Reverse-force DP** — explicit entry under Category 7 (timing-play implications)
- **Force-play slide rule** (NFHS 8-4-2b) — illegal slide = auto-DP (runner AND batter-runner out)
- **Runner out of basepath** (>3 feet to avoid tag)
- **Batter's interference on strikeout-throwout** — special: with <2 outs, runner is out; with 2 outs, batter is out
- **Ejection events** — coach/player ejected mid-game
- **Illegal bat / equipment violations** — pre-AB, mid-AB, post-AB penalties differ
- **Awarded base on overthrow** — 2 bases from time of pitch (first throw) vs from time of throw (subsequent)

### Convention decisions to lock

Engine will pick one and stick with it:
- **Pop out to catcher:** F2 (chosen — consistent with F7/F8/F9)
- **Throwing error:** E5T (chosen — more compact than E5/TH)
- **Lineout:** L6 (no hyphen)
- **DP/TP suffix:** "6-4-3 DP" (with suffix, matches standard scorebook practice)
- **Sac fly:** SF7 (compact, parseable: SF prefix + outfielder number)
- **Foul indicator:** F2(f) suffix only when distinguishing foul catch from fair catch in the same position

### Subtle clarifications worth adding

- **2.13 IFR:** force is removed the instant batter is called out → runners must tag if caught, NOT forced if dropped
- **2.16 Bunt pop out:** intentional drop on a bunt is governed by OBR 5.09(a)(12), separate from IFR (which explicitly excludes bunts)
- **10.12 Inherited runners:** clarify count-based, not identity-based — first N runs scored after pitching change are charged to prior pitcher
- **5.10 Hit by batted ball:** specify that "passing an infielder" timing determines runner-not-out exception

### Scope question

- **12.11 Continuous batting order** for JV/freshman games — our existing `no_extra_hitter_in_hs_baseball` memory says 9-batter lineups, but that's varsity. Should v2 support configurable lineup length for sub-varsity? Open product decision.

---

## Catalog

The following is the catalog as supplied by the user 2026-05-13. Issues called out above are NOT yet edited in below — they're flagged for revision in the next pass.

### CATEGORY 1: STRIKEOUTS

#### 1.1 Strikeout Swinging
**Situation:** Batter swings and misses at strike three.
- **Notation:** K
- **PA:** yes | **AB:** yes | **Outs:** +1
- **Credits:** P → K; C → PO (putout)

#### 1.2 Strikeout Looking (Called)
**Situation:** Batter takes strike three without swinging.
- **Notation:** Kc or backwards ꓘ
- **PA:** yes | **AB:** yes | **Outs:** +1
- **Credits:** P → K; C → PO

#### 1.3 Strikeout on Foul Tip
**Situation:** With two strikes, batter foul-tips the pitch directly into the catcher's glove and it is held cleanly.
- **Notation:** K (or K (foul tip))
- **PA:** yes | **AB:** yes | **Outs:** +1
- A foul tip caught is a strike; if it's strike three, batter is out and ball remains live (runners may try to advance).

#### 1.4 Strikeout on Foul Bunt with Two Strikes
**Situation:** Batter bunts the ball foul with two strikes.
- **Notation:** K or K(B)
- **PA:** yes | **AB:** yes | **Outs:** +1
- **[NFHS]** Same as MLB rule — bunting foul with two strikes is an automatic strikeout regardless of where ball goes.

#### 1.5 Dropped Third Strike — Batter Automatically Out
**Situation:** Catcher fails to catch strike three, BUT first base is occupied AND fewer than 2 outs.
- **Notation:** K
- **PA:** yes | **AB:** yes | **Outs:** +1
- Batter is automatically out — catcher does NOT need to throw to 1B. Rule prevents intentional drop for double play.

#### 1.6 Dropped Third Strike — Batter Reaches Safely
**Situation:** Catcher fails to catch strike three; first base is unoccupied OR there are 2 outs. Batter runs and reaches 1B.
- **Notation:** K-WP or K + PB (or K + E2 if catcher errored on recoverable ball)
- **PA:** yes | **AB:** yes | **Outs:** 0 | Batter on 1B
- Pitcher IS credited with K even though batter reached. This is the one case where a pitcher can have more Ks than batters retired.

#### 1.7 Dropped Third Strike — Throw Out at First
**Situation:** Dropped third strike scenario; catcher recovers and throws batter out at 1B.
- **Notation:** K 2-3
- **PA:** yes | **AB:** yes | **Outs:** +1
- **Credits:** P → K; C → assist; 1B → PO

#### 1.8 Strikeout + Caught Stealing (Strike-em-out, Throw-em-out)
**Situation:** Batter strikes out swinging or looking. On the same continuous play, runner attempting to steal is thrown out.
- **Notation:** Batter: K; runner: CS2 (2-6) or similar
- **Outs:** +2 (double play)
- **Credits:** P → K; C → assist; receiving fielder → PO. Pitcher gets DP credit.

#### 1.9 Strikeout + Pickoff on Same Play
**Situation:** Strikeout occurs; on same play sequence catcher picks off a different runner.
- **Notation:** K; separate PO for runner
- **Outs:** +2 (recorded as two separate events depending on official scorer judgment)

#### 1.10 Strikeout — Runner Steals on Pitch
**Situation:** Batter strikes out; runner successfully steals without throw or with throw too late.
- **Notation:** K; runner: SB2
- **Outs:** +1
- Pitcher K; catcher PO; runner credited SB.

---

### CATEGORY 2: BATTED BALL OUTS — INFIELD

#### 2.1 Groundout, Pitcher to First
- **Notation:** 1-3
- **PA:** yes | **AB:** yes | **Outs:** +1
- **Credits:** P → A; 1B → PO

#### 2.2 Groundout, First Baseman to Pitcher Covering
- **Notation:** 3-1
- 1B fields, flips/throws to pitcher covering the bag.

#### 2.3 Groundout, First Baseman Unassisted
- **Notation:** 3U or 3 (some books)
- 1B fields and steps on the bag himself.

#### 2.4 Groundout, Second Baseman to First
- **Notation:** 4-3

#### 2.5 Groundout, Shortstop to First
- **Notation:** 6-3

#### 2.6 Groundout, Third Baseman to First
- **Notation:** 5-3

#### 2.7 Groundout, Catcher to First
**Situation:** Slow roller in front of plate.
- **Notation:** 2-3

#### 2.8 Groundout, Catcher Unassisted
- **Notation:** 2U
- Catcher fields a bunt or dribbler and steps on home (force) or tags batter.

#### 2.9 Pop Out to Catcher
- **Notation:** P2 or F2 (depending on scorer convention)
- **PA:** yes | **AB:** yes | **Outs:** +1

#### 2.10 Pop Out to First / Second / Third / SS
- **Notation:** P3, P4, P5, P6
- Standard infield popups in fair territory.

#### 2.11 Foul Pop Out
- **Notation:** F2 (foul), F3 (foul), F5 (foul) — often distinguished by adding (f) suffix
- Most commonly caught by C, 1B, 3B near foul lines or stands.

#### 2.12 Lineout to Infielder
- **Notation:** L4, L6, etc.
- Hard line drive caught by infielder.

#### 2.13 Infield Fly Rule
**Situation:** Fair fly ball (not a line drive or bunt) that can be caught with ordinary effort by an infielder, with runners on 1st-2nd or bases loaded, with fewer than 2 outs.
- **Notation:** IFF plus fielder, e.g., IFF6 or P6 (IFR)
- Batter is OUT immediately when umpire calls "Infield Fly." Ball remains live; runners advance at own risk.
- **Outs:** +1. If ball drops uncaught, batter is still out (this is the entire point of the rule).

#### 2.14 Sacrifice Bunt (Successful)
**Situation:** Batter bunts; batter is thrown out at 1B but runner(s) advance.
- **Notation:** SH plus play, e.g., SH 1-3 or SH 3-1
- **PA:** yes | **AB:** NO (sacrifice does not count as AB) | **Outs:** +1
- Batter credited with SH; runner advance noted.

#### 2.15 Sacrifice Fly
**Situation:** Fly ball caught for an out; runner from 3B tags up and scores.
- **Notation:** SF7 (fly to LF with sac fly), SF8, SF9
- **PA:** yes | **AB:** NO | **Outs:** +1
- Batter credited with SF and RBI (run scored).

#### 2.16 Bunt Pop Out
**Situation:** Batter pops up a bunt; caught in the air.
- **Notation:** P1 or P3 etc.
- **PA:** yes | **AB:** yes | **Outs:** +1
- Note: if intentionally dropped by infielder to attempt double play, infield fly rule does NOT apply to bunts.

#### 2.17 Foul Bunt Out
- **Notation:** F1 etc.
- Bunt caught in foul territory before hitting ground.

#### 2.18 Fielder's Choice (Out at Lead Base)
**Situation:** Batter hits grounder; defense throws to retire a lead runner instead of the batter.
- **Notation:** FC plus play, e.g., FC 6-4
- **PA:** yes | **AB:** yes | **Outs:** +1
- Batter not credited with hit. Runner who was retired is the out.

#### 2.19 Fielder's Choice (No Out Recorded, Lead Runner Safe by Choice)
**Situation:** Batter reaches base while defense unsuccessfully tries for lead runner (no out made).
- **Notation:** FC
- **PA:** yes | **AB:** yes (batter charged with AB but no hit) | **Outs:** 0
- Used when batter could have been out at 1B but defense chose to throw elsewhere.

---

### CATEGORY 3: BATTED BALL OUTS — OUTFIELD

#### 3.1 Flyout to Left Field
- **Notation:** F7

#### 3.2 Flyout to Center Field
- **Notation:** F8

#### 3.3 Flyout to Right Field
- **Notation:** F9

#### 3.4 Lineout to Outfielder
- **Notation:** L7, L8, L9

#### 3.5 Sacrifice Fly to Outfield
**Situation:** Fly ball caught for out; runner tags up and scores from 3B.
- **Notation:** SF7, SF8, SF9
- **AB:** NO | **RBI:** yes | **Outs:** +1

#### 3.6 Foul Fly Out Down the Line
**Situation:** Fly into foul territory caught by corner outfielder or 3B/1B.
- **Notation:** F7 (foul) or fielder code with (f)

#### 3.7 Outfield Assist on the Play
**Situation:** Batter hits flyball, caught; runner tags from 3B; OF throws home, runner out at plate.
- **Notation:** F8 for batter; 8-2 for runner out
- One PA, but two outs recorded (potential inning-ending double play).

---

### CATEGORY 4: BATTER REACHES BASE — HITS

#### 4.1 Single (1B)
**Situation:** Batter hits ball, reaches 1B safely without error.
- **Notation:** Diagonal line to 1B corner, 1B or –
- **PA:** yes | **AB:** yes | **H:** yes (single)

#### 4.2 Infield Single
**Situation:** Ball never leaves the infield; batter beats out throw or fielder cannot make play.
- **Notation:** 1B with annotation (e.g., 1B/IF); some scorers write IH
- Same stat impact as single — AB and H credited.

#### 4.3 Bunt Single
**Situation:** Batter bunts for a hit (not sacrifice — must be ruled hit by scorer).
- **Notation:** 1B(B) or BH
- **AB:** yes | **H:** yes
- Scorer judgment: if batter clearly attempting to advance runner and beats throw anyway, may still be ruled a hit, not a sacrifice.

#### 4.4 Double (2B)
- **Notation:** 2B or =
- **PA:** yes | **AB:** yes | **H:** yes (double)

#### 4.5 Ground-Rule Double
**Situation:** Fair ball bounces over outfield wall, or stuck in fence/equipment.
- **Notation:** 2B (GR) or GRD
- All runners advance exactly two bases from time of pitch.

#### 4.6 Triple (3B)
- **Notation:** 3B

#### 4.7 Home Run (Out of Park)
- **Notation:** HR
- **PA:** yes | **AB:** yes | **H:** yes | **R:** yes | **RBI:** 1 + any runners on base

#### 4.8 Inside-the-Park Home Run
**Situation:** Batter circles all bases on a fair ball that does not leave field.
- **Notation:** HR (IPHR)
- Scored as HR if no errors materially contributed; otherwise scored as a hit + errors.

#### 4.9 Walk-Off Hit
**Situation:** Home team takes the lead with hit in bottom of last inning (7th in HS regulation, or any extra inning).
- **Notation:** Standard hit notation; game ends when winning run scores.
- **[NFHS]** Regulation game is 7 innings.

#### 4.10 Walk-Off Home Run
**Situation:** Game-ending HR by home team.
- **Notation:** HR; batter must touch all bases; full RBI awarded for all baserunners.

---

### CATEGORY 5: BATTER REACHES BASE — NON-HITS

#### 5.1 Walk (Base on Balls)
**Situation:** Four balls.
- **Notation:** BB or W
- **PA:** yes | **AB:** NO | OBP counts | Pitcher: BB charged

#### 5.2 Intentional Walk
**Situation:** Pitcher intentionally walks batter.
- **Notation:** IBB or IW
- **[NFHS]** Coach may award an intentional walk WITHOUT throwing four pitches by notifying the umpire. No pitches required. (Adopted in 2018.)

#### 5.3 Hit By Pitch
**Situation:** Pitched ball hits batter while in box (and batter did not swing or intentionally lean into pitch).
- **Notation:** HBP
- **PA:** yes | **AB:** NO | OBP counts
- **[NFHS]** Batter must attempt to avoid the pitch; if umpire judges no attempt, ball is called a strike or ball but batter does not get base.

#### 5.4 Reached on Error
**Situation:** Batter would have been out with ordinary effort, but defender muffs the play.
- **Notation:** E plus fielder, e.g., E6 (error by shortstop)
- **PA:** yes | **AB:** yes | **H:** NO | Fielder: E credited
- Batter does not get a hit; ROE tracked separately.

#### 5.5 Reached on Catcher's Interference
**Situation:** Catcher's glove (or any part of catcher) touches bat or batter during swing.
- **Notation:** CI or INT
- **PA:** yes | **AB:** NO | Batter awarded 1B
- Catcher charged with error (E2). Runners advance only if forced.

#### 5.6 Reached on Obstruction
**Situation:** Fielder without ball impedes a runner (incl. batter-runner).
- **Notation:** OBS
- Batter/runner awarded base umpire judges they would have reached.

#### 5.7 Reached on Dropped Third Strike (See 1.6)
- **Notation:** K-WP, K-PB, or K + E2
- Batter reaches 1B but pitcher gets K.

#### 5.8 Reached on Fielder's Choice (See 2.19)
- **Notation:** FC
- **AB:** yes | **H:** NO

#### 5.9 Reached on Throwing Error
**Situation:** Batter's grounder fielded cleanly, but throw to 1B is wild.
- **Notation:** E6T (throwing error by SS) or E6/TH
- Distinguish throwing errors from fielding errors in stats.

#### 5.10 Reached When Hit by Batted Ball (Rare)
**Situation:** A batted fair ball strikes a runner before passing a fielder — runner is out, but batter is credited with a hit (1B) unless force was in effect.
- **Notation:** Out: runner; Hit: 1B for batter (rule-dependent)
- **Outs:** +1

---

### CATEGORY 6: BASE RUNNING — STEALS AND ADVANCES

#### 6.1 Stolen Base, 2nd
- **Notation:** SB2
- Runner advances to 2B without being put out and without error/WP/PB credited.

#### 6.2 Stolen Base, 3rd
- **Notation:** SB3

#### 6.3 Stolen Base of Home (Straight Steal)
- **Notation:** SBH
- Rare; runner from 3B breaks for plate on pitch.

#### 6.4 Double Steal
**Situation:** Two runners successfully steal on same play.
- **Notation:** DSB or two separate SB entries
- Common: R1 steals 2B while R3 holds, OR R1 and R2 each advance.

#### 6.5 Triple Steal
**Situation:** All three runners advance one base on same pitch.
- **Notation:** Three separate SB entries
- Extremely rare; typically involves a delayed steal of home.

#### 6.6 Caught Stealing
**Situation:** Runner thrown out attempting to steal.
- **Notation:** CS2 (2-6) (caught stealing 2nd, C to SS)
- **Outs:** +1

#### 6.7 Pickoff at First
**Situation:** Pitcher throws to 1B; runner tagged out off the bag.
- **Notation:** PO (1-3) or just PO
- **Outs:** +1

#### 6.8 Pickoff at Second
- **Notation:** PO (1-4) or (1-6) depending on which middle infielder.

#### 6.9 Pickoff at Third
- **Notation:** PO (1-5) or PO (2-5) (catcher to 3B)

#### 6.10 Pickoff-Caught Stealing (PO/CS)
**Situation:** Runner takes off after pitcher's pickoff attempt, gets caught stealing.
- **Notation:** POCS plus fielders
- Statistically credited as caught stealing (not just pickoff).

#### 6.11 Runner Advances on Wild Pitch
**Situation:** Pitch gets past catcher; pitcher's fault per scorer judgment. Runner advances.
- **Notation:** WP with arrow to new base
- No SB credit.

#### 6.12 Runner Scores on Wild Pitch
- **Notation:** WP with run-scored mark
- Run is unearned only if WP is errored; normally earned.

#### 6.13 Runner Advances on Passed Ball
**Situation:** Catcher's fault per scorer judgment.
- **Notation:** PB

#### 6.14 Runner Scores on Passed Ball
- **Notation:** PB
- Run normally earned (PB is not technically an error). **⚠️ KNOWN ISSUE — see top of doc; PB runs are normally UNEARNED per OSR 9.16(a).**

#### 6.15 Runner Advances on Balk
**Situation:** Pitcher commits an illegal motion with runner(s) on base.
- **Notation:** BK
- All runners advance one base. If bases loaded, run scores. Batter's count and AB unaffected (unless balk occurred during pitch — then ball is dead).

#### 6.16 Runner Advances on Defensive Indifference
**Situation:** Late innings, lopsided score; defense doesn't contest steal.
- **Notation:** DI (not a stolen base)
- Runner advances but no SB credited.

#### 6.17 Runner Thrown Out Advancing on Hit
**Situation:** Single to OF; runner from 1B tries for 3B, thrown out.
- **Notation:** 1B; runner out 8-5
- Batter still credited with single. **Outs:** +1 (on runner).

#### 6.18 Runner Tagged Out on Overslide
**Situation:** Runner slides past base; fielder tags him before he can return.
- **Notation:** Position numbers of tag; e.g., 4 (out at 2B by 2B tag)

#### 6.19 Runner Caught in Rundown
**Situation:** Defense traps runner between bases.
- **Notation:** Sequence of fielders, e.g., 5-3-6-4 for a rundown
- **Outs:** +1

#### 6.20 Runner Doubled Off on Line Drive
**Situation:** Line drive caught; runner had left early, can't get back.
- **Notation:** L6 + 6-3 or LDP
- **Outs:** +2 (line drive double play)

#### 6.21 Runner Forced Out at 2B
**Situation:** Force play on grounder; runner from 1B retired at 2B.
- **Notation:** Fielder sequence, e.g., 4-6 (out at 2B)

#### 6.22 Runner Forced Out at Home
**Situation:** Bases loaded; grounder; throw home for force.
- **Notation:** e.g., 5-2 (3B to C for force at home)

#### 6.23 Runner Misses Base — Appeal Out
**Situation:** Runner fails to touch a base; defense throws to that base and appeals; umpire calls out.
- **Notation:** Appeal play; batter credit depends on situation
- **Outs:** +1; can negate run scored (e.g., runner who appeared to score misses 3B, run nullified).

#### 6.24 Runner Leaves Base Too Early on Fly Ball (Appeal)
**Situation:** Runner tags up but leaves before catch; defense appeals.
- **Notation:** Appeal out at originating base, e.g., 9-5 (RF throws to 3B)

#### 6.25 Runner Passes Another Runner
**Situation:** Trailing runner overtakes preceding runner.
- **Notation:** Trailing runner is out
- Common on HRs where lead runner stops to admire.

#### 6.26 Runner Out at Home Plate
**Situation:** Runner thrown out trying to score.
- **Notation:** e.g., 8-2 (CF to C)

---

### CATEGORY 7: DOUBLE AND TRIPLE PLAYS

#### 7.1 6-4-3 Double Play
**Situation:** Grounder to SS, throw to 2B for force, relay to 1B.
- **Notation:** 6-4-3 DP
- **Outs:** +2

#### 7.2 4-6-3 Double Play
**Situation:** Grounder to 2B, throw to SS at 2nd, relay to 1B.
- **Notation:** 4-6-3 DP

#### 7.3 5-4-3 Double Play
**Situation:** Grounder to 3B, throw to 2B, relay to 1B (around the horn).
- **Notation:** 5-4-3 DP

#### 7.4 3-6-3 Double Play
**Situation:** Grounder to 1B, throw to SS at 2nd, relay back to 1B (pitcher covering).
- **Notation:** 3-6-3 DP

#### 7.5 3-6-1 Double Play
**Situation:** Grounder to 1B, throw to SS at 2nd, relay to P covering 1B.
- **Notation:** 3-6-1 DP

#### 7.6 1-6-3 Double Play
**Situation:** Comebacker to pitcher, throw to SS, relay to 1B.
- **Notation:** 1-6-3 DP

#### 7.7 Strike-em-out Throw-em-out (See 1.8)
- K + CS = DP credited.

#### 7.8 Line Drive Double Play
**Situation:** Liner caught; runner doubled off base.
- **Notation:** e.g., L6-3 or LDP

#### 7.9 Unassisted Double Play
**Situation:** One fielder records both outs alone.
- **Notation:** e.g., 3-3 UA DP (1B catches liner, steps on bag)

#### 7.10 Triple Play — 5-4-3
**Situation:** Grounder, force at 3B, force at 2B, throw to 1B.
- **Notation:** 5-4-3 TP
- Extremely rare; runners must be on 1B and 2B.

#### 7.11 Triple Play — Line Drive
**Situation:** Liner caught; runners doubled off two bases.
- **Notation:** L6 TP or sequence
- Bases loaded; runners going on contact.

#### 7.12 Unassisted Triple Play (Extremely Rare)
**Situation:** One fielder records all three outs (catch + tag runner + step on base).
- **Notation:** TP UA

#### 7.13 Time Play — Run Scores Before Third Out
**Situation:** Third out NOT a force; runner crosses home before third out is recorded.
- Run counts. Critical to track timing.
- **[NFHS]** Same as MLB rule.

#### 7.14 Force Out Negates Run
**Situation:** Third out IS a force out (incl. batter-runner not reaching 1B).
- Run does NOT count even if runner crossed plate before out.

---

### CATEGORY 8: PITCHING EVENTS

#### 8.1 Wild Pitch
**Situation:** Pitch that catcher cannot reasonably be expected to handle; runner(s) advance.
- **Notation:** WP (scorer judgment)
- Pitcher charged.

#### 8.2 Passed Ball
**Situation:** Catchable pitch that catcher fails to control.
- **Notation:** PB
- Catcher charged (not technically an error but tracked).

#### 8.3 Balk
**Situation:** Pitcher commits one of several illegal actions with runner(s) on base.
- **Notation:** BK
- All runners advance one base; ball dead in NFHS unless pitch is thrown.

#### 8.4 Hit Batter
- See 5.3.

#### 8.5 Pitcher Hit by Batted Ball
**Situation:** Comebacker strikes pitcher; ball can remain live.
- Notation depends on outcome — may be a hit or out.

#### 8.6 Pitching Change
**Situation:** Coach removes pitcher mid-game.
- **Notation:** Mark in book with new pitcher's name and inning/batter entered.
- **[NFHS 3-1-2]** Starting pitcher MAY return to pitch later in the same game, subject to:
  (1) must have faced at least one batter as pitcher;
  (2) not removed via the 4th defensive charged conference;
  (3) one-per-game starter re-entry not yet used;
  (4) only once per inning (cannot remove + return as pitcher twice in same inning);
  (5) state pitch-count / rest-day rules may independently bar return;
  (6) **P/DH carve-out** — a player who started as P/DH and was relieved on the mound may NOT return to pitch (may stay in only as DH).

#### 8.7 Mound Visit (No Change)
**Situation:** Coach visits without removing pitcher.
- **[NFHS]** Three trips in same inning or fourth trip in game results in mandatory pitcher removal. (Trip counts differ by state — check association rules.)

#### 8.8 Pitch Count Limit Reached
**Situation:** Pitcher hits state-mandated pitch count; must be removed.
- **[NFHS]** Required per NFHS Rule 6-2-6; each state association sets specific counts and required rest days. App MUST track pitch count and flag thresholds. (Example tier set: 30 pitches = 0 days rest; 76+ pitches = 4 days rest, varies by state.)

#### 8.9 Pitcher Finishes Batter at Threshold
**Situation:** Pitcher reaches limit mid-AB.
- **[NFHS]** Most state rules allow pitcher to finish current batter even if limit hit mid-AB.

#### 8.10 Quick Pitch
**Situation:** Pitcher delivers before batter is set.
- **Notation:** Illegal pitch; ball awarded to batter; runners advance.

#### 8.11 Illegal Pitch (No Runners)
**Situation:** Balk-type action with no runners on base.
- **[NFHS]** Ball is added to batter's count (not a balk since no runners).

---

### CATEGORY 9: ERRORS

#### 9.1 Fielding Error (Bobbled Grounder)
- **Notation:** E plus position, e.g., E6
- Charged when fielder muffs ball that should be handled with ordinary effort.

#### 9.2 Throwing Error
**Situation:** Fielder makes throw that pulls receiver off bag or sails out of play.
- **Notation:** E with TH annotation, e.g., E5T or E5/TH
- Charged to throwing fielder.

#### 9.3 Dropped Throw (Receiving Error)
- **Notation:** E3 (receiver charged) e.g., 1B drops good throw.

#### 9.4 Dropped Fly Ball
- **Notation:** E7, E8, E9
- Outfielder muffs catchable fly.

#### 9.5 Dropped Foul Ball
**Situation:** Fielder drops catchable foul; batter remains at bat.
- **Notation:** E with (f) annotation
- Charged as error even though no batter advanced.

#### 9.6 Error Allowing Extra Bases
**Situation:** Hit + error — batter gets clean single, but error allows him to reach 2B or further.
- **Notation:** 1B + E8 or similar
- Batter credited with single AND fielder with error.

#### 9.7 Two-Base Throwing Error
**Situation:** Error allows runner(s) to advance two bases.
- Tracked for runner advancement; one error charged to thrower.

#### 9.8 Catcher Interference (See 5.5)
- **Notation:** E2 (CI)
- Counts as error against catcher.

#### 9.9 Multiple Errors on One Play
**Situation:** Two fielders both err on same play.
- **Notation:** E6 + E3 (e.g., SS bobble plus 1B drop)
- Each fielder charged with their own error.

#### 9.10 No Error on Mental Mistake
**Situation:** Fielder throws to wrong base or fails to back up; no physical misplay.
- **Notation:** No error; runner advance noted (e.g., 1B; runner to 3B on throw to home).

#### 9.11 Error on Pickoff Attempt
**Situation:** Pitcher's pickoff throw goes errant.
- **Notation:** E1 (pickoff); runner advances.

---

### CATEGORY 10: RUNS AND RBIS

#### 10.1 Solo Home Run
- **RBI:** 1 (batter drives himself in)

#### 10.2 2-Run / 3-Run / Grand Slam
- **RBI:** 2, 3, or 4 respectively.

#### 10.3 RBI Single
- **Notation:** Single notation with run scoring mark on basepath
- RBI counted per run scored that batter's hit drove in.

#### 10.4 Bases-Loaded Walk = RBI
- BB notation; one run forced in; RBI credited.

#### 10.5 Bases-Loaded HBP = RBI
- Same — forced run = RBI.

#### 10.6 Sacrifice Fly RBI
- SF notation; RBI credited.

#### 10.7 Run Scores on Error — NO RBI
**Situation:** Runner scores due to error.
- Run counts but no RBI credited to batter unless the run would have scored regardless of the error (scorer judgment).

#### 10.8 Run Scores on Wild Pitch / Passed Ball — NO RBI
- No RBI for batter.

#### 10.9 Run Scores on Balk — NO RBI
- No RBI; pitcher charged.

#### 10.10 Run Scores on Double Play — RBI Awarded
- If runner from 3B scores on ground ball DP and batter wasn't going to be retired for the run-scoring play, RBI is credited. **EXCEPTION:** NO RBI if batter grounds into DP with runner on 3B and run scores (scorer judgment).

#### 10.11 Earned vs Unearned Runs
- **Earned:** Pitcher responsible (hits, walks, normal play).
- **Unearned:** Run scored due to error, passed ball, or extension of inning by error.
- App must reconstruct inning with errors removed to determine earned status.

#### 10.12 Runner Inherited (Pitching Change)
**Situation:** New pitcher enters with runners on base.
- If those runners score, runs are charged to PRIOR pitcher.
- App must track inherited runners.

---

### CATEGORY 11: SUBSTITUTIONS — NFHS SPECIFIC

#### 11.1 Pinch Hitter
**Situation:** Coach replaces batter before AB completes.
- **Notation:** PH plus new player name; original player crossed out
- **PH inherits the count from the previous batter.** Example: if the original batter was at 2-1 when removed, the PH starts at 2-1.

#### 11.2 Pinch Runner
**Situation:** Coach replaces baserunner with a substitute.
- **Notation:** PR plus new player name
- Replaced player charged with any subsequent stats relating to that base position only up to substitution point.

#### 11.3 Courtesy Runner for Pitcher
**Situation:** **[NFHS]** A non-starter may run for the pitcher (only the pitcher) to keep him fresh.
- **Notation:** CR plus name
- The courtesy runner does NOT count as a substitution. Player may return to original spot.
- Same courtesy runner cannot run for both P and C in same inning.

#### 11.4 Courtesy Runner for Catcher
**Situation:** **[NFHS]** Same as above but for catcher.
- **Notation:** CR plus name
- Used to speed up game (catcher gears, fatigue).

#### 11.5 Defensive Substitution
**Situation:** Coach swaps a fielder mid-inning.
- **Notation:** New player listed in next defensive half-inning.

#### 11.6 Starter Re-entry
**Situation:** **[NFHS 3-1-2]** A starter who has been removed may re-enter ONE TIME, returning to their original spot in the batting order.
- A removed pitcher MAY return to pitch later in the game subject to the conditions in 8.6 (faced ≥ 1 batter, no 4th charged conference, re-entry not yet used, once per inning, state pitch-count rules, P/DH carve-out).

#### 11.7 DH Enters Defense
**Situation:** **[NFHS]** Designated Hitter takes a defensive position.
- DH role is terminated for remainder of game. The player whose at-bats had been replaced by the DH is also removed (unless they were one and the same — see 11.8).
- Note: Under the Modified DH / Flex rule sometimes used, the DH may hit for any one defensive player. App should support both classic DH and Flex.

#### 11.8 P/DH (Pitcher Hits for Himself)
**Situation:** **[NFHS]** Pitcher serves as his own DH (i.e., bats and pitches).
- Listed once in lineup. If P is removed from mound, he can remain in game at another position or as DH.

#### 11.9 Batting Out of Order
**Situation:** Wrong batter comes to plate.
- If detected DURING AB: proper batter takes count; no penalty.
- If detected AFTER AB completes but BEFORE next pitch: proper batter is out; improper batter's results nullified.
- **Notation:** OOO (out of order) with appropriate adjustments.

---

### CATEGORY 12: SPECIAL SITUATIONS

#### 12.1 Walk-Off Win
- Game ends when winning run scores in bottom of last inning.
- Trailing runners need not score.

#### 12.2 Mercy Rule (10-Run Rule)
**Situation:** **[NFHS]** Most state associations adopt a mercy rule: game ends if a team leads by 10+ runs after 5 innings (or 4½ if home team leads).
- App should support: game-ending logic per state config.

#### 12.3 Mercy Rule (15-Run Variant)
- Some states use 15 runs after 3 innings as an additional trigger.

#### 12.4 Extra Innings — Standard
**Situation:** Game tied after 7 regulation innings.
- Play continues full innings until winner determined.

#### 12.5 Extra Innings — Tiebreaker Rule
**Situation:** **[NFHS]** Some states/tournaments use a tiebreaker: extra innings begin with a runner on 2B.
- App should support optional ITB (international tiebreaker) configuration.

#### 12.6 Suspended Game
**Situation:** Game halted (weather, darkness, curfew) and to be resumed later.
- App must persist game state and allow resumption.

#### 12.7 Forfeit
**Situation:** One team unable/unwilling to continue.
- Score recorded as 7-0 (regulation) or actual if leader was ahead at time of forfeit.

#### 12.8 Rain Delay / Suspension Mid-Inning
- App should pause clock/stat-entry; preserve count, base state, lineup.

#### 12.9 Game Called Early (Weather)
**Situation:** Game called after 4½ or 5 innings due to weather.
- **[NFHS]** Regulation game = 5 innings (4½ if home team leading). Stats count.

#### 12.10 Forfeited Game with Pitching Records
- Individual stats may still count even if team result is a forfeit.

#### 12.11 Continuous Batting Order
**Situation:** Some HS games (esp. JV/freshman) use a continuous lineup where all players bat in rotation.
- App should support variable batting order length (9 to 20+ players).

---

### CATEGORY 13: INTERFERENCE AND OBSTRUCTION

#### 13.1 Batter Interference with Catcher
**Situation:** Batter steps out of box and interferes with catcher's throw.
- **Notation:** INT (batter)
- Batter out; runner returns to original base.

#### 13.2 Offensive Interference by Runner
**Situation:** Runner interferes with fielder making a play.
- **Notation:** INT (runner)
- Runner out; ball dead.

#### 13.3 Defensive Interference (Catcher's Interference)
- See 5.5.

#### 13.4 Spectator Interference
**Situation:** Fan reaches over wall or onto field.
- Umpire judges what would have happened; awards bases accordingly.

#### 13.5 Obstruction Type A (Play Being Made on Runner)
**Situation:** Fielder without ball obstructs runner DURING a play on that runner.
- Ball dead immediately; runner awarded base they would have made.

#### 13.6 Obstruction Type B (No Play Being Made)
**Situation:** Obstruction occurs when no play is being made on the obstructed runner.
- Ball remains live; if runner is put out, umpire may award the base.

#### 13.7 Coach's Interference
**Situation:** Coach physically assists runner.
- Runner out.

#### 13.8 Ball Hits Umpire
**Situation:** Batted ball strikes umpire in fair territory.
- If umpire is BEHIND infielders, ball is alive. If in front of fielders, ball is dead and treated as a hit.

#### 13.9 Ball Lodged in Equipment / Fence
**Situation:** Ball stuck in fence, glove, equipment.
- Time called; runners awarded bases.

---

### CATEGORY 14: SPECIALTY OFFENSIVE PLAYS

#### 14.1 Hit-and-Run
**Situation:** Runner breaks with pitch; batter must swing or protect runner.
- Tracked via runner movement timing.

#### 14.2 Run-and-Hit
**Situation:** Runner breaks with pitch; batter swings only if pitch is hittable.

#### 14.3 Suicide Squeeze
**Situation:** Runner from 3B breaks with pitch; batter MUST get bunt down.
- If bunted: typically SH credited; runner scores.
- If missed: runner usually out at home easily.

#### 14.4 Safety Squeeze
**Situation:** Runner from 3B waits for bunt to be put down before breaking.
- Similar scoring to suicide squeeze.

#### 14.5 Slash Bunt (Bunt-and-Slash)
**Situation:** Batter shows bunt, pulls back, swings away.
- Standard hit notation if successful.

#### 14.6 Fake Bunt
**Situation:** Batter shows bunt to draw fielders in; pulls back.
- No scoring impact unless leads to walk/hit later.

---

### CATEGORY 15: APPEAL PLAYS

#### 15.1 Missed Base Appeal
**Situation:** Defense suspects runner missed a base.
- After play ends, ball is thrown to that base; fielder steps on bag and umpire signals.
- Runner is out if appeal upheld.

#### 15.2 Leaving Early on Caught Fly (See 6.24)

#### 15.3 Batting Out of Order Appeal (See 11.9)

#### 15.4 Time of Appeal
**Situation:** **[NFHS]** Appeals must be made before next pitch, or before pitcher and all infielders leave fair territory at end of inning.

---

### CATEGORY 16: PITCH-LEVEL EVENTS (Used in Pitch-by-Pitch Tracking)

#### 16.1 Ball
- Pitch outside strike zone, not swung at.

#### 16.2 Called Strike
- Pitch in strike zone, not swung at.

#### 16.3 Swinging Strike
- Pitch swung at and missed.

#### 16.4 Foul Ball (Not Strike 3)
- Pitch fouled off with fewer than 2 strikes; count goes to 2 strikes max.

#### 16.5 Foul with Two Strikes
- Count stays the same; AB continues.

#### 16.6 Foul Tip Caught (See 1.3)
- Counts as a swinging strike; if strike 3, batter out.

#### 16.7 Foul Bunt with Two Strikes (See 1.4)
- Automatic strikeout.

#### 16.8 Pitch in Dirt — No Advance
- Charged as a ball if outside zone.

#### 16.9 Pitchout
- Intentional ball thrown wide; catcher in position to throw out steal.

#### 16.10 Intentional Ball (NFHS One-Pitch IBB)
- See 5.2.

#### 16.11 Ball Hits Batter Out of Box
- HBP not awarded; ball is dead.

#### 16.12 Check Swing — Called Strike
- Umpire judges batter offered at the pitch.

#### 16.13 Check Swing — Ball
- Umpire judges no offer; called per location.

---

### CATEGORY 17: PITCH COUNT AND PITCHER USAGE

#### 17.1 Daily Pitch Limit Reached
- App must alert when threshold approached.

#### 17.2 Required Days Rest Tier Crossed
- App must compute required rest based on state's tier system.

#### 17.3 Pitcher Used in Multiple Games Same Day
- **[NFHS]** Generally not allowed if pitch count exceeds certain threshold (varies by state).

#### 17.4 Pitcher Returns to Mound After Position Change
- **[NFHS 3-1-2]** A starting pitcher who was removed from the mound and stayed in the game at another defensive position MAY return to pitch — but only **once per inning** (cannot swap mound→position→mound twice in the same inning), and only if their starter re-entry is not yet used. State pitch-count rules may independently bar return. P/DH carve-out applies: a P/DH relieved on the mound may NOT return to pitch.

#### 17.5 Pitcher Used as Position Player Then Comes In To Pitch
- Allowed if not already removed from pitching position earlier.

---

### CATEGORY 18: UNUSUAL / EDGE CASES

#### 18.1 Two Players Occupying Same Base
- Lead runner entitled to base; trailing runner can be tagged out.

#### 18.2 Runner Touching Batter's Box / Home Plate Out of Order
- No automatic out; play continues unless interference.

#### 18.3 Ball Wedged in Catcher's Mask or Gear
- Dead ball; runners awarded one base.

#### 18.4 Fly Ball Deflected into Stands by Fielder
- Awarded bases (typically 2 from time of pitch).

#### 18.5 Ball Strikes Baserunner (Fair Ball, Past Infielder)
- Runner NOT out if ball passed infielder; play continues.

#### 18.6 Ball Strikes Baserunner (Before Passing Infielder)
- Runner out; batter credited with single (see 5.10).

#### 18.7 Batter Hit by Own Batted Ball in Foul Territory
- Foul ball; no out.

#### 18.8 Batter Hit by Own Batted Ball in Fair Territory
- Batter out; ball dead.

#### 18.9 Batter Throws Bat and It Hits Ball in Play
- Possible interference; umpire judgment.

#### 18.10 Bat Breaks; Fragment Interferes with Play
- Generally play continues; no interference unless ruled.

#### 18.11 Player Catches Ball with Cap or Detached Glove
- Runners awarded 3 bases (cap on batted ball); illegal catch.

#### 18.12 Pitcher Drops Ball While on Rubber (with Runners)
- Balk.

#### 18.13 Foul Bunt Caught by Catcher with 2 Strikes
- Out (caught foul, not a foul-bunt-strikeout); same out either way.

#### 18.14 Ball Goes Through Fielder's Legs to Outfield
- Hit or error per scorer judgment.

#### 18.15 Ground Ball Hits Base
- Live ball; batter credited with hit if reaches safely.

#### 18.16 Time Called During Pitch Delivery
- Pitch nullified.

#### 18.17 Substitution Announced but Player Doesn't Enter
- Once announced, sub is in the game.

---

### CATEGORY 19: GAME STATE TRANSITIONS APP MUST HANDLE

#### 19.1 End of Half-Inning
- 3 outs OR mercy-rule trigger OR walk-off.

#### 19.2 Inning Change (Top → Bottom)
- New defensive team takes field; new batting team starts at top of order (continuing from where left off).

#### 19.3 Pinch Hit Mid AB Not Allowed
- A PH cannot enter mid-AB except in cases of injury.

#### 19.4 Re-entry Bookkeeping
- App must track which starters have used their re-entry.

#### 19.5 Lineup Card Submission
- App should produce lineup card for umpire pre-game.

#### 19.6 Pre-Game Substitutions
- Coaches may make changes before first pitch without using re-entry rules.

---

## APPENDIX A: TYPICAL BOX SCORE FIELDS

**For each batter:**
AB, R, H, RBI, BB, K, 2B, 3B, HR, SB, CS, HBP, SF, SH, GIDP, LOB, AVG, OBP, SLG

**For each pitcher:**
IP, H, R, ER, BB, K, HR allowed, HBP, WP, BK, BF (batters faced), Pitches, Strikes, W/L/S/H/BS

**For each fielder:**
PO, A, E, DP, PB (catcher), TC (total chances), FLD%

---

## APPENDIX B: NFHS-SPECIFIC RULES SUMMARY

1. **Regulation game:** 7 innings (5 for run rule completion).
2. **Pitch count limits and rest requirements:** state-specific under NFHS Rule 6-2-6.
3. **Courtesy runners** allowed for pitcher and catcher only.
4. **Starter re-entry:** Once, to original batting position. Starting pitcher MAY return to pitch later in the game (NFHS 3-1-2), subject to: faced ≥ 1 batter, no 4th charged conference, re-entry not yet used, once-per-inning limit, state pitch-count rules, and the P/DH carve-out. See 8.6 for the full condition list.
5. **Intentional walk:** may be awarded without throwing pitches (since 2018).
6. **Mercy rule:** state-adopted; commonly 10 runs after 5 innings.
7. **Bat regulations:** USABat / BBCOR with NOCSAE certification required for varsity.
8. **DH/Flex rules** apply; P/DH allowed.
9. **Tiebreaker rule** (runner on 2B in extras): state/tournament optional.
10. **Foul bunt with 2 strikes** = automatic strikeout.
