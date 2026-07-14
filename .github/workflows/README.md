# workflows

Planned GitHub Actions (see [docs/03-architecture.md](../../docs/03-architecture.md)):

- `deploy-pages.yml` — push to main → build frontend → GitHub Pages
- `scrape.yml` — cron every 6h → polls scraper (+ Supabase keep-alive + `last_scrape_ok_at` heartbeat)
- `watchdog.yml` — cron every 3h → freshness/heartbeat/outlet checks → GitHub issue on breach (docs/06)
- `weekly-close.yml` — Friday post-lock close + Wednesday finalize (UTC double-entry with in-script DST guard)
- `recompute.yml` — manual `workflow_dispatch` → full scoring recompute / election-night scoring
