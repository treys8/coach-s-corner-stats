# Statly Live-Scoring Engine: Baseball Rule Reference

**Scope:** US high school baseball under NFHS rules; MLB Official Baseball Rules (OBR) and MLB Official Scoring Rules cited where they govern statistics or where NFHS is silent/aligned. Differences flagged inline.

**Citation conventions:**
- **OBR x.xx** = MLB Official Baseball Rules (playing rules, 2024 edition)
- **OSR 9.xx** = MLB Official Scoring Rules (Rule 9 of OBR)
- **NFHS x-x-x** = NFHS Baseball Rules Book

**Compiled:** 2026-05-13 from authoritative sources (see Sources at bottom).

---

## 1. Infield Fly Rule

### Conditions (all must be true)
- **OBR Definition of Terms; NFHS 2-19.** Batted ball must be a **fair fly** (a line drive and an attempted bunt are explicitly excluded).
- Must be **catchable by an infielder with ordinary effort.** Pitcher, catcher, and any outfielder who has positioned themselves in the infield on the play count as "infielders" for this rule.
- **Runners on 1st & 2nd, OR bases loaded** (i.e., the trailing forced runner is on 1st).
- **Fewer than 2 outs.**

### Umpire judgment (engine implication)
- "Ordinary effort" is purely an umpire judgment call. The scoring engine cannot infer infield fly from the batted-ball flight alone. **The umpire's call is the authoritative input** — the engine must accept it as an explicit user-entered event ("Infield Fly called" toggle), not compute it.
- Engine should auto-suggest the call when the precondition (runners + outs) is satisfied and the batted-ball type is "popup/fly to infield," but require coach confirmation.

### Consequences
- **Batter is out immediately upon the call**, whether the ball is caught or not.
- **The ball remains live.** Runners may advance at their own risk.
- **Force is removed** on all runners the instant the batter is declared out (because the batter-runner no longer exists as a forced advance). Therefore:
  - If the ball is caught → tag-up rules apply (runners must retouch before advancing).
  - If the ball is dropped → runners need NOT tag up, but they are not forced; defense must tag them.
- If the ball lands near a foul line, the umpire calls "Infield fly, **if fair**." If it lands foul and is not caught, it is a foul ball (no out, no call).
- An infielder who **intentionally** drops a fair fly or line drive with a runner on 1st (and <2 outs) is governed separately by **OBR 5.09(a)(12)** — batter is out, ball is dead, runners return. This is a different rule from infield fly; engine should treat as a distinct event.

---

## 2. Dropped (Uncaught) Third Strike

### When the batter may run (OBR 5.05(a)(2); NFHS 8-1-1b)
The batter becomes a runner on a third strike not legally caught by the catcher when **either**:
1. **First base is unoccupied at time of pitch**, OR
2. **There are 2 outs** (regardless of whether 1B is occupied).

A pitch that touches the dirt before reaching the catcher is **not** a legal catch.

### Statistical effects
- **Strikeout is still recorded** on the pitcher and the batter regardless of outcome (OSR 9.15).
- If the batter is put out at 1B (or otherwise retired before reaching 1B), it is **a strikeout AND an out**, but only one out is recorded on the play (the K-putout combined). The putout is credited to the fielder who recorded it (typically 1B); the assist to the catcher; the strikeout to the pitcher.
- If the batter reaches 1B safely on the dropped third strike, the K is still charged, **no hit is awarded**, and the catcher is charged with a **passed ball** (if ordinary effort would have caught it) or pitcher with a **wild pitch** (if the pitch was uncatchable/in the dirt) — OSR 9.13.
- Counts as an AB.

### Abandonment / "leaves the dirt circle"
- **MLB (OBR 5.09(b)(2) Comment):** Batter who doesn't realize the situation and leaves the dirt circle around home plate without attempting to run is declared out.
- **NFHS (8-4-1i):** Stricter — batter is out immediately upon **entering the dugout/dead-ball area**, but is given more leeway than MLB before that (the dirt-circle rule is not used; engine should look for "entered dugout" event).

### NFHS-specific double first base (effective 2027 per NFHS Rule 1-2-9)
- The batter-runner on a dropped 3rd strike uses the **white** (fair-territory) portion of 1B if the play pulls a fielder into foul territory. Otherwise uses the **colored** (foul-territory) portion. Engine doesn't need to track which base was touched; it's an umpire's call.

---

## 3. Sacrifice Fly (SF) — Official Scoring Rule 9.08(d)

### Conditions to credit a SF
All of these must be true:
1. **Before two outs.** (SF cannot be credited with 2 outs at time of pitch.)
2. Batter hits a **fly ball (or line drive) handled by an outfielder, OR by an infielder running in the outfield**, in fair OR foul territory.
3. The ball is **caught** AND a runner scores after the catch (tags up), **OR** the ball is dropped for an error but in the official scorer's judgment the runner would have scored had it been caught.
4. **A run must actually score.** Without a run scoring on the play, it is not a SF (regardless of which base the lead runner advances from).

### Can SF be credited if R2 (not R3) scores?
**Yes.** OSR 9.08(d) does not specify which base the scoring runner must come from. If R2 tags and scores all the way home on a deep fly out, the batter is credited with the SF and an RBI. Runs from any base can qualify; this is rare but legal.

### Can SF be credited if a runner other than the scoring runner is put out on the play?
**Yes.** As long as a run scores on the play, the SF stands.

