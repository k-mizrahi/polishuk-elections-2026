# 03 · Architecture

## Components

```
┌──────────────────────────────────────────────┐
│ GitHub repo (this repo)                      │
│                                              │
│  frontend/  ── vite build ──► GitHub Pages   │  static, public
│  pipeline/  ── GH Actions cron ──┐           │  Python, service-role key
│  supabase/migrations/ ── supabase CLI ──┐    │  schema as code
└──────────────────────────────────────────┼───┘
            ▲ anon key + user JWT          │ service-role key
            │ (browser, RLS-scoped)        ▼
┌──────────────────────────────────────────────┐
│ Supabase project (free tier)                 │
│  Postgres — schema per docs/04               │
│  Auth — Google OAuth + email magic link      │
│  RLS + triggers = the referee                │
└──────────────────────────────────────────────┘
        ▲
        │ MediaWiki API (read-only)
   en.wikipedia.org — polling page
```

## Data flows

1. **Play** (browser ↔ Supabase): the static site holds only the project URL and the **anon key** (public by design). Users authenticate via Supabase Auth; every read/write carries the user JWT and is scoped by RLS. Bets are written through the `upsert_bet` RPC (doc 04 §2). There is no server of ours in this path — availability is Supabase's plus GitHub Pages'.
2. **Scrape** (GH Actions → Wikipedia → Supabase): cron every 6 hours runs `pipeline/scraper.py` with the **service-role key** (GH Actions secret). Details in doc 05.
3. **Weekly close** (GH Actions → Supabase): cron shortly after Friday-noon lock runs `pipeline/weekly_close.py`: status flips, carry-forward, provisional averages; a Wednesday run finalizes scores. Details in doc 06 runbook.
4. **Scoring** (same job, or manual `workflow_dispatch`): full recompute per doc 02 §8.

## Key decisions and why

**Static frontend + Supabase, no app server.** GitHub Pages was a requirement; Supabase provides the three things a static site can't: auth, a real database, and a security boundary (RLS). The anon key in the bundle is not a secret — RLS is the guarantee. Zero servers to operate.

**Rules enforced in Postgres, not in cron or JS.** The lock is `now() >= lock_at` inside RLS/triggers; privacy is an RLS predicate over `lock_at`. Cron drift (GitHub cron regularly runs minutes late) therefore affects only *bookkeeping*, never fairness. Every pipeline job is idempotent (upserts keyed on natural keys) so reruns are always safe.

**GitHub Actions over Supabase Edge Functions / pg_cron** for scheduled work:
- Free scheduled compute with logs, retries, manual `workflow_dispatch`, and failure emails built in.
- Full Python: `pandas.read_html` is purpose-built for wikitables, and the owner is a data-science dev — the pipeline is debuggable locally with the same code that runs in CI.
- One automation platform instead of two; the repo already lives on GitHub.
- Side benefit: regular API traffic prevents free-tier project pausing (7-day inactivity rule).
- pg_cron/Edge Functions would work but mean debugging SQL cron or Deno in production with worse observability.

**Vite + vanilla TypeScript + Tailwind (build step), MPA — no framework.** Compared to Polishuk's single-HTML-with-CDN approach: this app has ~8 pages sharing auth state, i18n, and UI chrome — copy-pasted inline JS would rot immediately. Vite MPA keeps the mental model (each page = an HTML file, no router, no runtime framework) while adding shared TS modules, generated DB types (`database.types.ts`), tree-shaken supabase-js, env handling, and a production Tailwind build (the CDN build is dev-only by Tailwind's own docs and triples page weight). React/Vue/Svelte are overkill for steppers-and-tables interactivity and would bury the reusable Polishuk aesthetic under componentization. `vite.config.ts` sets `base: '/<repo-name>/'` (project Pages subpath) and lists each page as an MPA input.

**Auth: Google OAuth primary, magic link fallback, no X login.** X's OAuth/API pricing and policy churn make it a liability for a hobby project; the audience overwhelmingly has Google accounts. Magic link covers the rest (mind free-tier email rate limits — Google-first sidesteps them). Users can *display* an X handle (social proof; mild sockpuppet deterrent). Mechanics: OAuth callback → `https://<ref>.supabase.co/auth/v1/callback` (configured in Google Cloud Console); Supabase Auth settings get Site URL `https://k-mizrahi.github.io/<repo>/` plus `http://localhost:5173/**` for dev; supabase-js PKCE flow with `detectSessionInUrl`, session in localStorage.

## Secrets & configuration

| Value | Where | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | GH Actions **secrets** | pipeline only; never in frontend or repo |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | GH Actions **variables** → baked into Pages build | public by design |
| Google OAuth client id/secret | Google Cloud Console + Supabase dashboard | not in repo |
| Scoring constants, election date, last scrape revid | `app_settings` table | runtime data, not env |

**Environments**: one Supabase project (free tier = one). Local dev runs against it with discipline: schema changes only via `supabase/migrations` + CLI; pipeline has a `--dry-run` flag that prints intended writes. If this ever hurts, `supabase start` (local Docker) is the escape hatch — migrations make the schema portable.

## Failure modes & degradation

| Failure | Effect | Degradation |
|---|---|---|
| GH cron late/skipped | Bookkeeping delayed | Lock & privacy unaffected (DB-enforced); next run catches up (idempotent); Wednesday run doubles as sweep |
| Wikipedia format change | Scraper hard-fails loudly | Polls delayed, game unaffected; admin can hand-enter polls via console; fix parser against saved fixture |
| Supabase outage | Site up, data calls fail | Frontend shows a friendly error; locks are timestamps so nothing unfair happens during the gap |
| Supabase project paused (inactivity) | Everything 503s | Prevented by 6-hour cron traffic + explicit keep-alive query in the workflow |
| Bad poll approved | Wrong averages/scores | Admin corrects → next recompute self-heals (doc 02 §8) |
| Pages deploy broken | Stale-but-working site stays up | Fix forward; deploys are atomic |

## Repo layout (target)

```
fantasy_polls/
├── frontend/
│   ├── index.html  login.html  bets.html  polls.html
│   ├── leaderboard.html  archive.html  profile.html  admin.html
│   ├── src/
│   │   ├── lib/ (supabase.ts, i18n.ts, ui.ts, database.types.ts)
│   │   ├── pages/ (one ts module per page)
│   │   └── i18n/ (he.json, en.json)
│   ├── vite.config.ts  tailwind.config.js  package.json
├── pipeline/
│   ├── scraper.py  weekly_close.py  scoring.py  db.py  cli.py
│   ├── tests/  fixtures/ (saved Wikipedia HTML snapshots)
│   └── pyproject.toml
├── supabase/
│   ├── migrations/  seed.sql
├── docs/ (these documents)
└── .github/workflows/
    ├── deploy-pages.yml   # push to main → build frontend → Pages
    ├── scrape.yml         # cron 0 */6 * * * → scraper (+ keep-alive)
    ├── weekly-close.yml   # cron ~Fri 12:05 Israel (two UTC entries, in-script DST guard)
    │                      #   + Wed finalize entry
    └── recompute.yml      # workflow_dispatch → full scoring recompute / election-night scoring
```

Cron note: GitHub cron is UTC-only; Israel flips UTC+2/+3. Schedule both candidate UTC hours and have the script exit early unless it's within the intended local window — cheaper than being wrong twice a year.
