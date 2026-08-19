# 00 · Overview

## Elevator pitch

**פולי-שוק בחירות** (Polishuk Elections) is a weekly prediction game for the 2026 Israeli Knesset elections. Every week, each player submits two seat-by-seat predictions across the running parties:

1. **Final-outcome bet (הימור התוצאה)** — how the actual election will end.
2. **Poll-average bet (הימור הסקרים)** — what *next week's* average of published polls will show.

Poll bets are scored every week against our own polls aggregator; final-outcome bets accumulate week after week and are all scored the moment official results are in — so a consistently good long-range forecaster wins big, but there are no lottery-style early-bird bonuses. The site also serves as a clean, public polls tracker and hosts a live leaderboard.

It is the sequel to [Polishuk](https://k-mizrahi.github.io/polishuk), the Democrats-primaries prediction game, and inherits its visual identity and playful-Hebrew tone.

**Status (2026-08-19): pre-launch.** The game goes live **Friday morning 2026-09-11** (owner decision 2026-08-19; final-outcome lists expected Thursday 09-10). Until then the deployed site shows only the coming-soon page, the production DB carries mock players/weeks (`scripts/mock_data.py teardown` before launch), and the pipeline runs for real — polls accumulate so week one starts with history. Poll ingest is **down and deliberately parked** until the final lists land on 09-10 (see the Decisions log): the scraper has failed on an unmapped `Unity` column since 2026-08-07 (merger tripwire, runbook in [06](06-game-ops.md)). Current state and next steps always live in [`handoffs/`](../handoffs/) and CLAUDE.md's Status section.

## Glossary

| Term | Definition |
|---|---|
| **Game week (שבוע משחק)** | The measured window: Sunday 00:00 → Saturday 23:59, Asia/Jerusalem — the Israeli week (revised 2026-08-19; was Friday→Thursday, R7/docs/09). A poll belongs to game week *w* iff its **last fieldwork date** falls inside *w*. |
| **Lock (נעילה)** | The submission deadline for week *w*'s bets: **Saturday midnight Israel time**, i.e. Sunday 00:00 — the instant week *w* begins. Lock and week boundary coincide by design, so no poll counting toward *w* can be public before bets close. After lock, week-*w* bets are frozen and become public. Enforced by a timestamp comparison in the database, not by a scheduled job. |
| **Standing bet** | The bet that counts for a player in a given week: either freshly submitted that week or carried forward. |
| **Carried bet (הימור מתגלגל)** | When a player doesn't submit by lock, their most recent bet of that kind is automatically cloned into the new week (`is_carried = true`), remapped through any party mergers. |
| **Weekly average (ממוצע שבועי)** | Per party: the unweighted mean of seat numbers over all approved polls belonging to that game week. Fractional, unrounded. Sums to 120 by construction. |
| **Void week** | A game week with zero approved polls; poll bets for it are simply not scored. |
| **Common partition** | The scoring rule for party mergers/splits: a bet and the actual results are both mapped onto the coarsest grouping of parties valid at both points in time, and group **sums** are compared. See [02](02-scoring-spec.md#mergers). |
| **Review queue** | Scraped polls that failed validation or changed after approval; they wait as `pending` for admin approval before entering averages. |
| **Handle** | A player's unique public name on the leaderboard, chosen at first login. Hebrew or Latin allowed. |

## Decisions log

All product decisions confirmed with the owner (Kobi), 2026-07-11:

| Topic | Decision |
|---|---|
| Backend | Supabase free tier (Postgres + Auth + RLS); static frontend on GitHub Pages |
| Polls source | Own aggregator; **scraper from day one** off Wikipedia's *Opinion polling for the next Israeli legislative election*, with an admin review queue |
| Missed weeks | **Carry forward** the last submission automatically (both bet kinds) |
| Bet validation | Seats sum to exactly 120; each party gets 0 or ≥ 4 seats (3.25% threshold) |
| Bet privacy | Hidden during the submission window; public the moment the week locks. Leaderboard always public |
| Language | Hebrew RTL primary + English UI toggle (full i18n) |
| Lock time | **Saturday midnight Israel time** (= Sunday 00:00, the week's own start), revised 2026-08-19 from the provisional Friday 12:00. Bets are open all week and close as the week they cover begins |
| Login | Google OAuth + email magic link. No X/Twitter OAuth (API/pricing risk); players may display their X handle |
| Name | **פולי-שוק בחירות** (Polishuk Elections). Repo: `polishuk-elections-2026`, site: https://k-mizrahi.github.io/polishuk-elections-2026/ |
| Scoring | Absolute-error based, incentive-compatible, equal weight per week (no time multipliers). Constants **owner-approved 2026-07-13**: polls `max(0, 100 − E)`, finals `max(0, 150 − E)` — finals ≈1.5× polls in aggregate. Normative in [02](02-scoring-spec.md) §4; live in `app_settings`, frozen at launch |
| Design language | Match Polishuk: Tailwind, light theme, `bg-sky-50` page, white `rounded-2xl shadow-xl` cards, `text-blue-900` extrabold headings, slate body text, `blue-600/700` buttons, amber callouts, emerald success accents, `max-w-4xl` container |

Added since (each ratified in the dated session noted):

| Topic | Decision |
|---|---|
| Launch date + gate (2026-07-18, revised 2026-08-19) | Public launch **Friday morning 2026-09-11**, the day after the final party lists land Thursday 09-10. (Supersedes the earlier 09-08 and 09-12 plans.) First playable game week **09-13→09-19**, locking Saturday 09-12 at midnight — so launch weekend is the signup-and-first-bet window, and players bet through Friday and Shabbat. Until then the Pages build ships **only** the coming-soon landing page, gated by the repo Actions variable `VITE_COMING_SOON=1`. Launch = delete that variable + dispatch `deploy-pages`, plus mock-data teardown. The `email_signups` mailing list is **not** mock data — never wipe it |
| Poll ingest source (2026-07-14) | **Wikipedia is the sole ingested source.** N12's open JSON API, Kan and other outlets are **validation-only** — never ingested. Reasons: copyright, unstable shape, and that a second source would defeat the scraper's fail-loud single-source merger tripwire |
| Party mapping deferred to the final lists (2026-08-19) | No per-party registry work before **2026-09-10**, when the final lists are published and the registry is rebuilt against them in one pass. Consequence: the scraper stays red on unmapped columns (currently `Unity`) and no polls ingest until then. This is safe because a scrape re-parses the **entire** Wikipedia table whenever the revid changes (`cli.py`), so the first green run after the rebuild backfills everything missed |
| Party codes are permanent (2026-07-27) | A party's `code` never changes when its public name changes — the Tropper-Hendel list stays `yesodot` while displaying בית ציוני / "Zionist Home". Renaming the code breaks bets, polls, transitions and carry-forward remapping. Renames are handled by updating names + adding an alias |

## Document map

| Doc | Scope (single source of truth for…) |
|---|---|
| [01-product-spec.md](01-product-spec.md) | UX: every page, every state, i18n/RTL rules, copy tone, onboarding |
| [02-scoring-spec.md](02-scoring-spec.md) | **Normative** game math: formulas, constants, averaging, mergers, tie-breakers, incentive analysis |
| [03-architecture.md](03-architecture.md) | Components, data flows, secrets, failure modes, technology choices |
| [04-data-model.md](04-data-model.md) | **Normative** schema: full DDL, RLS policies, triggers, seed plan |
| [05-scraper-spec.md](05-scraper-spec.md) | Wikipedia parsing rules, validation matrix, review-queue lifecycle, fixtures |
| [06-game-ops.md](06-game-ops.md) | Runbooks: weekly close, merger day, poll correction, election night, incidents; risk register |
| [07-roadmap.md](07-roadmap.md) | V1 / V1.5 / V2 milestones with acceptance criteria |

Where documents overlap, the doc listed as source of truth wins; others must link, not restate numbers.

## Open items

- ~~Final repo/URL name~~ → resolved: `polishuk-elections-2026` (2026-07-11).
- ~~Lock-time revisit~~ → resolved 2026-08-19: the week moved to Sunday→Saturday and the lock to Saturday midnight (the week's own start), which removes the sniping window the Friday-noon lock left open. Still worth confirming against real publication cadence after ~4 weeks of play.
- ~~Scoring constants sign-off~~ → resolved 2026-07-13: polls `100 − E`, finals `150 − E`, live in `app_settings` and frozen at launch (Decisions log above, [02](02-scoring-spec.md) §4).
- Hebrew copy review pass (planned as its own session); seeded Hebrew party names in `pipeline/registry.py` also pending owner review — the Zionist Home name בית ציוני was owner-approved 2026-07-27 ([08](08-final-parties-2026.md)).
- Election date: working date **2026-10-27**; `is_final_week` still to be set. ⚠️ Confirm against the official announcement before it drives anything — this date has not been re-verified since 2026-07-18.
- **Ra'am / Joint List bloc semantics** — the registry keeps `raam` a bettable line and bridges it to `joint_list` via a 2026-06-10 transition; N12 lists the two separately, which is the whole of the residual drift in the 2026-07-14 cross-check. If Ra'am is ratified as permanently separate it is a `registry.py` + [02](02-scoring-spec.md) §6 + full-rescore change. Undecided.
- **Poll auto-approve gate** — new polls default to `approved`; owner is weighing weekly admin confirmation. See the open security items in [06](06-game-ops.md).

Current deployment state and next steps are tracked in [`handoffs/`](../handoffs/).