### Stat effects
- **Not charged as an AB.**
- **Counts as a plate appearance.**
- **Does NOT count toward batting average.** (Numerator: hits; denominator: AB. SF is excluded from AB.)
- **Counts AGAINST on-base percentage** — OBP denominator includes SF. (Historically a controversial choice; do not exclude SF from OBP.) Formula: (H + BB + HBP) / (AB + BB + HBP + SF). SH (sac bunt) is NOT in OBP denominator.
- **RBI credited** (one RBI per run that scores, assuming no batting-team interference; OSR 9.04).

### Pop fly to an infielder caught for the third out where a runner scored on a tag from third
- This is a "timing play" (see §5), not an SF. Engine still credits SF if the ball was handled by an infielder running in the outfield; if caught by a true infielder in the infield, it is NOT an SF — it is a flyout with a run scored on a timing play.

---

## 4. Sacrifice Bunt / Sacrifice Hit (SH) — OSR 9.08(a)–(c)

### When credited (9.08(a))
- Batter bunts and **advances one or more runners** with a bunt, AND is put out at 1B **OR would have been but for a fielding error**.
- **Before two outs.** SH cannot be credited with 2 outs (the batter is sacrificing his AB to give up an out for advancement; with 2 outs there is no advancement benefit and the AB itself is the third out).
- Scorer must judge the batter was NOT bunting purely for a base hit. Benefit of the doubt goes to the batter (i.e., default to SH when intent is ambiguous).

### When NOT a SH — score as something else
- **Bunt single:** batter reaches safely AND was bunting for a hit (judgment).
- **Fielder's choice:** bunt where a runner (other than batter) is put out at the advance base — OSR 9.08(b): "The official scorer shall not score a sacrifice bunt when any runner is put out attempting to advance one base on the bunt."
- **No advancement attempt by runner:** if no runner advances and the batter reaches on what would otherwise be a sacrifice attempt, score as a hit, error, or FC as appropriate.
- **Bunt with 2 outs:** charge AB.

### Stat effects
- **Not charged as an AB.**
- **Counts as a plate appearance.**
- **Does NOT count toward batting average.**
- **NOT in OBP denominator** (this differs from SF — important).
- **RBI credit:** A SH that scores a run from 3B does earn an RBI **except** when the SH happens with the bases loaded and forces the run home; check OSR 9.04(b) — a bunted ball that becomes a fielder's choice DP that allows a run does not credit an RBI. In general, a clean sac bunt that scores a run from 3B = RBI.

### Squeeze plays
- Successful squeeze (run scores, batter out at 1B) = SH + RBI. With 2 outs it's not a SH (just a bunt for a hit or FC).

---

## 5. Runs Scoring on the Third Out — OBR 5.08(a)

### General rule (OBR 5.08(a))
> One run shall be scored each time a runner legally advances to and touches first, second, third and home base **before three men are put out** to end the inning.
>
> **EXCEPTION:** A run is not scored if the runner advances to home base during a play in which the third out is made:
> (1) by the **batter-runner before he touches first base**;
> (2) by **any runner being forced out**;
> (3) by a **preceding runner who is declared out because he failed to touch one of the bases**.

### Case (a): Third out is a force play
- **No run scores**, even if the runner crossed the plate before the force-out occurred. Force outs are NOT timing plays.
- *Example:* Bases loaded, 2 outs. Batter hits a grounder. R3 scores; defense throws to 2B for a force on R1 for the third out. **No run.**

### Case (b): Third out is a tag on a runner who hadn't yet scored (non-force, trailing runner)
- **This IS a timing play.**
- If the runner from 3B crossed home **before** the third-out tag → **run counts**.
- If the runner from 3B crossed home **after** the third-out tag → **run does not count**.
- *Example:* R1 & R3, 2 outs. Batter doubles. R3 scores; R1 is thrown out at home (tag, not force). If R3 touched home before R1 was tagged, run scores.
- **Engine implication:** This is the headline case where we MUST ask the coach to confirm sequencing ("Did R3 touch home before or after the tag?"). Default to "before" (run counts) only if the scoring runner was clearly well ahead; otherwise prompt.

### Case (c): Timing play summary
A "timing play" exists whenever the third out is NOT one of the three exceptions in 5.08(a) — specifically, it's a non-force tag of a trail runner, OR a non-force out anywhere that isn't on the batter-runner before 1B. In timing plays, **the sequence of "touched home" vs. "third out recorded" decides.**

### Case (d): Reverse-force double play
- A **reverse force** occurs when a runner who was originally forced is no longer forced because a preceding (trailing in advance order) out removed the force, and the runner is then tagged out.
- *Example:* R1, 1 out. Grounder to 1B; 1B steps on 1B (batter-runner out — this **removes** the force on R1 going to 2B). The throw then tags R1 between 1B and 2B. R1 is tagged out, NOT forced. This is a reverse force.
- **For run-scoring:** because the third out (R1 being tagged) is **not a force out**, it is a timing play. If R3 had crossed the plate before R1 was tagged, the run scores. However, OSR 9.04(b) denies the **RBI** on a reverse-force DP.

### Stat effects on RBI
- OSR 9.04(b)(1): **No RBI** is credited when the batter grounds into a **force DP** OR a **reverse-force DP**, even if a run scores.
- This is independent of whether the run itself counts. A run can score on a reverse-force DP (timing play), but the batter gets no RBI.

### Fourth-out / appeal on the third out
- If the fielders, after recording the apparent third out, then **appeal and record a different out** that would deny a run (e.g., the runner who scored missed 3B), the appeal **supersedes** the apparent third out. The run is wiped out.
- The defense must make the appeal **before all fielders leave fair territory**.

---

## 6. Force Play — OBR Definitions

### Definition
> A FORCE PLAY is a play in which a runner legally loses the right to occupy a base by reason of the batter becoming a runner.

