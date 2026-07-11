# Handoff · 2026-07-11 — Project bootstrap: planning → live site

Session scope: the entire project so far — product design, planning docs, full implementation, and live deployment. Written for the next session (human or agent) to pick up without re-reading the conversation.

## Where things stand (TL;DR)

**The site is live and connected**: https://k-mizrahi.github.io/polishuk-elections-2026/
147 real polls ingested from Wikipedia, RLS verified, the game week of **2026-07-19** is open for bets (locks Friday 2026-07-17 12:00 Israel). Nobody can log in yet — Google OAuth is not configured. That is the single blocking item.

## What was done this session

1. **Product design + planning docs** (`docs/00`–`07`) — all decisions confirmed with Kobi (decisions log in `docs/00-overview.md`). Scoring system designed for incentive compatibility: absolute seat error, `max(0, 30−E)` weekly poll bets, `max(0, 100−2E)` per-week final bets, common-partition rule for party mergers (`docs/02`, normative).
2. **Pipeline** (`pipeline/`, Python 3.12, 35 tests green) — Wikipedia scraper (MediaWiki API, revid change-detection, fail-loud unmapped-column merger tripwire, review-queue routing), scoring engine (pure full recompute), weekly close (status flips, carry-forward with merger remapping). Venv at `pipeline/.venv`.
3. **Database** (`supabase/`) — migration `0001_init.sql` (tables, validation triggers, RLS, RPCs, leaderboard view), `0002_grants.sql` (role privileges), `seed.sql` **generated** from `pipeline/registry.py` via `python cli.py seed-sql` (16 parties incl. 3 historical, 16 aliases, 4 transitions, 38 game weeks, settings). Both applied to the live project.
4. **Frontend** (`frontend/`, Vite MPA + vanilla TS + Tailwind v4) — all 8 pages per `docs/01`; Hebrew RTL default with English toggle; bets form wired to the `upsert_bet` RPC; strict TS build; deployed via Actions.
5. **Automation** (`.github/workflows/`) — `scrape` (6-hourly + keep-alive + failure→issue), `weekly-close` (Fri lock + Wed finalize, DST guard), `recompute` (manual), `test` (CI), `deploy-pages`. All green.
6. **Live provisioning** — GitHub repo `k-mizrahi/polishuk-elections-2026` (public), Pages enabled (workflow mode), secrets/vars set, Supabase project created and migrated, first scrape + close executed, end-to-end REST/RLS checks passed.

## Live environment reference

| Thing | Value |
|---|---|
| Site | https://k-mizrahi.github.io/polishuk-elections-2026/ |
| Repo | https://github.com/k-mizrahi/polishuk-elections-2026 (local clone: `~/projects/fantasy_polls`) |
| Supabase project ref | `tcljueekscqccgswlgxb` (eu-central-1, free tier, **new API-key format**) |
| REST | `https://tcljueekscqccgswlgxb.supabase.co/rest/v1/` |
| Publishable key | `sb_publishable_1OeUDmQJpmCqWJxWYb5SAQ_usMKAZVu` (also in GH var `VITE_SUPABASE_ANON_KEY`) |
| Secret key | `~/.polishuk_service_key` (local) + GH secret `SUPABASE_SERVICE_ROLE_KEY`. **apikey header only** — no Bearer (db.py handles it) |
| DB access | session pooler `aws-0-eu-central-1.pooler.supabase.com:5432`, user `postgres.tcljueekscqccgswlgxb`, password in `~/.polishuk_db_password` |
| Local pipeline run | `cd pipeline && export SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=$(cat ~/.polishuk_service_key) && .venv/bin/python cli.py scrape\|close\|score [--dry-run]` |
| DB state | 136 approved + 12 pending polls; week 2026-07-19 `open`; no users/bets/scores yet |

## Next steps, in order

1. **Google OAuth (blocking, Kobi)** — full click-path in `docs/06` setup runbook steps 2–3: Google Cloud OAuth client with callback `https://tcljueekscqccgswlgxb.supabase.co/auth/v1/callback`; enable Google provider in Supabase; set Site URL `https://k-mizrahi.github.io/polishuk-elections-2026/` + `http://localhost:5173/**` redirect.
2. **Admin bootstrap** — Kobi logs in once on the live site, picks a handle, then run against the DB: `update profiles set is_admin = true where handle = '<his handle>';`
3. **End-to-end verification** — as admin: review the 12 pending polls (9 secondary scenario rows, 3 Wikipedia data anomalies); place a test bet; confirm lock behavior Friday 17.7 and the first scored week the following Wednesday. This is roadmap milestone 10 (dry-run week with 2–3 friends).
4. **Hebrew copy session (planned, separate)** — review all strings in `frontend/src/i18n/he.json` + the seeded party `name_he` values in `pipeline/registry.py` (my best guesses, esp. "ביחד" for Together; changing them = update registry → regenerate seed → `update parties` in DB or re-seed).
5. **Pre-launch sign-offs** — scoring constants (`docs/02` §3–4; stored in `app_settings.scoring_constants`, freeze at launch); lock time (Friday 12:00, revisit after ~4 weeks of observed poll cadence).
6. **Nice-to-have cleanups** — regenerate `frontend/src/lib/database.types.ts` with `supabase gen types`; admin "Weeks"/"Ops" tabs (V1.5); polls-page trend chart (V1.5).

## Gotchas discovered (already handled, don't re-learn them)

- Wikipedia **renamed** the polling page to "…the 2026 Israeli legislative election"; `redirects=1` is mandatory on the API call or you get a 1.3KB redirect stub.
- Only H2 "Seat projections" year-section tables are real polls; the page is full of scenario tables that must never be ingested.
- Poll tables have multi-row headers (bloc columns with leaf sub-columns) and **two-row scenario polls** sharing rowspanned meta cells; second rows go to `pending`.
- Supabase **new API keys**: `sb_secret_…` goes in `apikey` header only; `Authorization: Bearer` with it fails.
- Direct-connection migrations skip dashboard default privileges → `0002_grants.sql`; **pg-safeupdate** rejects bare `delete` inside functions → `where true`.
- gh token needs `workflow` scope to push workflow files (already granted on this machine).
- The close job must never open a second week while one is open (fixed; exactly one `open` week is an invariant).
- Week of 2026-07-12 was seeded but its lock (Fri 7/10) predates launch — it will collect polls and show an average, but never had bets. Expected.

## Doc changes made this session (beyond initial authoring)

`docs/03` — live endpoints, new-key format, provisioning lessons. `docs/04` — `needs_review` column, service-role trigger exemption. `docs/05` — verified page structure, cell matrix, live backfill baseline. `docs/06` — setup-runbook status, pooler migration procedure. `docs/07` — status header with deferrals. `docs/00` — resolved/updated open items. Root README — live status.
