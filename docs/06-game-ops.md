# 06 · Game Ops — Runbooks & Risk Register

Operational truth for running the game week to week. The automation lives in `.github/workflows/`; everything here is either automated-with-a-manual-fallback or an explicit admin procedure.

## Weekly cycle (what happens when)

All times Asia/Jerusalem. Game week *w* runs **Friday–Thursday** (R7, docs/09); its bets lock at that **Friday 12:00**.

| When | What | Who |
|---|---|---|
| continuous, every 6h | Scrape polls; auto-approve clean rows; queue anomalies; stamp `last_scrape_ok_at` heartbeat | `scrape.yml` |
| continuous, every 3h | **Freshness watchdog** — heartbeat/backlog/outlet checks; files a GitHub issue on breach | `watchdog.yml` |
| **Friday 12:00** | Lock instant for week *w* bets — nothing *runs*; RLS/trigger predicates over `lock_at` flip write-access off and visibility on | Postgres |
| Friday ~12:05 | **Weekly close job**: (1) mark week *w−1* `locked`→bookkeeping, week *w* `open`→`locked`… precisely: transition statuses so *w* is locked and *w+1* is `open`; (2) **carry forward** — for each player and kind with a bet history but no week-(*w+1*) bet, clone the latest bet with `is_carried = true`, remapped through `party_transitions`; (3) compute **provisional** averages/scores for completed weeks | `weekly-close.yml` |
| **Wednesday ~12:00** | **Finalize run**: recompute everything (doc 02 §8) — by now late-published weekend polls have reached Wikipedia; this run also doubles as a catch-up sweep if Friday's run failed | `weekly-close.yml` |
| any time | Manual full recompute | `recompute.yml` (`workflow_dispatch`) |

All jobs are idempotent (natural-key upserts + truncate-rewrite scoring); rerunning any of them at any time is safe. That is the primary incident response for every cron mishap.

### Weekly admin checklist (~5 minutes, after Friday close)

1. Actions tab: did `weekly-close` go green? (If not: read log, rerun.)
2. Poll review queue empty? Approve/reject pending rows — **before Wednesday's finalize**.
3. Skim the polls page against one news source: does the week look complete?
4. Archive page: spot-check that the reveal (public bets) looks right.

## Runbook: merger day (new party column on Wikipedia)

Trigger: scraper run fails with `Unmapped party column: "<Header>"`.

1. In admin → Parties: create the new party (`code`, `name_he/en`, `color`, `active_from` = merger date).
2. Set `active_until` on the predecessor parties (day before `active_from`).
3. Add `party_transitions` rows: each predecessor → new party, `effective_on` = merger date. (Split: one → many, same table.)
4. Add a `party_aliases` row with the exact failed header string.
5. Rerun the scraper workflow (`workflow_dispatch`). It should pass; polls store against the new party.
6. Sanity-check `bets.html` renders the new list, and the next close's carry-forward remaps old bets (spot-check one player in archive after the following lock).

Historical note: pre-merger polls remain stored against predecessor parties — correct, since those polls measured those parties; averaging and scoring bridge eras via the common partition (doc 02 §6).

## Runbook: poll correction

- **Wikipedia edited a poll**: scraper inserts the new version as `pending` with a diff (doc 05 §7). Admin: review diff → approve new version → old one auto-marked `rejected` (implemented as part of approve) → Wednesday recompute self-heals scores.
- **Admin-spotted error**: edit the poll's `poll_results` rows in the console (audit-logged) → trigger `recompute.yml`.
- Announce score changes in the site announcement (`app_settings['announcement']`) if the leaderboard visibly reshuffles.

## Runbook: freshness watchdog

`watchdog.yml` (every 3h) runs `cli.py watchdog` — checks that fail *silently*
otherwise (a scrape that never ran leaves no error, no issue). On any breach it
exits 1 and the workflow files/comments a single rolling **"Freshness watchdog"**
GitHub issue; the specific alerts are in the run summary. Logic is pure and
tested in `pipeline/tests/test_watchdog.py`; thresholds live in code
(`watchdog.DEFAULTS`) and are overridable at runtime via `app_settings['watchdog_config']`.

Alerts are **self-clearing** — fix the gap and the next run goes green.