### When a runner is forced
- The batter becoming a runner forces a runner on 1B to vacate. If 2B is then occupied, the runner on 2B is forced. If 3B is then occupied, the runner on 3B is forced.
- A runner is forced **only when there is a runner on every base behind him AND the batter has just become a runner** (or the immediate downstream chain has continued).
- **A caught fly ball never creates a force.** Once the fly is caught, the batter is out and is no longer "becoming a runner"; therefore runners are not forced (they must tag up; see §9).

### How to record a force out
- Touch the base before the forced runner arrives, OR tag the runner before he reaches the base.

### Removal of the force
- When **any forced runner ahead of the play is put out by a means other than the force** OR when **a trailing forced runner is put out first**, the force is removed for the runner(s) behind that out.
- *Example:* R1, 0 outs. Grounder. Defense gets the batter-runner at 1B first. The force on R1 going to 2B is now removed; R1 must be **tagged** to be put out.

### Double plays
- **Force-force DP:** both outs are forces. No run can score on this DP (5.08(a)(2)).
- **Force then tag (reverse force):** first out is a force, second is a tag of a runner whose force was removed by the first out. Run-scoring is governed by timing (see §5(d)).
- **Tag then force:** the trailing runner is tagged, then a force play elsewhere completes the DP. Run-scoring is governed by timing.

---

## 7. Fielder's Choice (FC) — OSR 9.05(b), 9.06

### Definition (OBR Definitions)
A play by a fielder who handles a fair grounder and, instead of throwing to 1B to retire the batter-runner, throws to another base in an attempt to retire a preceding runner.

### Hit vs. FC (OSR 9.05)
- **Credit a hit** when: the fielder attempts to retire a preceding runner unsuccessfully AND in the scorer's judgment the batter-runner **would not have been retired at 1B with ordinary effort**.
- **Charge an AB with no hit (FC)** when: the fielder attempts to retire a preceding runner unsuccessfully AND in the scorer's judgment the batter-runner **could have been retired at 1B with ordinary effort**.
- If the preceding runner IS retired, the batter-runner reaches on a **fielder's choice** (no hit), AB charged.
- A batter who reaches on a clear error (no other runner retired) is NOT a FC; it is an "error" — AB charged, no hit.

### Stat effects
- **FC is an AB.**
- **No hit.**
- **No RBI** unless the run scores on a play where no one is put out, OR on an error that allows a runner from 3B to score (subject to OSR 9.04 nuances).
- **Counts against batting average** (denominator AB, numerator excludes the hit).

### Engine implication
- When the batter reaches and at least one other runner is put out on the play, the engine should default to FC and prompt coach to override to "hit + error" or "hit" if the scorer judges the batter-runner couldn't have been gotten with ordinary effort.

---

## 8. Catcher's Interference (CI) — OBR 6.01(c), 6.01(g); NFHS 8-1-1e

### Standard CI (OBR 6.01(c))
- Catcher contacts the bat with mitt/body during the swing (most common), OR positions himself so as to interfere with the batter's swing.
- **Penalty:** Ball is delayed-dead. Batter is awarded 1B. Runners advance only if forced by the batter's award. Other runners stay unless they were stealing — runners attempting to steal at the time of the interference are awarded the base they were going to.

### Manager's option (OBR 6.01(c))
- If the play continues and the batter reaches 1B safely AND all other runners advance at least one base on the play, the interference is **ignored** and the play stands. The offensive manager may also elect to take the play instead of the penalty (e.g., if the batter doubled).

### CI on a squeeze or steal of home (OBR 6.01(g)) — special, severe penalty
- Catcher (or any fielder) steps on/in front of home without the ball, or touches the batter/bat, while R3 is attempting to score.
- **Penalty:** Balk on the pitcher + batter awarded 1B. **All runners advance one base** (because the balk runs alongside the CI award).

### NFHS variation (8-1-1e, "catcher's obstruction")
- NFHS calls it **catcher's obstruction**, not interference. Mechanically the same.
- **Offense's option:** Coach/captain may **decline** the obstruction penalty and accept the play instead. Election must be made before the next pitch, before an IBB, or before infielders leave the diamond.
- Automatically ignored if the batter-runner reaches 1B and all other runners advance at least one base.

### Stat effects
- **Not an AB.**
- **Counts as a plate appearance.**
- **NOT in OBP denominator** (CI is excluded from both AB and OBP denominator — small but real edge case).
- Catcher is charged with an **error** (OSR 9.12(a)(7)). Pitcher is NOT charged with anything in standard CI; on the 6.01(g) squeeze variant, pitcher is charged with a **balk** but the run that scores is unearned to the pitcher only if it would not have scored without the CI/error chain (apply 9.16 reconstruction).
- **No RBI** to the batter unless a run is forced home by the award (bases loaded CI scores R3 — RBI is given in this case per OSR 9.04(a) when bases are loaded and CI forces the run).

---

## 9. Tag-Up Rules — OBR 5.09(c)(1); 5.06

### Rule
- On a caught fly ball (or line drive caught), a runner who left his base before the catch must **retouch** (tag up) his base after the ball is first touched by the fielder. He may then advance at his own risk.
- The ball remains live; runners may advance after tagging.
- Failure to retouch is an **appeal play** — the defense must tag the runner or his base with the ball, and verbally appeal, before the next pitch or play.
- **"Retouch" timing (OBR 5.09(c)(1) comment):** A runner may leave his base the instant the ball is **first touched** by the fielder, even if the catch is not yet secure. He doesn't have to wait for the catch to be controlled.

