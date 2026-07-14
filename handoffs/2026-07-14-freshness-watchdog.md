# Handoff · 2026-07-14 — Freshness watchdog + N12 cross-source validation

Session scope: added a **freshness/heartbeat watchdog** (a new cron leg that
catches the silent gaps a failed scrape can't report), discovered N12's real
structured poll API and used it to **validate our Wikipedia numbers**, and
cleaned 8 junk rows out of the live review queue. No scoring-math or schema
changes. One live-DB data change (queue hygiene, reversible).

> **Status at session close:** code + docs staged, being committed on a branch
> (`git status` shows the six files below). Live DB: 8 pending poll rows flipped
> to `rejected` (queue 11→3). No rescore triggered — rejected rows were never
> scored. Mock data from the 2026-07-13 batch is **still up** (see next steps).

## Where things stand

- **Watchdog is a new pipeline leg**: `pipeline/watchdog.py` + `cli.py watchdog`
  + `.github/workflows/watchdog.yml` (cron every 3h). Emits GitHub-issue alerts
  on breach. 17 pure unit tests; full suite **52 passing** (was 35).
- **Scraper now stamps a heartbeat**: every successful `cli.py scrape` sets
  `app_settings.last_scrape_ok_at` (both the ingest path and the revid-unchanged
  keep-alive path). This is the "did we miss runs?" signal — independent of
  which runner ran the scrape.
- **Wikipedia numbers are validated against N12** (2026-07-14): 74 same-pollster,
  same-date pairs, **63/74 seat-identical** after reconciling two bloc-classification
  differences. Wikipedia is trustworthy. See findings.
- **Live review queue: 3 pending** (ids 32, 75, 88 — real polls with seat-sum
  anomalies, awaiting manual correction). The 8 secondary-scenario fragments are
  rejected.

## What changed this session

- `pipeline/watchdog.py` **(new)** — pure check functions (heartbeat, poll
  freshness, review backlog, outlet diff) below a thin I/O layer, mirroring
  `scraper.py`'s structure. `OUTLETS` = {n12 (reachable), kan (expected_blocked)}.
- `pipeline/tests/test_watchdog.py` **(new)** — 17 tests, state-in/alerts-out.
- `.github/workflows/watchdog.yml` **(new)** — every-3h cron; on breach files/
  comments a single rolling "Freshness watchdog" GitHub issue (same pattern as
  `scrape.yml`'s failure handler).
- `pipeline/cli.py` — added `cmd_watchdog`; heartbeat stamp in `cmd_scrape`.
- `docs/06-game-ops.md` — watchdog to the weekly-cadence table + a runbook with
  the alert-code table; a "Cross-source spot-check (N12 structured API)" section
  with the endpoint and the two known bloc differences.
- `.github/workflows/README.md` — list the new workflow + heartbeat.

## Findings worth remembering

- **N12 has a real, open JSON poll API** (verified 2026-07-14):
  `https://mako_elections.devdinocdn.com/Home/GetSurveysData` — no auth, no
  Cloudflare. `data.surveys[]` = `{surveyCreatorId, surveyDate,
  surveyResults:[{partyId,result}]}`, with `data.parties[]`/`data.surveyCreators[]`
  as lookup arrays (108 surveys, Hebrew names). The public page
  (`special.n12.co.il/elections2026`) is a Storycards shell → its `story.json`
  is a page-builder tree with **no numbers** in it; the numbers load from this
  devdino endpoint at runtime. Use it to **validate, not ingest** (copyright +
  shape drift — same reason we don't ingest any outlet).
- **Kan is unwatchable from CI** (verified 2026-07-14): `www.kan.org.il` sits
  behind a hard Cloudflare wall (Error 1000S) that returns 403 to curl,
  WebFetch, and any headless runner. Registered as `expected_blocked` so the
  watchdog stays quiet but flips an alert the day it opens up. Kan's polls are
  Kantar-commissioned and already reach us via Wikipedia regardless.
- **Two bloc-classification differences vs N12 — NOT data errors** (they
  reconcile to the seat): (1) our `registry.py` folds **Ra'am** into the
  `joint_list` bloc; N12 lists it separately. (2) **Tropper-Handel = Yesodot**,
  same party different label. On recent polls the components sum exactly to our
  bloc totals; older polls (Feb/May) show 2-4 seat residual drift on the Arab-
  party bloc worth an eventual look. **Open question:** should Ra'am be its own
  bettable line? That's scoring-semantics (docs/02 §6) — flagged, not decided.
- **The "05-25 broken row" was never broken** — it's a secondary *scenario* row
  (Σ=64, `?` cells) correctly flagged `is_secondary`, anomaly-logged, and
  quarantined as `pending`. Scoring only reads `status=approved`, so it never
  affected anything. The apparent break was my comparison script including
  secondary rows; the pipeline was correct.
- **GitHub disables scheduled workflows after 60 days of repo inactivity** — a
  real silent-failure mode the heartbeat catches (no run ⇒ stale
  `last_scrape_ok_at` ⇒ alert). Any push re-enables schedules.
- Watchdog thresholds live in code (`watchdog.DEFAULTS`: scrape 12h, polls 9d,
  review 36h, outlet grace 18h) and are overridable at runtime via
  `app_settings.watchdog_config` (partial override merges over defaults).
- `import watchdog` resolves to our local module, not the PyPI `watchdog`
  package, because `pipeline/` is `sys.path[0]` under `python cli.py` (verified).

## Live DB changes applied this session

- **8 pending poll rows → `rejected`** (ids 127, 118, 115, 112, 104, 49, 45, 41),
  each an `is_secondary` scenario fragment confirmed via row_fingerprint match
  against a live Wikipedia parse. `admin_note` appended with a dated rejection
  reason. Reversible (flip `status` back). Review queue: 11 → **3** (32, 75, 88).
- New `app_settings` keys autocreate on first real run: `last_scrape_ok_at`
  (heartbeat), `watchdog_state` (outlet marker/moved handshake). Not in
  `seed.sql` — runtime-managed, like `last_scraped_revid`.

## Next steps, in order

1. **Correct the 3 remaining review-queue polls** (ids 88 Σ=121, 75 Σ=118,
   32 Σ=117 — real seat-sum anomalies) in the admin console, then they clear.
   The watchdog's `review_backlog` alert will nag until they're handled.
2. **Ratify (or reject) the Ra'am / Joint List bloc question** — the one real
   systematic gap. If Ra'am becomes its own line it's a `registry.py` +
   docs/02 §6 + rescore change; record the decision when ratified.
3. **Optional watchdog upgrade** (offered, not built): turn the N12
   `GetSurveysData` feed into an automated *number* cross-validator — diff N12 vs
   our DB each run, alert only on post-reconciliation discrepancies. The
   reconciliation logic exists in this session's scratch (`/tmp/cmp2.py` — not
   committed).
4. **Before real launch: `scripts/mock_data.py teardown`** (carried over from
   2026-07-13 — still not done).

## Operational cautions

- **Do not ingest outlet numbers** (N12/Kan) — validation only. Copyright +
  unstable shape; Wikipedia (CC-BY-SA) stays the single source of truth. The
  scraper's fail-loud merger tripwire depends on that single-source design.
- **The 3 kept review-queue rows are real polls, not junk** — correct them,
  don't reject them. Only `is_secondary` fragments were rejected this session.
- Watchdog `probe_outlet` uses a deliberate try/except (unreachable → alert, not
  a swallowed error) — this is the one sanctioned exception to the no-bare-except
  rule; it stays loud.
- Rejecting the 8 rows changed **no scores** (they were never `approved`). If a
  future rescore looks different, it is not from this change.
