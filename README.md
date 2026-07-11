# פולי-שוק בחירות · Polishuk Elections

A "fantasy elections" game for the 2026 Israeli Knesset elections. Each week, players submit two predictions:

1. **Final-outcome bet** — seats per party in the actual election results.
2. **Poll-average bet** — seats per party in *next week's* average of published polls.

The site displays recent polls (our own aggregator) and a live leaderboard. Hebrew-first (RTL) with an English UI toggle. A sequel to [Polishuk](https://k-mizrahi.github.io/polishuk) (the Democrats-primaries prediction game).

## Status

**Planning phase.** No application code yet — the design lives in [`docs/`](docs/), which is the source of truth for implementation. Start with [`docs/00-overview.md`](docs/00-overview.md).

## Repo layout

| Path | Contents |
|---|---|
| `docs/` | Planning & design documents (normative) |
| `frontend/` | Static site — Vite + vanilla TypeScript + Tailwind, deployed to GitHub Pages |
| `pipeline/` | Python jobs run on GitHub Actions cron: Wikipedia polls scraper, weekly close, scoring engine |
| `supabase/` | Database migrations (schema, RLS, triggers) and seed data |
| `.github/workflows/` | Pages deploy, scraper cron, weekly-close cron, score recompute |

## Architecture in one paragraph

A fully static frontend on GitHub Pages talks directly to Supabase (Postgres + Auth) with the public anon key; Row-Level Security and DB triggers enforce all game rules (bets sum to 120, submission locks, bet privacy until week lock). Scheduled GitHub Actions run Python jobs with the service-role key: scraping polls from Wikipedia, closing game weeks, and recomputing all scores from scratch (scoring is a pure function, so corrections self-heal). See [`docs/03-architecture.md`](docs/03-architecture.md).
