# CLAUDE.md — Polishuk Elections

## Start here: handoffs

**Always read the latest file in `handoffs/` first** (sorted by date prefix, e.g. `2026-07-11-bootstrap.md`). It holds the current deployment state, next steps in priority order, and gotchas already solved — the repo's docs describe the design; the handoff describes *now*. At the end of any session that materially changes state (deploys, schema changes, new decisions, completed milestones), write a new dated handoff in the same format: TL;DR → what was done → environment reference → next steps → gotchas. Update stale facts in `docs/` at the same time rather than letting the handoff contradict them.

## What this is

פולי-שוק בחירות (Polishuk Elections) — a fantasy-elections game for the 2026 Knesset elections. Players submit weekly seat predictions (final outcome + next week's poll average); scoring is incentive-compatible absolute error. Live at https://k-mizrahi.github.io/polishuk-elections-2026/ (repo `k-mizrahi/polishuk-elections-2026`; this local dir keeps its old name `fantasy_polls`).

`docs/` is normative and layered — 02 (scoring math) and 04 (schema/RLS) are the specs code must match; when code and doc disagree, fix one deliberately, never silently. Worked examples in docs/02 §6 exist as unit tests in `pipeline/tests/test_scoring.py`.

## Architecture (the parts that span files)

Three legs, no app server:

- **`frontend/`** — static Vite MPA (vanilla TS, Tailwind v4, no framework, no router; one HTML entry + one `src/pages/*.ts` per page). Talks straight to Supabase with the publishable key; RTL/LTR served by one stylesheet using **logical utilities only** (`ms-*`/`pe-*`/`text-start` — never `ml-*`/`text-left`). All UI strings live in `src/i18n/{he,en}.json` via `t()`/`data-i18n`; key sets must stay identical and HTML fallback text must equal he.json.
- **`pipeline/`** — Python jobs run by GitHub Actions cron (and locally): `scraper.py` (Wikipedia → polls), `scoring.py` (pure full recompute — never incremental; corrections self-heal on rerun), `weekly_close.py` (status flips + carry-forward), orchestrated by `cli.py`, DB access via PostgREST in `db.py`.
- **`supabase/`** — migrations are the referee: bet validity (Σ=120, seats 0 or ≥4), the Friday-noon lock, and bet privacy (hidden until `lock_at`) are enforced by triggers/RLS in Postgres, not in JS or cron. Multi-row writes go through SQL RPCs (`upsert_bet`, `ingest_polls`, `apply_scoring`, `admin_upsert_bet`) so they're transactional.

Cross-leg invariants:
- **Exactly one `open` game week** at a time; locks are timestamp predicates, so late crons affect bookkeeping only, never fairness. All pipeline jobs are idempotent — rerunning is the standard incident response.
- **Party registry flows one way**: edit `pipeline/registry.py` → `python cli.py seed-sql > ../supabase/seed.sql` → apply to DB. Never hand-edit seed.sql. Party mergers/splits ride `party_transitions`; scoring bridges eras via the common-partition rule (docs/02 §6).
- Scraper is **fail-loud by design**: an unmapped Wikipedia column header aborts the run — that's the merger tripwire (runbook in docs/06), not a bug to be made tolerant.
- Supabase project uses the **new API-key format**: `sb_secret_…` goes in the `apikey` header only (no `Authorization: Bearer`); `db.py` handles both formats. The project runs pg-safeupdate — bare `delete` fails even inside SQL functions (`where true`).

## Commands

Node lives at `/opt/homebrew/bin` (prefix PATH if missing). Pipeline venv is `pipeline/.venv` (Python 3.12).

```sh
# Pipeline tests (from pipeline/)
.venv/bin/python -m pytest tests -q
.venv/bin/python -m pytest tests/test_scraper.py -q          # one file
.venv/bin/python -m pytest tests/test_scoring.py::test_doc02_example_b_merger_scored_as_bloc -q

# Scraper against live Wikipedia, no credentials needed
.venv/bin/python cli.py scrape --dry-run

# Live pipeline run (scrape | close | score)
export SUPABASE_URL=https://tcljueekscqccgswlgxb.supabase.co \
       SUPABASE_SERVICE_ROLE_KEY=$(cat ~/.polishuk_service_key)
.venv/bin/python cli.py close

# Regenerate seed after editing registry.py
.venv/bin/python cli.py seed-sql > ../supabase/seed.sql

# SQL syntax check (also runs in CI)
.venv/bin/python -c "import pglast,glob; [pglast.parse_sql(open(f).read()) for f in glob.glob('../supabase/**/*.sql', recursive=True)]"

# Frontend (from frontend/)
npm run dev        # http://localhost:5173/polishuk-elections-2026/
npm run build      # tsc --noEmit + vite build; must stay clean
```

Migrations apply over the session pooler (`aws-0-eu-central-1.pooler.supabase.com:5432`, user `postgres.tcljueekscqccgswlgxb`, password in `~/.polishuk_db_password`) with psycopg from the venv — there is no supabase CLI setup; procedure in docs/06. New tables/functions need explicit grants (see `0002_grants.sql`) because direct-connection DDL skips dashboard default privileges.

Deployment is push-to-main: CI (`test.yml`) runs pytest + SQL parse; `deploy-pages.yml` rebuilds the site (frontend changes only — dispatch it manually after changing repo variables). Scraper fixture policy: when Wikipedia's format drifts, commit the new API snapshot to `pipeline/fixtures/` first, then fix the parser against it.

<!-- claude-config:pointer -->
## Personal Claude config

This project follows my shared Claude Code config in **`~/claude-config`**
([github.com/k-mizrahi/claude-config](https://github.com/k-mizrahi/claude-config)).
Global skills and the Dugri output style are installed into `~/.claude`; reusable
conventions live in that repo's `snippets/` and `project-template/`. To sync a
machine: `~/claude-config/install.sh`.
<!-- /claude-config:pointer -->
