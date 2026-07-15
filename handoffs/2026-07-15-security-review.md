# Handoff · 2026-07-15 — Security review + fixes (critical bet-lock hole, DoS, two mediums)

Session scope: ran a **comprehensive whole-app security review** (three parallel
auditors — Postgres/RLS, frontend, pipeline/CI — cross-checked against a manual
read of the schema). Found one **critical** game-integrity hole, two highs, two
mediums, plus lows. Fixed the critical, one high, and both mediums in code. No
scoring-math changes. **No live-DB changes this session** — two new migrations
are written but NOT yet applied.

> **Status at session close:** committed on branch `freshness-watchdog` (the
> security commit — see `git log`; 6 files + 2 migrations + this handoff).
> Pipeline suite **55/55**;
> `npm run build` clean (tsc + vite). **Migration 0004 APPLIED to live DB this
> session** (trigger `bet_lines_guard` present + enabled) — the critical hole is
> closed in prod. **Migration 0005 NOT applied** — it must ship in lockstep with
> the frontend deploy (tightened RLS breaks the currently-deployed archive/
> profile reads until the new JS is live). Mock data from 2026-07-13 still up.

## Where things stand

- **Security posture is solid except where noted.** No committed secrets
  anywhere; frontend is structurally XSS-clean (no `innerHTML`/`eval`, all DOM
  via text-node `append`); privilege escalation is blocked (`guard_profile_flags`
  trigger + `is_admin()` RLS on all admin-written tables); `user_id` forgery
  triple-blocked; bet validity (Σ=120, 0-or-≥4) is table-enforced; no SQL
  injection; no SSRF; no open redirect. The frontend's "verify server-side"
  worries both resolved to SAFE — the DB backstops them.
- **The one real hole was the lock/`bet_lines` gap** (now fixed in code, migration
  pending). See findings.
- **Fixed this session:** critical bet-lock bypass (0004), Wikipedia OOM DoS
  (scraper clamp), `javascript:` href at admin (safeHttpUrl), profile
  enumeration (0005 + view repoint).
- **Still open:** poll auto-approve (HIGH, design decision deferred — Kobi is
  thinking about the approve-on-review process); four LOWs.

## What changed this session

- `supabase/migrations/0004_bet_lines_lock.sql` **(new)** — adds
  `guard_bet_line_write` BEFORE trigger on `bet_lines` mirroring `guard_bet_write`
  (open week + before `lock_at` + owner + not-banned; `service_role` exempt).
  Closes the critical.
- `supabase/migrations/0005_profile_privacy.sql` **(new)** — tightens
  `profiles_select` to `id = auth.uid() or is_admin()`; adds world-readable
  `public_profiles` view (id/handle/display_name/twitter_handle/lang only, all
  handles incl. banned so presence never leaks ban status).
- `pipeline/scraper.py` — `expand_grid` now clamps rowspan(1..100)/colspan(1..200)
  and raises `ScraperError` on out-of-range or non-numeric spans (was unbounded →
  OOM). Fail-loud, consistent with the merger tripwire.
- `frontend/src/lib/ui.ts` — new `safeHttpUrl()` (drops non-http(s) URIs).
- `frontend/src/pages/admin.ts` — `source_url` link routed through `safeHttpUrl`.
- `frontend/src/pages/profile.ts`, `login.ts` — cross-user profile reads
  (public profile page, handle-availability check) repointed to `public_profiles`.
- `frontend/src/pages/archive.ts` — dropped the `profiles(handle)` FK embed
  (breaks under the tightened RLS); attributes bets to handles via a separate
  `public_profiles` lookup + client-side join.

## Findings worth remembering