| Alert code | Means | Response |
|---|---|---|
| `stale_scrape` | No successful scrape in > 12h (heartbeat `last_scrape_ok_at`) | Scrape cron disabled (GitHub disables schedules after 60d inactivity — push any commit to re-enable), Supabase paused, or runs failing. Check the Actions tab / `scrape.yml`. |
| `stale_polls` | Newest approved poll > 9d old | Check Wikipedia for polls we haven't ingested; hand-enter if the scraper missed one. |
| `review_backlog` | Pending rows unreviewed > 36h | Clear the poll review queue (weekly checklist #2) before the Wednesday finalize. |
| `outlet_ahead` | N12 republished its polls page but we ingested nothing within 18h | Wikipedia may be lagging a poll N12 already published — check the EN polling page for a missing row. |
| `outlet_unreachable` | A normally-open outlet (N12) can't be fetched | Usually transient; if persistent, the outlet restructured — see `watchdog.OUTLETS`. |
| `outlet_now_reachable` | A known-blocked outlet (Kan) became reachable | Opportunity: Kan is Cloudflare-walled today; if it opens up, wire it into `OUTLETS`. |

Watched outlets are a *tripwire only* — we never ingest their numbers (copyright +
unstable shape). N12's `story.json` `Last-Modified` is the signal; Kan is
`expected_blocked` (Cloudflare Error 1000S from CI) so it stays quiet, and its
polls are Kantar-commissioned and already reach us via Wikipedia anyway.

### Cross-source spot-check (N12 structured API)

N12's elections widget is backed by a real JSON endpoint —
`https://mako_elections.devdinocdn.com/Home/GetSurveysData` (`data.surveys[]`,
each `{surveyCreatorId, surveyDate, surveyResults:[{partyId,result}]}`; parties
and creators in sibling arrays). No auth, no Cloudflare wall. Useful to
**validate** Wikipedia numbers by hand (do NOT ingest — same copyright/shape
reasons). A 2026-07-14 audit matched all 74 same-pollster/same-date pairs to the
seat after reconciling two **classification** differences below.

**Known bloc-classification differences vs N12 (not data errors):**
- **Ra'am**: our `registry.py` folds Ra'am into the `joint_list` bloc; N12 lists
  it separately. Component seats reconcile to our bloc total on recent polls.
  Whether Ra'am should be its own bettable line is a scoring-semantics question
  (docs/02 §6) — flagged, not yet decided.
- **Tropper-Handel = Yesodot**: same party, different label across sources.

## Runbook: election night 🗳️

1. When the election date becomes law: set `app_settings['election_date']`; mark the game week ending before election day `is_final_week = true`. Weeks after it are deleted/never opened. The pre-election polling blackout empties the last poll week(s) → void, already handled.
2. After official results (CEC final, not exit polls): admin → Official results tab; enter seats (form enforces Σ=120, 0-or-4+); double-confirm.
3. Run `recompute.yml` with the `final` flag → every week's standing final bet is scored (doc 02 §4).
4. Leaderboard is now final. Ceremony: recap tweet (V1.5 generator or by hand), pin the site.

## Runbook: incidents

| Symptom | Response |
|---|---|
| Scraper red, "Unmapped column" | Merger-day runbook above |
| Scraper red, parse/layout error | Commit page snapshot as fixture → fix parser → rerun. Meanwhile, if Wednesday nears: hand-enter missing polls in admin console |
| Weekly close red | Read log; fix cause; rerun — idempotent. If close never ran before the next lock, nothing is unfair (locks are DB timestamps); carry-forward and scores backfill on the next successful run |
| Supabase 503 / project paused | Dashboard → restore. Locks unaffected. Check whether scrape cron had been failing (it's the keep-alive) |
| Player reports a wrong score | Reproduce from `weekly_averages` + their bet (pure function, doc 02 §8); if data was wrong → poll-correction runbook; if engine bug → fix, recompute, announce |
| Abuse (impersonation handle, sockpuppet clutter) | Admin → Users → ban (audit-logged); scores recompute excludes banned users |

## Setup runbook (one-time — status as of 2026-07-11)

1. ✅ Supabase project created (`tcljueekscqccgswlgxb`, eu-central-1); migrations 0001+0002 and seed applied.
2. ⬜ Google Cloud Console: OAuth client; callback `https://tcljueekscqccgswlgxb.supabase.co/auth/v1/callback`.
3. ⬜ Supabase Auth: enable Google; Site URL `https://k-mizrahi.github.io/polishuk-elections-2026/`; add `http://localhost:5173/**` to redirect URLs.
4. ✅ GH repo `k-mizrahi/polishuk-elections-2026`: secrets + variables set, Pages enabled (workflow mode), site deployed and connected.
5. ⬜ Owner logs in once → set own profile `is_admin = true` (the only manual SQL in the system's life).
6. ✅ Backfill: first scrape ingested 147 polls (12 pending review); `close` opened the week of 2026-07-19.

### Applying migrations (no supabase CLI needed)

Migrations run over the **session pooler** (IPv4-safe) as `postgres`:
host `aws-0-eu-central-1.pooler.supabase.com`, port 5432, db `postgres`,
user `postgres.tcljueekscqccgswlgxb`, password in `~/.polishuk_db_password`.
From `pipeline/`: `.venv/bin/python -c "import psycopg,pathlib; ..."` or any Postgres client.
Two gotchas, both already encoded in the SQL: direct-connection DDL misses the
dashboard's default privileges (hence `0002_grants.sql` — new tables/functions
need explicit grants), and pg-safeupdate rejects bare `delete` even inside
functions (`where true`).

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Election date unknown / snap election | certain (one way or another) | medium | Game is open-ended by design; per-week constants mean any number of weeks works; `is_final_week` set when known; blackout weeks auto-void |
| Wikipedia format drift / edit wars | medium | medium | Fail-loud mapping, revid change detection, review queue, fixtures, manual poll entry fallback |
| Supabase free-tier pause (7-day idle) | low (cron traffic) | high | 6-hour scraper + explicit keep-alive query even on no-change runs |
| Magic-link email rate limits (free tier) | medium at launch spikes | low | Google OAuth is the primary path; rate-limited users retry or use Google |
| GH cron drift/skip | high (minutes), low (whole-day) | low | DB-enforced lock; idempotent jobs; Wednesday sweep |
| Lock time wrong for real poll cadence | medium | medium | ⚠️ Flagged decision: revisit Friday 12:00 after ~4 weeks of observed publication days; `lock_at` is per-week data, changeable without deploy (announce before changing) |
| Scoring constants feel off after launch | medium | medium | Constants in `app_settings`, tunable **pre-launch only**; post-launch frozen (fairness) — hence the sign-off gate in doc 02 §4 |
| Sockpuppets / abuse | low | low | Doc 02 §7; ban + audit log |
| Solo-maintainer bus factor | — | — | These docs + runbooks are the mitigation |
