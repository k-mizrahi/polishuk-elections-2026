# 2026-08-20 — R8 pushed, live DB remapped to R8, security lows closed, polls chart reworked

## TL;DR

The R8 batch that the previous handoff left **uncommitted and unpushed** is now on `main`,
and the launch checklist's **#1 owed item is done**: the live `game_weeks` are remapped to
Sunday→Saturday with Saturday-midnight locks. Five commits, all pushed, all CI green.

Also this session: the two open LOW security items closed and applied live; a real bidi bug
found by rendering pages in a browser; and the polls-page chart reworked to weekly averages
with a tooltip naming the polls behind each point.

`main` = `f97adaf`, working tree clean, in sync with origin. Pipeline 56/56, frontend build
clean, SQL parses, i18n 262/262 with no drift.

## What was done

### 1. Pushed the R8 batch (`dfea381`, `6d021d9` → origin)

The prior session committed R8 locally and never pushed. CI, the deployed gate page and every
cron were still running R7 logic. Fast-forwarded `main` and pushed. Nothing else was needed —
the batch was already verified.

### 2. Security: the two remaining LOWs (`b5acfb1`)

- **All 14 GitHub Actions refs pinned to commit SHAs** across the six workflows. Verified by
  the subsequent green `test` and `deploy-pages` runs.
- **`supabase/migrations/0007_field_validation.sql`** — CHECK constraints on
  `profiles.twitter_handle` (`^[A-Za-z0-9_]{1,15}$`) and `parties.color` (`^#[0-9a-fA-F]{6}$`).
  Applied to the live DB and **behaviourally verified**, not just DDL-verified: both constraints
  were shown to reject bad input in a rolled-back transaction. Preflight found 0 violating rows.
  The DB is the boundary here — both columns are written straight to PostgREST from the browser
  with the publishable key, so the form inputs never gated anything.
- Frontend got `cleanTwitterHandle()` in `lib/ui.ts` plus a `profile.twitterInvalid` string in
  both locales, wired into `profile.ts` and `login.ts`, so a bad handle gives a readable error
  instead of a raw constraint violation.

### 3. Live DB brought to R8 — the owed item

Four steps, in this order (order matters, see cautions):

1. **`game_weeks` remap.** All 38 real weeks shifted Friday→Sunday (+2 days), `lock_at`
   recomputed to the week's own Sunday 00:00 IL. **IDs preserved**, so every FK survived.
   Dry-run first, then applied. Output matched `seed.sql` line 41 exactly.
2. **`polls.game_week_id` re-derived** — 27 polls rebound, 0 orphaned (see findings).
3. **Statuses reset.** Two real weeks carried stale `scored`/`open` from old pipeline runs;
   reset to `scheduled` after asserting 0 bets sit on real weeks. `cli.py close` then picked
   the open week by its own predicate.
4. **`cli.py close`** (sets the open week + full scoring recompute), then **mock data re-seeded**
   on R8 weeks.

Verified after: **0** weeks not starting Sunday, **0** weeks where `lock_at` ≠ the week-start
instant, exactly **1** open week (2026-08-23 → 08-29, lock 2026-08-22 21:00 UTC), **0** polls
bound to the wrong week. 42 weeks total (38 real + 4 mock).

### 4. `scripts/mock_data.py` — R8 conversion + a latent FK bug

The seeder was still R7 and would have put the UI in front of the wrong week model. Now:
Sunday-start mock weeks (2026-06-07/14/21/28, all ending before the 07-06 merger so the
13-party universe stays stable), lock instant **imported from `pipeline/gameweeks.lock_at_for`**
rather than duplicated, `LAUNCH` marker corrected to 2026-07-12, and `FUTURE_LOCK` derived from
`now()` (the hardcoded `2026-08-01` had gone stale 18 days earlier).

Plus a real bug: **`teardown()` could not delete the mock weeks** because `polls.game_week_id`
still referenced them via a plain, non-cascading FK. It now detaches those polls first. This
would have fired on launch night, mid-overnight.

**`scripts/` is gitignored by design** — dev-only tooling that writes to the live DB, kept out
of the public repo. So all of the above lives on this machine only.

### 5. Bidi bug in the RTL tables (`2f4a2fc`)

Rendering the leaderboard against live data showed `_kobim` as **`kobim_`** — a leading neutral
character before a Latin run gets reordered by the bidi algorithm inside an RTL cell.
`profiles.handle` is constrained **only by length** (3–20 chars, `0001_init`), so handles may be
Latin or Hebrew; `dir="ltr"` would fix one and break the other. Added an `auto()` helper
(`dir="auto"`, first strong character decides) and applied it at all five sites that render a
user-supplied name: leaderboard, archive, both profile headings, admin users table (which also
rendered `display_name` bare). The build was green throughout — only the browser caught it.

### 6. Polls-page chart (`d3d804e`, `8fb1fd0`, `f97adaf`)

Owner asked for weekly averages instead of one point per poll, with hover showing which polls
are included.

