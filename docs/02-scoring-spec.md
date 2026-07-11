# 02 · Scoring Specification (Normative)

This document is the single source of truth for all game math. The scoring engine (`pipeline/scoring.py`) must implement exactly what is written here; the rules page copy (doc 01) must paraphrase it faithfully. Any change to this doc after launch requires an announcement and a full score recompute.

## Design principles (owner's requirements)

1. **Simple** — every rule explainable in a tweet.
2. **Final results outweigh polls** — the real election is the point; poll bets are the weekly fun.
3. **Equal weight per bet across time** — no early-bird multipliers; a week-3 final bet and a week-30 final bet use identical constants.
4. **Incentive compatible** — reporting your honest belief maximizes your expected score; no reward for hedging, herding, or manipulation.

## 1. Error metric

For any bet **b** (a vector of integer seats per party) and any target **t** (a vector of actual values per party, possibly fractional), the error is the **total absolute seat error**:

```
E(b, t) = Σ_p | b_p − t_p |        over all parties p in the common partition (see §5)
```

**Why absolute error (not quadratic):**

- *Explainability*: "you lose points for every seat you're off" — done. Quadratic loss cannot be explained to a lay audience in one sentence.
- *Robustness*: one badly-missed party doesn't nuke a week.
- *Incentives*: under absolute loss, the optimal report is your coordinate-wise **median** belief — indistinguishable from "your honest best guess" for lay players. (Quadratic elicits means; for seat distributions the median–mean gap is ≤ 1 seat per party in practice, so the theoretical difference is negligible while the simplicity gain is large.)
- Your score depends **only on your own error** — never on other players' bets — so there is no game-theoretic incentive to differentiate, hedge, or copy. See §7.

## 2. The weekly poll average (the target for poll bets)

For game week *w* (Sunday 00:00 – Saturday 23:59 Asia/Jerusalem) and each party *p* active in week *w*:

```
avg(w, p) = mean over approved polls q with fieldwork_end(q) ∈ w of seats(q, p)
```

Rules, all normative:

- **Membership**: a poll belongs to week *w* iff its **last fieldwork date** is in *w*. Fieldwork date, not publication date — it's what Wikipedia reliably lists and it's manipulation-neutral.
- **Only `approved` polls** count (scraper auto-approves clean rows; anomalies wait in the review queue — doc 05).
- **Unweighted mean** — each poll counts once regardless of sample size. (Sample-size weighting adds arguing surface for negligible accuracy gain.)
- **No rounding** — the average stays fractional (e.g., 4.33).
- A party **not listed** in a given poll, or listed as sub-threshold ("N%"), contributes **0 seats** for that poll. Since every individual poll's seats sum to 120, the weekly averages sum to 120 by construction.
- **Zero-poll week ⇒ void**: if no approved poll lands in week *w*, poll bets for *w* are **not scored at all** (no zeros handed out, no roll-over of polls to an adjacent week). Expected around holidays and during the pre-election polling blackout.

## 3. Poll-average bet scoring

Each game week *w*, a player's standing poll bet (submitted or carried) is scored once, when the week's average is finalized (the Wednesday finalize run — doc 06):

```
poll_score(w) = max(0, 30 − E(bet, avg(w, ·)))        kept to 1 decimal place
```

