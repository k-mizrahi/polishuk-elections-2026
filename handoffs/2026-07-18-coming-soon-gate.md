# 2026-07-18 — Coming-soon gate live + email_signups

## TL;DR

The live site now shows ONLY a bilingual coming-soon landing page ("opening September 8, 2026"; elections Oct 27). All game pages 404 in production. Email-signup mailing list is live (migration 0006 applied). Launch on 2026-09-08 = delete one repo variable + redeploy. PR #3 merged; PR #2 was merged earlier.

## What was done

- **PR #3** (`coming-soon-landing`, squash-merged to main): `frontend/coming-soon.html` + `src/pages/coming-soon.ts` (no `initPage()`/header — nothing to link to), 8 new `soon.*` i18n keys (parity 258), build gate in `vite.config.ts`, `VITE_COMING_SOON` line in `deploy-pages.yml`, `@types/node` devDep (+ `"node"` in tsconfig `types` — needed for the fs rename plugin in vite config).
- **Build gate mechanism**: `VITE_COMING_SOON=1` → rollup input is only `coming-soon.html`; a `closeBundle` plugin renames `dist/coming-soon.html` → `dist/index.html`. Unset → normal 10-page build, untouched code path.
- **Migration `0006_email_signups.sql` applied to prod**: `email_signups` table (RLS default-deny, default-privilege SELECT revoked) + `subscribe_email(text)` security-definer RPC granted to anon/authenticated. Validates, lowercases, on-conflict-do-nothing.
- **Deployed**: repo var `VITE_COMING_SOON=1` set, deploy-pages dispatched (run 29650450165, success).
- **Verified**: both build modes clean; headless render he/en (RTL flip, form, client validation); RPC hardening against prod — valid 204, dupe 204 (no existence leak), invalid 400, anon SELECT → 42501; lowercasing confirmed; test row deleted; live root 200 with Sept-8 copy, polls/login/admin 404.

## Environment reference

- Coming-soon toggle: repo Actions variable `VITE_COMING_SOON` (`gh variable set/delete … -R k-mizrahi/polishuk-elections-2026`), then `gh workflow run deploy-pages`. Merge-triggered deploys also respect it.
- Mailing list export (postgres over pooler): `select email from email_signups`.

## Next steps (priority order)

1. **Kobi emails invitees** with https://k-mizrahi.github.io/polishuk-elections-2026/ (that was the point).
2. **Launch day 2026-09-08**: `gh variable delete VITE_COMING_SOON` + dispatch deploy-pages; before that, `scripts/mock_data.py teardown` (prod DB still holds mock players/weeks and 139 mixed polls); email the signup list a launch link.
3. Still open from before: poll approve-on-review decision (blocked on Ra'am/Joint List bloc question); behavioral trigger test for migration 0004.

## Gotchas

- **Any merge to main touching `frontend/**` redeploys the coming-soon build** — safe (variable is read at build time), but remember the live site stays gated until the variable is deleted, no matter what you merge.
- `vite preview` serves the landing for ANY path in coming-soon mode (SPA fallback) — looks like a leak locally, isn't: `dist/` has only `index.html`, and GitHub Pages 404s missing files (verified live).
- `email_signups` is NOT covered by `mock_data.py teardown` — real signups live there; don't wipe it at launch.
- Landing page skips `initPage()` on purpose; if you add site chrome to it, you'll reintroduce nav links to pages that don't exist pre-launch.