### UI implication for the scoring engine
- Engine needs to ask "did the runner tag up?" **only when** the runner advanced on a caught fly (i.e., result = caught fly AND runner ended up on a different base than they started). Default to "yes tagged" since the umpire is the authority on illegal departure (it's an appeal play and rarely called).
- For "caught fly + runner did not advance," no tag-up question is needed.
- For "uncaught fly / hit," no tag-up question.

### Special cases
- **Infield fly:** if caught, normal tag-up applies. If dropped, runners need not tag (the ball never settled into a catch).
- **Foul fly caught:** same tag-up rules apply; runners may advance from foul flies after retouching.

---

## 10. Obstruction vs. Interference — OBR 6.01

### Interference (offensive)
- An act by the **offense** that hinders the defense from making a play.
- Examples: runner running outside the basepath to break up a play, batter stepping on home and contacting the catcher, batted ball touching a runner before passing a fielder.
- **Penalty:** Ball is dead; offending runner (or batter) is out; other runners return to their last legally-occupied base at the time of the interference. On batted ball touching runner: batter is awarded 1B and credited with a hit if no other runner is retired (OSR 9.05(a)(7)).

### Obstruction (defensive) — OBR 6.01(h)
- An act by a fielder who, **while not in possession of the ball and not in the act of fielding the ball**, impedes the progress of a runner.
- The fielder gets the right of way only when fielding a batted ball or when in actual possession of the ball.

### Two types of obstruction
- **Type 1 / Type A (OBR 6.01(h)(1)):** Obstruction occurs **while a play is being made on the obstructed runner**. Ball is **immediately dead** at the moment of obstruction. Obstructed runner is awarded at least one base beyond his last legally-touched base. Other runners advance to bases they would have reached but for the obstruction.
- **Type 2 / Type B (OBR 6.01(h)(2)):** Obstruction occurs when **no play is being made on the obstructed runner**. Umpire signals obstruction but lets play continue. After play ends, the umpire awards bases to the obstructed runner (and any other affected runners) to nullify the obstruction. If the obstructed runner advances beyond the base he would have been awarded, the obstruction is ignored.

### Stat effects
- Obstruction is **not charged as an error** (OSR 9.12(a) explicitly excludes obstruction from errors).
- Interference outcomes generally do not result in errors either (unless an actual fielding mistake also occurred).

### NFHS notes
- NFHS uses "obstruction" the same way. NFHS also uses "obstruction" instead of "interference" for the catcher's-interference case (see §8).

---

## 11. Ground-Rule Double / Bounding Ball Out of Play — OBR 5.05(a)(6)–(9), 5.06(b)(4)

### Bounding ball over/through fence or stuck (OBR 5.05(a)(7), (a)(8))
- Batter is awarded **2 bases**.
- **All runners advance 2 bases from their position at time of pitch**, not from where they were at the time the ball went out.
- Note: this means a runner from 1B is awarded 3B (not home), even if he had already rounded 2B before the ball went out.

### Spectator interference reaching into the field on a fly/bounding ball (OBR 6.01(e))
- Ball is dead at the moment of interference.
- Umpire places runners where, in his judgment, they would have been without the interference (this can differ from a flat "2 bases" award).

### Thrown ball out of play (OBR 5.06(b)(4)(G), (H))
- First throw by an infielder going to the stands: **2 bases from time of pitch**.
- All subsequent throws to the stands: **2 bases from the runner's position at the time of the throw**.
- A throw by the pitcher from the rubber going out of play: **1 base** (different award — pitcher's throw from the pitching plate is treated as a balk-style award).

### Stat effects
- A ground-rule double is a **2B hit** for the batter (1 AB, 1 hit, 1 2B). RBI are credited per OSR 9.04 — but a run that scores from 2B is only credited as RBI if the runner would have scored anyway in the scorer's judgment (the rule does NOT automatically deny the RBI just because the ball went out; the OSR 9.04 reconstruction asks whether the runner would have scored).

### Cap at home?
- Yes, a runner cannot be awarded past home. A runner who has already scored before the ground rule is invoked is unaffected (the run stands once he touched home before the ball went out — for live-ball calls). For automatic-double awards, all runners are positioned by the 2-bases-from-time-of-pitch rule, and a runner from 2B advances to home (scores).

---

## 12. NFHS-Specific High-School Rules

### 12.1 Courtesy Runner — NFHS 3-1-3 (state-adopted)

- **Eligibility:** Courtesy runner (CR) may be used for the **pitcher of record OR the catcher of record** at any time. Many states have adopted this rule; it is not OBR.
- **Who may be a CR:** Any player **not in the lineup** (substitute who has not yet entered). With state adoption, a starter who has been replaced and re-entered is a player-of-record and is **not** a CR candidate while in the game.
- **Repeat use:** Same individual may **not** courtesy-run for both pitcher and catcher in the same game. A given player can only be courtesy-run-for once per inning in some state interpretations (check NFHS 3-1-3 + state).
- **CR stays out of the game:** A CR does not enter the game in any other capacity. If the CR is later used in another role (defense, pinch-hit), that's an **illegal substitute** unless an injury/ejection forces it.
- **Pitcher/catcher returns to base:** The pitcher/catcher whose place the CR took **remains the pitcher/catcher of record** and stays in the game and the batting order. The CR comes off the bases when the half-inning ends.
- **P/DH:** A pitcher who is also DH (P/DH combo, see 12.2) **cannot have a courtesy runner** — when batting, he is in the role of DH, and the DH does not get a courtesy runner.

### 12.2 Designated Hitter — NFHS 3-1-4 (revised 2020)

NFHS allows two distinct DH usages:

**(A) Conventional DH (10th-player DH):**
- DH is listed as the 10th starter, hitting in place of one of the 9 defensive players. That defensive player does not bat.
- If the DH is substituted for offensively/runner-wise, the role of DH may continue with the substitute.
- If the player being hit for re-enters the lineup, the DH role is terminated.

**(B) P/DH or any-position/DH combo:**
- A starter at any defensive position may also serve as his own DH. He is essentially playing two roles (one defensive, one offensive). Only 9 names appear in the lineup.
- Most commonly used as **P/DH:** the pitcher remains in the game as a hitter even after being relieved from the mound; or, a starter can be removed defensively and stay in as a hitter.
- **Termination of DH role (in either usage):** If a substitute (or former substitute) for the defensive role subsequently participates **on offense**, OR the P/DH (or any-position/DH) is substituted for as either a hitter or a runner, the DH role is **terminated for the rest of the game.**

### 12.3 Mercy Rule / Run Rule — NFHS 4-2-2 (by state adoption)

- **NFHS default (state-adopted):** Game ends when, after **5 innings** (or 4½ if home team leads), one team is **10 or more runs behind**.
- **State variations are common.** Many states adopt additional thresholds:
  - 15 runs after 3 innings
  - 12 runs after 4 innings
  - 10 runs after 5 innings
- **Some states do not adopt any run rule** (e.g., for state-tournament play in certain states the rule is suspended).
- **Engine implication:** Make the mercy threshold configurable per school/league and per game type (regular season vs. playoff). Use a table of `{innings_threshold, run_diff_threshold}` rather than a single hardcoded value.

### 12.4 Pitch Count Rule — NFHS Pitching Restriction Policy (2017 onward)

- NFHS **requires** each state association to have a **pitch-count-based** restriction policy (not innings-based). Effective starting 2017 season.
- **Variability by state:** There is no single national NFHS number. Common patterns:
  - **Max pitches per game/day:** typically 100–120 (e.g., TX 110, many states 105 or 110).
  - **Tiered rest day requirements** based on pitches thrown that day. Typical tier example (Indiana, similar to many states):
    - 1–35 pitches: 0 days rest
    - 36–60: 1 day
    - 61–80: 2 days
    - 81–100: 3 days
    - 101–120 (if state allows): 4 days
- **Mid-batter rule:** A pitcher who reaches the daily max mid-batter is generally allowed to finish the current batter (state-specific — some states stop immediately).
- **Engine implication:** Pitch count by pitcher by date is a required tracked stat. Mercy and pitch-count thresholds should be state/league-configurable. Engine should warn when a pitcher approaches a threshold but not auto-remove him (that's the umpire/coach decision).

### 12.5 Re-Entry Rule — NFHS 3-1-3

- **Any starter** (including the pitcher) may leave the game and re-enter **once**, provided he returns to **the same spot in the batting order**.
- **Substitutes (non-starters) may NOT re-enter** once removed.
- A starter who re-enters and is then removed a second time is **done for the game**.
- **Pitcher-specific (NFHS 3-1-2, verified 2026-05-13):** A starting pitcher **MAY** return to pitch later in the same game. Conditions:
  - Must have faced at least one batter to be a pitcher-of-record (otherwise may play another position but never pitch in that game).
  - Cannot return if removed due to the **4th defensive charged conference** in a 7-inning game.
  - Cannot return if their **one starter re-entry** has already been used elsewhere in the game.
  - **Only once per inning** — cannot remove and return as pitcher twice in the same inning.
  - **State pitch-count rules may independently disqualify** the pitcher from returning (a pitcher who has reached state max for the day cannot return regardless of 3-1-2).
  - **P/DH carve-out:** A player who started as P/DH and was relieved on the mound may NOT return to pitch (may stay in the game only as DH).
- *Source:* NFHS Rule 3-1-2 (general re-entry plus pitcher-specific clause); confirmed against current NFHS rulebook references.

### 12.6 Force-Play Slide Rule — NFHS 8-4-2b

A runner on a **force play** must either:
- **Slide directly into the base** (within reach, with at least one leg and buttock on the ground if feet-first; head-first allowed if into the base), OR
- **Run in a direction away from the fielder** to clearly avoid making contact or altering the throw.

A slide is **illegal** if:
- The runner uses a rolling, cross-body, or pop-up slide INTO the fielder.
- The runner's raised leg is higher than the fielder's knee (when fielder is standing).
- The runner goes beyond the base (except home plate) and then makes contact with or alters the play of the fielder.
- The runner slashes/kicks the fielder.

**Penalty for illegal slide on a force play (NFHS 8-4-2b):**
- The runner is **out** (for interference).
- The **batter-runner is also called out** (the "auto double play" — even if the original force-DP attempt would not have succeeded).
- All other runners return to their bases at the time of the pitch.

Note: A runner is **never required to slide.** He may also choose to give himself up by peeling off; what is forbidden is illegally interfering with the fielder.

### 12.7 Other NFHS-Specific Items Worth Knowing
- **Bat regulations:** NFHS requires BBCOR-marked bats (-3) for varsity.
- **No fake-to-third / throw-to-first move:** Removed in 2013 (NFHS); also illegal in MLB since 2013. (Engine doesn't need to model.)

---

## 13. Earned Runs — OSR 9.16

### Definition
> An earned run is a run charged against a pitcher for which the pitcher is held accountable. The Official Scorer shall charge an earned run against a pitcher every time a runner reaches home base by the aid of safe hits, sacrifice bunts, a sacrifice fly, stolen bases, putouts, fielder's choices, bases on balls, hit batters, balks or wild pitches (including a wild pitch on a third strike that permits a batter to reach first base) **before fielding chances have been offered to put out the offensive team.**

### Unearned run triggers
- Run scores **only because of** an error, passed ball, or catcher's interference (NOT counted as an error for ER purposes but it is treated like an error in reconstruction for the affected pitcher — actually 9.16 explicitly excludes CI from errors for reconstruction; check the case carefully).
- The runner reached base on an error.
- The runner advanced because of an error/PB and would not have scored without it.
- An error extends an inning (would have been the third out) — any runs scoring after the would-be third out are unearned to the team and the pitcher.

### Reconstruct-the-inning rule (OSR 9.16(a))
> In determining earned runs, the Official Scorer shall reconstruct the inning without the errors and passed balls, giving the benefit of the doubt always to the pitcher in determining which bases would have been reached by runners had there been errorless play.

- **Errors are removed** from the imagined inning, but hits, walks, HBP, SB, etc. are kept as they happened (in the order they happened).
- If the reconstructed inning would have ended already (3 outs), all runs from that point onward are **unearned to the team**.
- **Catcher's interference:** specifically **excluded** from being treated as an error for reconstruction — a runner reaching on CI is treated like a player who reached on an error for the purposes of pitcher accountability, but the technicality is that no "error" is charged for CI alone. Practically: runs scoring solely because of CI are unearned to the pitcher.
- The scorer gives the **pitcher the benefit of the doubt** in every judgment call about what "would have happened" without errors.

### "Team earned" vs. "pitcher earned" (OSR 9.16(i))
- A run can be **unearned to the pitcher** but **earned to the team**, OR vice versa.
- *Example:* Reliever enters; reliever commits an error letting an inherited runner score. That run is charged to the prior pitcher (inherited runner) but the scoring was caused by the new pitcher's error — it's unearned to the original pitcher (because of the error) and unearned to the team (because of the error).
- *Example:* New pitcher enters mid-inning with 2 outs and an error already in the inning that should have been the third out. From the new pitcher's perspective, the "would-have-been-third-out" reconstruction starts over — earned runs are calculated separately for each pitcher.

### Responsible pitcher for inherited runners — OSR 9.16(g)
- > When a pitcher puts runners on base and is relieved, such pitcher shall be charged with all runs subsequently scored up to and including the number of runners such pitcher left on base when such pitcher left the game.
- **The runners aren't tracked individually — the COUNT of inherited runners is what's tracked.**
- *Example:* Pitcher A leaves with 2 runners on. Reliever B walks the first batter (bases loaded), then gives up a single that scores 2 runs. Pitcher A is charged with **both** runs (he left 2 runners on; the first 2 to score are charged to him), even though one of those who scored was actually one of B's walks. The accounting goes to the runners who reached base **earliest** in the inning.
- **Fielder's choice swap-out (OSR 9.16(h)):** When an inherited runner is put out on a fielder's choice and the batter takes his place on base, the new runner is still charged to the **previous** pitcher for purposes of inherited-runner accounting (the new pitcher hasn't put any "new" runners on; he just swapped them).

### Engine implications
- Earned-run determination requires reconstructing the inning AT END OF INNING (or whenever the half-inning closes). It is not a per-event calculation. The engine should:
  - Tag each event with `{caused_by_error: bool, caused_by_pb: bool, caused_by_ci: bool}`.
  - At end of half-inning, walk through events in order, simulating "errorless play" and identifying when the third out would have happened.
  - Assign earned/unearned per pitcher using the inherited-runner accounting (count, not identity).
- Provide a "scorer override" for ER on each run — this is the hardest scoring judgment in baseball, and coaches will want to confirm.

---

## 14. AB-Excluded Events (Complete List)

Per OSR 9.02 (and consistent with NFHS scoring practice — NFHS does not publish its own scoring rules; it follows OSR conventions):

| Event | AB? | PA? | In AVG denominator? | In OBP denominator? | RBI possible? |
|---|---|---|---|---|---|
| Single, double, triple, HR | Yes | Yes | Yes | Yes | Yes |
| Strikeout (any) | Yes | Yes | Yes | Yes | No |
| Groundout / flyout / lineout / popout | Yes | Yes | Yes | Yes | Yes (if run scores, with exceptions) |
| Fielder's choice (FC) | Yes | Yes | Yes | Yes | Sometimes (rare) |
| Reached on error (ROE) | Yes | Yes | Yes | Yes | Sometimes |
| **Walk (BB)** | **No** | Yes | No | **Yes** | Yes (bases loaded) |
| **Intentional walk (IBB)** | **No** | Yes | No | **Yes** | Yes (bases loaded) |
| **Hit by pitch (HBP)** | **No** | Yes | No | **Yes** | Yes (bases loaded) |
| **Sacrifice fly (SF)** | **No** | Yes | No | **Yes** (in OBP denominator) | Yes |
| **Sacrifice bunt / hit (SH)** | **No** | Yes | No | **No** (excluded from OBP) | Sometimes |
| **Catcher's interference (CI)** | **No** | Yes | No | **No** (excluded from OBP) | Sometimes (bases loaded) |
| **Defensive obstruction award** | **No** | Yes | No | **No** | Sometimes |

Notes:
- **PA (plate appearance)** = all of the above. PA - AB = the "exclusions."
- The classic AB-exclusion mnemonic is **"BB, HBP, SF, SH, CI"** but defensive-obstruction awards on batters (rare) also exclude AB.
- **Catcher's interference and SH are excluded from OBP denominator; SF is included.** This is a subtle but real edge case for the engine.

---

## 15. Wild Pitch vs. Passed Ball — OSR 9.13

### Wild Pitch (charged to pitcher)
- A pitch so **high, wide, or low** that the catcher cannot stop and control it **with ordinary effort**, allowing a runner (or the batter on a dropped 3rd strike) to advance.
- A pitch that **touches the ground (or home plate) before reaching the catcher** AND is not handled by the catcher AND allows a runner to advance → **always a wild pitch** (never a PB), regardless of how the catcher handled it.

### Passed Ball (charged to catcher)
- A legally pitched ball that the catcher **fails to hold or control with ordinary effort**, allowing a runner to advance.
- The ball was catchable with ordinary effort; the catcher's miss is the cause.

### Required for either: a runner must advance
- If no runner advances and no batter reaches on a dropped 3rd strike, **no WP/PB is recorded** — even if the catcher missed the ball.
- The ball getting away with no consequence is neither a WP nor a PB.

### On a dropped 3rd strike
- If the dropped 3rd strike allows the batter to reach 1B safely: score the **strikeout**, then charge **either** a WP (if uncatchable) or a PB (if catchable with ordinary effort). The batter does **not** get a hit. The pitcher does NOT get charged with allowing a hit, but the run (if scored later) may be earned or unearned depending on whether the WP/PB caused it.

### Stat effects
- **WP affects pitcher's ER calculation:** WP can lead to **earned runs**. (Note: WP is in the "earned run trigger" list in 9.16. It's NOT an error.)
- **PB does NOT lead to earned runs:** PB is treated like an error for purposes of reconstruction. Runs scoring because of a PB are unearned.
- Neither WP nor PB is an "error" in the stat sheet — they are their own categories (WP charged to P, PB charged to C).

### Engine implication
- When the catcher fails to handle a pitch AND a runner advances or batter reaches on K3, prompt: "Was this catchable with ordinary effort?" Default the prompt according to pitch location (in-zone or close → PB; in dirt → WP).

---

## Appendix: Engine Design Principles Derived from the Rules

1. **The umpire's call is always the source of truth.** The engine should not try to override or auto-compute infield fly, obstruction, interference, balks, illegal slides, or strike-out-on-abandonment. These need explicit "umpire called X" events.

2. **Coach prompts vs. auto-detection:** Auto-detect the *normal* path; *prompt* on edge cases. Specifically prompt on:
   - Timing plays (run scored before/after a non-force third out).
   - Hit vs. error vs. FC (judgment).
   - WP vs. PB.
   - SH vs. bunt for hit vs. FC.
   - SF crediting when an OF drops a fly (judgment whether runner would have scored).
   - Tag-up on caught flies that resulted in advancement (only as confirmation; appeal play).

3. **Run/RBI/ER are computed at events but reconciled at half-inning end.**
   - Runs: per event, gated by §5 rules.
   - RBI: per event, with the §5(d) reverse-force exclusion and §11 ground-rule judgment.
   - ER: recomputed at end of half-inning via 9.16 inning reconstruction, per pitcher, with inherited-runner accounting.

4. **State/league config required for:**
   - Mercy/run rule thresholds.
   - Pitch count maximums and rest-day tiers.
   - Whether courtesy runners are allowed (most states yes, but NOT a federal NFHS mandate — by state adoption).
   - Double first base availability (mandatory by 2027).

5. **Stat-exclusion sets are well-defined.** Maintain explicit boolean flags `is_at_bat`, `counts_for_avg`, `counts_for_obp`, `counts_for_slg`, `is_earned_run_trigger` on each event-result type, derived from §14 — do not recompute these in formulas.

---

## Sources

- [MLB Official Baseball Rules 2024 (PDF)](https://mktg.mlbstatic.com/mlb/official-information/2024-official-baseball-rules.pdf)
- [Baseball Rules Academy — MLB Rule 5.05/6.09: Batter Becomes a Runner](https://baseballrulesacademy.com/official-rule/mlb/5-05-6-09-batter-becomes-runner/)
- [Baseball Rules Academy — MLB Rule 5.08: How a Team Scores](https://baseballrulesacademy.com/official-rule/mlb/5-08-how-a-team-scores/)
- [Baseball Rules Academy — MLB Rule 5.09: Making an Out](https://baseballrulesacademy.com/official-rule/mlb/5-09-making-an-out/)
- [Baseball Rules Academy — MLB Rule 5.06(b): Advancing Bases](https://baseballrulesacademy.com/official-rule/mlb/5-06-b-advancing-bases/)
- [Baseball Rules Academy — MLB Rule 6.01: Interference, Obstruction, and Catcher Collisions](https://baseballrulesacademy.com/official-rule/mlb/6-01-interference-obstruction-and-catcher-collisions/)
- [Baseball Rules Academy — MLB Rule 9.02: Official Scorer Report](https://baseballrulesacademy.com/official-rule/mlb/9-02-the-official-scorer-report/)
- [Baseball Rules Academy — MLB Rule 9.05: Base Hits](https://baseballrulesacademy.com/official-rule/mlb/9-05-base-hits/)
- [Baseball Rules Academy — MLB Rule 9.08: Sacrifices](https://baseballrulesacademy.com/official-rule/mlb/9-08-sacrifices/)
- [Baseball Rules Academy — MLB Rule 9.12: Errors](https://baseballrulesacademy.com/official-rule/mlb/9-12-errors/)
- [Baseball Rules Academy — MLB Rule 9.13: Wild Pitches and Passed Balls](https://baseballrulesacademy.com/official-rule/mlb/9-13-wild-pitches-passed-balls/)
- [Baseball Rules Academy — MLB Rule 9.16: Earned Runs and Runs Allowed](https://baseballrulesacademy.com/official-rule/mlb/9-16-earned-runs-runs-allowed/)
- [Baseball Rules Academy — MLB Rule 9.17: Winning and Losing Pitcher](https://baseballrulesacademy.com/official-rule/mlb/9-17-winning-losing-pitcher-official-scorer-shall-credit-winning-pitcher-pitcher-whose-team-assumes-lead-pitcher-game-inning-offense/)
- [Baseball Rules Academy — NFHS Rule 2-19: Infield Fly](https://baseballrulesacademy.com/official-rule/nfhs/rule-2-section-19-infield-fly/)
- [Baseball Rules Academy — NFHS Rule 2-29: Play, Double Play, Force Play](https://baseballrulesacademy.com/official-rule/nfhs/rule-2-section-29-play-double-play-force-play-play-ruling-squeeze-play/)
- [Baseball Rules Academy — NFHS Rule 2-32: Slide](https://baseballrulesacademy.com/official-rule/nfhs/rule-2-section-32-slide/)
- [Baseball Rules Academy — NFHS Rule 3-1: Substituting](https://baseballrulesacademy.com/official-rule/nfhs/rule-3-section-1-substituting/)
- [Baseball Rules Academy — NFHS Rule 8-2: Touching, Occupying and Returning to a Base](https://baseballrulesacademy.com/official-rule/nfhs/rule-8-section-2-touching-occupying-and-returning-to-a-base/)
- [Baseball Rules Academy — NFHS Rule 8-4: Runner Is Out](https://baseballrulesacademy.com/official-rule/nfhs/rule-8-section-4-runner-is-out/)
- [Baseball Rules Academy — NFHS Rule 4-2: Ending a Regulation Game](https://baseballrulesacademy.com/official-rule/nfhs/rule-4-section-2-ending-a-regulation-game/)
- [NFHS — Expanded Designated Hitter Rule (3-1-4) 2020](https://nfhs.org/stories/expanded-designated-hitter-role-coming-to-high-school-baseball)
- [NFHS Designated Hitter Rule 3-1-4 (sdumpires.org PDF)](https://sdumpires.org/uploads/NFHS%20DH%20Rule.pdf)
- [NFHS — Double First Base Mandate (2027)](https://nfhs.org/stories/double-first-base-introduced-into-high-school-baseball)
- [NFHS — Pitching Restrictions Policy Based on Pitches](https://www.nfhs.org/articles/pitching-restriction-policies-in-baseball-to-be-based-on-pitches/)
- [Baseball America — High School Pitch Count Rules By State](https://www.baseballamerica.com/stories/high-school-pitch-count-rules-by-state/)
- [UmpireBible — OBR Rule 5.0 (full text)](https://www.umpirebible.com/OBR16/5.0.htm)
- [UmpireBible — OBR Rule 6.0 (full text)](https://www.umpirebible.com/OBR16/6.0.htm)
- [UmpireBible — Force Play Slide / Illegal Slide](https://umpirebible.com/index.php/component/content/article/2-rules/51-force-play-slide-illegal-slide)
- [UmpireBible — Obstruction](https://www.umpirebible.com/index.php/rules-fielding/obstruction)
- [UmpireBible — Awarding Bases](https://www.umpirebible.com/index.php/rules-base-running/awarding-bases)
- [UmpireBible — Third Out on Appeal](http://www.umpirebible.com/ubBlog/archives/304)
- [UmpireBible — Defensive (Catcher's) Interference](https://www.umpirebible.com/index.php/rules-interference/defensive-catcher-s-interference)
- [Retrosheet — Inherited Runners Accounting](https://www.retrosheet.org/presadj.htm)
- [Stew Thornley — Determining Earned and Unearned Runs (March 2023 PDF)](https://milkeespress.com/unearnedruns.pdf)
- [Steve The Ump — Proper Scoring of Baseball Runs](http://www.stevetheump.com/scoring_runs.htm)
- [Steve The Ump — NFHS vs. OBR Rules Differences](http://www.stevetheump.com/nfhs_pro_rules_dif.htm)
- [Wikipedia — Infield Fly Rule](https://en.wikipedia.org/wiki/Infield_fly_rule)
- [Wikipedia — Uncaught Third Strike](https://en.wikipedia.org/wiki/Uncaught_third_strike)
- [Wikipedia — Sacrifice Fly](https://en.wikipedia.org/wiki/Sacrifice_fly)
- [Wikipedia — Sacrifice Bunt](https://en.wikipedia.org/wiki/Sacrifice_bunt)
- [Wikipedia — Force Play](https://en.wikipedia.org/wiki/Force_play)
- [Wikipedia — Fourth Out](https://en.wikipedia.org/wiki/Fourth_out)
- [Wikipedia — Obstruction (Baseball)](https://en.wikipedia.org/wiki/Obstruction_(baseball))
- [Wikipedia — Mercy Rule](https://en.wikipedia.org/wiki/Mercy_rule)
- [Wikipedia — Earned Run](https://en.wikipedia.org/wiki/Earned_run)
- [MLB.com Glossary — Infield Fly](https://www.mlb.com/glossary/rules/infield-fly)
- [MLB.com Glossary — Force Play](https://www.mlb.com/glossary/rules/force-play)
- [MLB.com Glossary — Catcher Interference](https://www.mlb.com/glossary/rules/catcher-interference)
- [MLB.com Glossary — Sacrifice Fly (SF)](https://www.mlb.com/glossary/standard-stats/sacrifice-fly)
- [MLB.com Glossary — Sacrifice Bunt (SH)](https://www.mlb.com/glossary/standard-stats/sacrifice-bunt)
- [MLB.com Glossary — Passed Ball (PB)](https://www.mlb.com/glossary/standard-stats/passed-ball)
- [MLB.com Glossary — Wild Pitch (WP)](https://www.mlb.com/glossary/standard-stats/wild-pitch)
- [MLB News — Dropped Third Strike: Baseball's Strangest Rule](https://www.mlb.com/news/dropped-third-strike-strangest-baseball-rule)