- **CRITICAL — the Friday lock was enforced only on `bets`, not `bet_lines`**
  (verified 2026-07-15). `guard_bet_write` fires on `bets`, but a bet's seat
  numbers live in `bet_lines`, on which `authenticated` had full DML gated by
  ownership-only RLS + a completeness trigger that checks Σ=120 and nothing else.
  So a player could, AFTER `lock_at` (once `bets_select` reveals everyone's bets),
  rewrite their own lines via a single PostgREST bulk upsert totalling 120 —
  `guard_bet_write` never runs, `bets.updated_at` never changes, tampering is
  invisible. Same gap let a banned user keep editing. Fixed by 0004.
- **The bet-validity invariant is the *only* one done right at the table level;
  the lock was not** — worth internalizing: any future per-bet rule must be
  enforced on `bet_lines` (or via a definer RPC), not assumed from the `bets`
  guard.
- **HIGH (open, by design) — new polls auto-approve** (`cli.py:58`,
  `status="approved"`). A fabricated Wikipedia poll row (real-looking pollster,
  date in the open week, seats summing 120) passes every gate and enters scoring
  within ~6h; scoring is a pure full recompute over `approved` polls, so it
  self-heals on rerun once corrected. Kobi is deciding the approve-on-review
  process — do NOT build it yet.
- **HIGH (fixed) — Wikipedia could OOM the pipeline** via unbounded
  `rowspan`/`colspan` (`<td colspan="2000000000">`). Passed `int()`, so the
  fail-loud path missed it — died as an uncontrolled OOM + 6-hourly crash-loop.
- **Frontend admin gate is UI-only by design; all admin mutations are direct
  table writes with the anon key** — safe *only* because every admin-written
  table has an `is_admin()` RLS write policy. Confirmed all 7 covered
  (parties/aliases/transitions/game_weeks/polls/poll_results/official_results/
  app_settings + audit). If a new admin-written table is added, it MUST get an
  `is_admin()` write policy or it's wide open.
- **`leaderboard` view bypasses RLS** (no `security_invoker`, runs as owner) —
  intentional/harmless today (only public columns + already-public scores), but a
  latent leak if a sensitive column is ever added. Same applies to the new
  `public_profiles` view — keep its column list minimal.
- **Kobi is not worried about single-admin/phishing** (has 2FA on the Google
  account) — deprioritize that class.

## Next steps, in order

1. ✅ **DONE this session:** 0004 applied to live DB; scraper span-clamp test
   added (suite 55/55); work committed on `freshness-watchdog`.
2. **Apply migration 0005, THEN deploy the frontend — as one coordinated step**
   (blocked on user go-ahead for the outward-facing deploy). Order is mandatory:
   apply 0005 over the pooler, then merge `freshness-watchdog` → main so
   `deploy-pages.yml` ships the new JS. If the site is deployed *before* 0005, or
   0005 is applied *before* the deploy, the archive page and public profile pages
   break in the gap. Recommend a low-traffic window; gap should be seconds.
3. **Decide the poll approve-on-review process** (the open HIGH). Recommended
   shape: promote the N12 `GetSurveysData` feed from validate-only to a
   *corroboration gate* — auto-approve only polls that match an N12 record, else
   → review queue. Blocked on the Ra'am/Joint List bloc mapping decision (below),
   which must land first or cross-checks mismatch spuriously. **Do not build yet.**
4. **Deferred lows (deliberately not done — rationale):** `security_invoker=on`
   on `leaderboard` is **incompatible with 0005** (the view needs owner rights to
   read all profiles for the board) — leave as-is; `first_bet_at` can't be dropped
   (it's the leaderboard tiebreaker sort). `force row level security` skipped —
   real recursion risk (`profiles` policies call `is_admin()` which reads
   `profiles`; forcing RLS could recurse). Worth doing: pin GH Actions to SHAs on
   the secret-bearing workflows; validate `twitter_handle`/`party.color` on save
   (needs he/en i18n error strings).
5. **Add a behavioral trigger test** — 0004/0005 are only DDL-verified. A real
   test needs a Postgres+JWT (PostgREST) harness; a direct-postgres probe is
   unfaithful because `auth.role()` is NULL there and the guard's
   `auth.role() <> 'service_role'` short-circuits. No such harness exists yet.
6. Carried over: ratify the Ra'am/Joint List bloc question; `scripts/mock_data.py
   teardown` before launch.

## Operational cautions

- **Apply 0005 BEFORE deploying the frontend.** The frontend now reads
  `public_profiles` and tightened `profiles` RLS; if the view doesn't exist yet,
  the public profile page and archive bet-attribution break. Migration first,
  Pages deploy second.
- **The critical is live until 0004 is applied.** Until then, treat any post-lock
  bet as potentially mutable — if a scored week looks off, check `bet_lines`
  against expectations. (No evidence of exploitation; the game may not be public.)
- **Do not build the approve-on-review poll gate yet** — Kobi is deciding the
  process. And do not flip `cli.py` poll default to `pending` unilaterally.
- **Still no ingest of outlet numbers** (N12/Kan) — validation/corroboration only,
  per 2026-07-14. That constraint stands even if N12 becomes an approve gate.
- Nothing was committed or pushed; no live DB touched. A future session can
  verify all claims from `git diff` + the two new migration files.