- Points are now the **Sunday-to-Saturday average** — the quantity the game actually scores
  (docs/02 §2). Buckets key off `fieldwork_end`, **not** `game_week_id`, which is null for the
  141 approved polls fielded outside the game's schedule and would have dropped them silently.
- **Hover or tap** opens a card: party, week, poll count, the average, then every poll behind it
  (pollster, date, that party's seats), with below-threshold entries muted since they count as 0.
  The 3px dot gets a separate transparent `r=11` hit target — 3px is not hoverable, let alone
  tappable. The card is positioned from pointer coordinates (the svg is `w-full` over a fixed
  viewBox, so its user units are not CSS px) and clamped inside the wrapper.
- The page now fetches **all** approved polls rather than the most recent 60: a `limit` cuts
  mid-week and a truncated week's average is simply wrong. The table view still lists 60.
- **Span: the last 4 weekly points.** A date window was implemented first
  (`min(4 weeks ago, launch day)`, backed by a new `app_settings.launch_date`) and **rejected the
  same session** — it blanks the chart entirely whenever ingest has been down longer than the
  window, which is exactly the current state. Counting points degrades correctly: a scraping gap
  widens the calendar span the 4 points cover instead of emptying the chart. The revert removed
  `launch_date` (from `cli.py seed-sql`, `seed.sql` and the live DB), the `getSetting()` helper,
  and the now-unreachable `polls.chartEmpty` string. Grep-swept: no stale references.
- Drive-by, same three lines in **both** charts: the first and last x-axis ticks sit on the plot
  edges, so a centred label overflowed the viewBox and rendered clipped (`2.8.202`). Anchored
  inward.

Decisions recorded in `docs/00` §Decisions log (both the weekly-average rule and why the date
window lost).

### 7. Docs and memory

`docs/00` gained two Decisions-log rows. `docs/04`'s `app_settings` seed plan was edited and then
reverted with the `launch_date` removal. Memory updated: `live-db-mock-data` (R8 remap done +
the two traps), `launch-plan` (game_weeks regen struck off), `headless-browser-verification`
(rewritten — see findings), and a new `bidi-handle-rendering` file.

## Environment reference

Unchanged from the previous handoff. Verification commands used this session:

```sh
cd pipeline && .venv/bin/python -m pytest tests -q                    # 56 passed
cd frontend && npm run build                                          # tsc --noEmit + vite, clean
pipeline/.venv/bin/python -c "import pglast,glob; [pglast.parse_sql(open(f).read()) for f in glob.glob('supabase/**/*.sql', recursive=True)]"
cd pipeline && .venv/bin/python cli.py seed-sql > ../supabase/seed.sql
pipeline/.venv/bin/python scripts/mock_data.py seed                   # local-only script
```

**CI state at handoff:** `test` and `deploy-pages` green on all five commits. `weekly-close` and
`watchdog` green. `scrape` **still red** — `Unmapped column: 'Unity'`, last failure
2026-08-20 18:58 UTC, issue #4 open. Parked by decision until the final lists land.

**Live DB at handoff:** 42 game_weeks · 182 polls (166 approved / 8 pending / 8 rejected) ·
newest approved poll `fieldwork_end` = **2026-08-05** · 16 mock players (15 `mock_*` + `kobim`) ·
128 bets · 128 scores · 52 weekly_averages · 11 `email_signups` · 1 admin · 0007 constraints live.

## Next steps, in order

1. **Pull the dry-run week (milestone 10) forward.** Still the last launch-blocking V1 item and
   still stacked into the 09-10→09-11 overnight. It does **not** need current polls. It is also
   the only realistic way to exercise 0004's `bet_lines` lock end-to-end, which has never been
   tested for real (no Postgres+JWT harness exists).
2. **Decide the poll approve-on-review process** — the last open HIGH. Blocked on nothing
   technical; owner was thinking it through. Do **not** build it before the decision.
3. **Confirm election day 2026-10-27** against the official announcement. Carried as a working
   date since 2026-07-18, never re-verified; `is_final_week` still unset.
4. **Decide the handle charset** (new, see findings). `profiles.handle` has no charset
   constraint, so a handle can embed bidi controls to spoof another player's name on the public
   leaderboard. Fixing it decides whether Hebrew handles are allowed at all — a product call.
5. **Registry rebuild — blocked until Thursday 2026-09-10**, when the final lists publish. Then,
   in order: **uncomment the `schedule:` block in `.github/workflows/scrape.yml`** (paused
   2026-08-20, see cautions) → rebuild `registry.py` → `cli.py seed-sql` → apply → backfill
   scrape (one green run re-parses the whole table and recovers everything since 08-07) → clear
   the review queue (8 pending, oldest scraped 2026-07-11).
6. **Launch night 09-11**, now shorter: mock-data teardown → `gh variable delete
   VITE_COMING_SOON` → dispatch `deploy-pages` → email the `email_signups` list.
7. **Smaller items:** put the admin flag on the account you will actually use (see findings);
   the site has no favicon and no `public/` dir at all; consider party-filter chips on the polls
   chart (16 lines, several flat at zero for never-polled parties — the dashboard has filters,
   the polls page does not).

## Findings worth remembering

- **`polls.game_week_id` is a cached derived value.** `ingest_polls()` resolves it once from
  `week_start <= fieldwork_end <= week_end` and nothing ever recomputes it. Moving week
  boundaries strands it — 27 polls needed re-deriving during the R8 remap. Any future boundary
  change must re-derive it too. (Verified 2026-08-19.)
- **The mock seeder and the pipeline are mutually destructive.** `apply_scoring()` does
  `delete from scores where true` and the same for `weekly_averages`, and `cmd_close` ends by
  calling `cmd_score` — so **any `cli.py close` run, including the Saturday cron, wipes the mock
  leaderboard.** This had already happened before this session (that is why week 51 had 16 scores
  instead of 32). Re-seed after. `recompute` is `workflow_dispatch`-only, so only `weekly-close`
  does this on a schedule.
- **Carry-forward selects standing bets with `week_id < wk.id`** (`cli.py`), using ID order as a
  proxy for date order. True for the real schedule (seeded in date order) but *false* for the
  mock weeks, which have high IDs and June dates — which is why the R8 `close` carried 0 bets.
  Harmless today; a trap if weeks are ever inserted out of order.
- **Google Chrome is now installed on this Mac** (`/Applications/Google Chrome.app`) — the
  July note saying otherwise was wrong. The **claude-in-chrome MCP extension timed out three
  times** on `tabs_context_mcp`, and the Chrome **CLI** `--headless=new --dump-dom` hangs and
  exits **144** (the same code Arc gave). `puppeteer-core` pointed at that binary is the reliable
  path. (Verified 2026-08-19.)
- **Two screenshot-reading traps**, both of which produced a false alarm this session: a
  `fullPage` screenshot of a page with an inner scroll container renders that container at its
  natural width and looks like a broken layout — measure
  `documentElement.scrollWidth vs clientWidth` instead (measured: 0px overflow at 390px and
  1280px). And detecting error callouts by `[class*="red"]` matches Tailwind colour classes on
  ordinary numbers.
- **The i18n JSON files are ordered semantically, not alphabetically.** A `sorted()` rewrite
  produced a 457-line diff for one added key before it was caught and reverted. Add keys in place
  with a targeted edit. Key **order** is identical across locales and worth keeping that way.
- **`kobim` (Princeton email) is the admin account; `_kobim` (the Gmail account) is not.** Both
  exist in `profiles`. `mock_data.py` grants admin to `kobim` on seed and revokes it on teardown.
- The chart's four points currently span 12.7 → 2.8 rather than the last four calendar weeks,
  purely because ingest died on 08-07. It self-corrects after the backfill scrape.

## Gotchas / operational cautions

- **`scripts/` is gitignored on purpose.** The R8 conversion and the teardown FK fix in
  `mock_data.py` exist **on this machine only**. Launching from another machine means
  reconstructing it — the teardown markers are documented in the file's docstring and in the
  `live-db-mock-data` memory, so it is re-derivable, but it is not in the repo.
- **Do not re-propose a date-based window for the polls chart.** It was built and reverted the
  same session; it blanks the chart during exactly the outage conditions where someone would look
  at it. Recorded in `docs/00`.
- **Order matters if the mock data is ever re-seeded around a schedule change:** shift the real
  weeks *first*, because `teardown()` keys off `week_start < 2026-07-12` and would otherwise
  delete a real week too.
- **Do not run `cli.py close`/`score` while mock data is up** unless you intend to wipe it.
- **Do not wipe `email_signups`** (11 real signups). Teardown deliberately does not touch it.
- **The `scrape` cron is paused (2026-08-20) and must be re-enabled on 09-10.** 62 consecutive
  failures were producing ~4 emails a day against a condition that was deliberately accepted,
  which is how a real failure gets missed. The `schedule:` block in
  `.github/workflows/scrape.yml` is commented out with a dated re-enable note;
  `workflow_dispatch` still works (`gh workflow run scrape.yml`). **Nothing about the tripwire
  changed** — the scraper still aborts on an unmapped column, it is just not called on a timer.
  The 6h cron also served as the Supabase free-tier keep-alive; while paused that is covered by
  `watchdog` (every 3h, queries the DB). Verified the paused file still parses and retains
  `workflow_dispatch`.
- **Do not make the scraper tolerant of unmapped columns.** Failing on `Unity` is the merger
  tripwire working as designed (docs/06). The fix is a registry entry, never a `try`/`except`.
  Pausing the *schedule* is not the same thing and does not weaken it.
- **The watchdog reports but never escalates** — it emits its alerts and still exits 0. Unchanged
  this session; the scrape outage produces no new issue beyond #4.
- No credentials were read or written into any file this session. The publishable Supabase key
  used for local browser verification is public by design (RLS is the boundary).
