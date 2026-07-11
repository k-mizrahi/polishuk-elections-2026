# 07 · Roadmap

Milestones with acceptance criteria. Order within V1 is the recommended build order — each step is verifiable on its own.

**Status 2026-07-11**: milestones 1–9 built and deployed (site live and connected, first scrape + close done). Milestone 10 (dry-run week) pending; Google OAuth + admin bootstrap pending (docs/06 setup runbook). Known deferrals: admin "Weeks" and "Ops" tabs (V1.5), polls-page collapsible past-week averages (archive covers them), `database.types.ts` still hand-written (regenerate via `supabase gen types` when convenient), election_date not settable from the admin UI yet (app_settings edit).

## V1 — launch-blocking

**Definition of done for launch**: a stranger with a Google account can play a full week loop; the owner can operate the game without touching SQL (except the one-time admin bootstrap).

| # | Milestone | Acceptance criteria |
|---|---|---|
| 1 | **Schema + RLS + seed** (`supabase/`) | Migrations apply cleanly to a fresh project; seed loads current parties/aliases/weeks; RLS verified by tests: anon can read approved polls but not pending; user A cannot read user B's open-week bet but can after `lock_at`; non-admin writes to admin tables rejected; bet trigger rejects Σ≠120, seats 1–3, post-lock writes |
| 2 | **Pipeline: scraper + review queue** (`pipeline/scraper.py`) | Full-history backfill from the live page succeeds; revid short-circuit works; fixture test suite green; unmapped-column abort demonstrated against a doctored fixture; pending-diff flow demonstrated |
| 3 | **Pipeline: weekly close + scoring engine** (`weekly_close.py`, `scoring.py`) | Against fixture data: averages match hand-computed values; carry-forward clones + remaps correctly (merger fixture); recompute is idempotent (two runs → identical tables); doc 02 worked examples A–C reproduced exactly as unit tests |
| 4 | **Workflows** (`.github/workflows/`) | scrape/close/recompute run green on schedule and via dispatch; failure path files a GitHub issue; DST guard verified by unit test on the window function |
| 5 | **Frontend: auth + onboarding** | Google + magic link work on localhost and Pages URL; handle modal enforces uniqueness; banned state renders |
| 6 | **Frontend: bets form** | Sum bar, stepper validation, quick-fills, carried banner, countdown; server-side rejection surfaces readable errors; locked/read-only state; works RTL + LTR, mobile-first |
| 7 | **Frontend: polls, leaderboard, archive, profile, index** | Per doc 01 specs incl. all empty states; i18n complete (no hardcoded strings — lint check); worked scoring example on index matches doc 02 Example A |
| 8 | **Frontend: admin console** | Queue approve/reject with diff, party+alias+transition CRUD, results entry, ban; every mutation lands in `audit_log` |
| 9 | **Deploy** | Pages workflow green; correct `base`; Supabase auth redirects work in production; Lighthouse mobile ≥ 90 perf/a11y on index |
| 10 | **Dry-run week** | Owner + 2–3 friends play one full synthetic week (fake lock time): submit → lock → reveal → provisional score → finalize. No SQL needed to operate it |

**Pre-launch gates** (from decisions log): scoring-constants sign-off (doc 02 §4) · Hebrew copy review (doc 01 tone) · repo/URL name final (Vite `base`).

## V1.5 — first weeks after launch

| Milestone | Acceptance criteria |
|---|---|
| Per-party trend chart on `polls.html` (uPlot or Chart.js; polls as dots, weekly averages as line, party colors) | Renders 6 months of polls smoothly on mobile; RTL-correct axis |
| Public profile pages polish (`?u=handle`) | Shareable link previews (OG tags) |
| Week-recap generator | One click in admin → Hebrew recap text (top movers, best week score) ready to paste into a tweet — **no X API** |
| Lock-time review ⚠️ | After ~4 weeks: analyze poll publication days; confirm or move Friday 12:00 (announce + update `lock_at` data) |

## V2 — nice-to-haves

- **Email reminders** before lock (players who haven't updated a carried bet) — Resend free tier or Supabase SMTP; opt-in.
- **Bet-distribution visualizations** per locked week (strip/violin per party: "the crowd vs. you vs. the average").
- **Consensus virtual player** ("החוכמה של ההמון") on the leaderboard: bets the previous week's average every week — a benchmark to beat.
- **Pollster accuracy stats**: once official results exist, score each pollster's final poll like a player; publish the table.
- **Badges**: best single week, longest streak of fresh (non-carried) bets, most improved.
- One-time handle rename.

## Explicit non-goals

- Real-money anything ("הימורים (לא) נושאי פרסים").
- X/Twitter API integration (posting or login).
- Native app; SSR; framework migration.
- Multi-election generalization — hardcode the 2026 Knesset assumptions (120 seats, 3.25%/4-seat threshold) as named constants; parameterize only if a sequel actually happens.