Calibration intuition: a sharp player typically lands E ≈ 8–14 → **16–22 points**; a near-perfect week ≈ 27; E ≥ 30 → 0. The `max(0, ·)` floor keeps scores non-negative and psychologically safe; the only distortion it introduces (indifference between bad and terrible once you'd floor at 0 anyway) cannot make truthful reporting sub-optimal.

Players with **no standing bet** in week *w* (i.e., they joined later and have nothing to carry forward) receive no row at all for that week — not a 0.

## 4. Final-outcome bet scoring

After official results are entered (party → integer seats, Σ = 120), **every game week's standing final bet is scored independently**, including carried-forward ones:

```
final_score(w) = max(0, 100 − 2 · E(bet_w, official))
```

- Identical constants for every week — principle 3. A player's reward for early accuracy is *linear*: being right from week 1 simply means more scored weeks.
- Calibration intuition: historical Israeli final-polls-to-results total absolute errors run ~20–30 seats, so a solid final bet scores **40–60 points per week**; a visionary early call at E = 10 scores 80; E ≥ 50 → 0.
- The **last final-bet week** is the game week that ends before election day (defined when the date is set; `game_weeks.is_final_week` flags it).

**Aggregate weighting check** (principle 2): with ~identical numbers of poll and final weeks, expected totals are ≈ 18/week from polls vs. ≈ 50/week from finals — finals contribute **~2.5–3×** the poll points. Tuning either constant rebalances this without touching structure.

> ⚠️ **Constants pending owner sign-off**: `(30, 1)` for polls and `(100, 2)` for finals are proposals. They are stored in `app_settings` (key `scoring_constants`) and read by the engine, so adjusting them pre-launch is a data change. Post-launch they are frozen.

## 5. Total score and leaderboard

```
total(player) = Σ_w poll_score(w) + Σ_w final_score(w)
```

**Tie-breakers**, in order:
1. Higher total score.
2. Higher final-bet subtotal (the real election is the point).
3. Lower cumulative final-bet absolute error.
4. Earlier first-ever bet timestamp (rewards commitment; deterministic).

The leaderboard also displays **points per week played** as an informational column so late joiners can see their rate — it does not affect ranking.

<a name="mergers"></a>
## 6. Party mergers & splits — the common-partition rule

Israeli party lists mutate constantly (2026 so far: Yesh Atid + Bennett → "Together" in April; the Joint List re-forming in June; Yesodot Yisrael forming in July). The rule:

> When a bet's party list differs from the target's party list, both are mapped onto the **coarsest common partition** — parties are grouped, via the `party_transitions` graph, into the smallest groups such that every bet-time party and every target-time party falls wholly inside one group. Errors are computed on **group sums**.

Properties: symmetric between mergers and splits, never punishes a player for political events they couldn't react to, and one sentence long: **"merged parties are compared as a bloc."**

Additionally, at each weekly lock, carried-forward bets are **auto-remapped** through `party_transitions` (a merger sums the constituents' seats into the new party) so active players always see and edit a current-list bet. If a *split* makes deterministic remapping impossible, the bet is carried unchanged and flagged; scoring handles it via the partition rule regardless.

### Worked examples

**Example A — poll bet vs. a fractional average.**
Week average: Likud 24.67, Together 22.33, Democrats 12.00, Shas 9.67, …
Player bet: Likud 26, Together 21, Democrats 12, Shas 10, …
Per-party errors: 1.33 + 1.33 + 0 + 0.33 + (rest, say 7.7) → E = 10.7 → **poll_score = 19.3**.
(The rules page must show a version of this — integer bets vs. fractional targets confuses people until they see one example.)

**Example B — merger between bet and scoring.**
March final bet: Yesh Atid 15, Bennett 12 (separate parties at the time). Election results: Together 24.
Common partition groups {Yesh Atid, Bennett, Together}. Bet group sum 27, actual 24 → contributes |27 − 24| = 3 to E. All other parties compare 1:1.

**Example C — split.**
Early bet: Joint List 9. By election day it ran as Hadash-Ta'al (5) and Balad (4).
Partition groups all three; bet 9 vs. actual 5 + 4 = 9 → contributes 0.

## 7. Incentive-compatibility & manipulation analysis

| Vector | Disposition |
|---|---|
| **Hedging / distorting** | Score is a proper-style point score in your own error only; leaderboard = sum of per-bet scores, not rank-per-week payouts (rank-based weekly prizes would reward variance-seeking). Reporting anything but your central belief strictly increases expected error. |
| **Copying the leader** | Bets are RLS-hidden until lock; by the time you can see a bet it can no longer be copied into the same week. |
| **Sniping the poll average** | Structurally impossible: bets for week *w* lock **Friday 12:00**, and week *w*'s measured fieldwork window opens Sunday 00:00 — at lock time, zero polls of the target week exist. Late submission buys you the freshest *previous-week* information, which everyone has. |
| **Pollster-participants** | Ignored by owner decision (also: one poll among ~4–6 weekly moves an unweighted average little). |
| **Sockpuppets** | Low benefit (scores aren't relative — a puppet can't boost your score, only clutter the board). Mitigations: OAuth-gated accounts, public handles, admin ban voids scores. Accepted residual risk for a Twitter-public game. |
| **Quitting while ahead** | Not possible to exploit: carried bets keep scoring every week, and totals only grow. (This is why the leaderboard ranks by total, not average.) |

## 8. Recomputation semantics

Scoring is a **pure function**: `(approved polls, standing bets, party-transition graph, official results, constants) → (weekly_averages, scores)`. The engine always recomputes **everything from scratch** in one transaction (thousands of rows — trivially cheap) and truncate-rewrites `weekly_averages` and `scores`. Consequences, all intended:

- A retroactively corrected/approved poll self-heals every affected average and score on the next run.
- A banned player's rows are excluded by a flag check at compute time; unbanning restores them.
- There is no incremental-update code path to keep consistent — one code path, always.
