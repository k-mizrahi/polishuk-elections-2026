# 00 · Overview

## Elevator pitch

**פולי-שוק בחירות** (Polishuk Elections) is a weekly prediction game for the 2026 Israeli Knesset elections. Every week, each player submits two seat-by-seat predictions across the running parties:

1. **Final-outcome bet (הימור התוצאה)** — how the actual election will end.
2. **Poll-average bet (הימור הסקרים)** — what *next week's* average of published polls will show.

Poll bets are scored every week against our own polls aggregator; final-outcome bets accumulate week after week and are all scored the moment official results are in — so a consistently good long-range forecaster wins big, but there are no lottery-style early-bird bonuses. The site also serves as a clean, public polls tracker and hosts a live leaderboard.

It is the sequel to [Polishuk](https://k-mizrahi.github.io/polishuk), the Democrats-primaries prediction game, and inherits its visual identity and playful-Hebrew tone.

## Glossary

| Term | Definition |
|---|---|
| **Game week (שבוע משחק)** | The measured window: Friday 00:00 → Thursday 23:59, Asia/Jerusalem (the "Friday→Friday" window, R7/docs/09). A poll belongs to game week *w* iff its **last fieldwork date** falls inside *w*. |
| **Lock (נעילה)** | The submission deadline for week *w*'s bets: **Friday 12:00 Israel time preceding week *w*** (⚠️ provisional — revisit once we observe real poll publication days). After lock, week-*w* bets are frozen and become public. Enforced by a timestamp comparison in the database, not by a scheduled job. |
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
| Lock time | **Friday 12:00 Israel time** — ⚠️ flagged for revisit after observing when polls actually publish |
| Login | Google OAuth + email magic link. No X/Twitter OAuth (API/pricing risk); players may display their X handle |
| Name | **פולי-שוק בחירות** (Polishuk Elections). Repo: `polishuk-elections-2026`, site: https://k-mizrahi.github.io/polishuk-elections-2026/ |
| Scoring | Absolute-error based, incentive-compatible, finals worth ~2.5–3× polls in aggregate, equal weight per week (no time multipliers). Constants pending sign-off — see [02](02-scoring-spec.md) |
| Design language | Match Polishuk: Tailwind, light theme, `bg-sky-50` page, white `rounded-2xl shadow-xl` cards, `text-blue-900` extrabold headings, slate body text, `blue-600/700` buttons, amber callouts, emerald success accents, `max-w-4xl` container |

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
- Lock-time revisit after observing real poll publication cadence (currently Friday 12:00).
- Scoring constants sign-off (`30 − E` poll, `100 − 2E` final) after the owner reviews [02](02-scoring-spec.md) — constants live in `app_settings`, freeze at launch.
- Hebrew copy review pass (planned as its own session); seeded Hebrew party names in `pipeline/registry.py` also pending owner review.
- Election scheduled for **November 2026** (Wikipedia renamed its polling page accordingly); exact date and `is_final_week` still to be set when known.

Current deployment state and next steps are tracked in [`handoffs/`](../handoffs/).
