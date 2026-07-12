# Handoff · 2026-07-12 — Add dedicated Rules page

Session scope: added a standalone explanations/Rules page to the frontend and shipped it. Small, self-contained change on top of the 2026-07-11 bootstrap — read `2026-07-11-bootstrap.md` for the full environment, live provisioning, and the still-open blocking items (Google OAuth, admin bootstrap). Nothing about deployment state, schema, pipeline, or the OAuth blocker changed this session.

## TL;DR

New `/rules` page (nav item "חוקים / Rules") walks players through the whole game — premise, the two weekly bets, the 120 rule, lock/reveal cycle, carried bets, scoring formulas with a worked example, merger common-partition rule, leaderboard tie-breakers, fair play, zero-poll voids. Content paraphrased faithfully from `docs/02` (normative). Built, pushed to `main` (commit `5c5810a`), Pages deploy auto-triggered. **Live at** https://k-mizrahi.github.io/polishuk-elections-2026/rules.html once the build settles.

## What was done

1. **`frontend/rules.html`** — thin page shell (h1 + lead with Hebrew fallback matching he.json, per the "HTML fallback text must equal he.json" convention); a `#root` the TS fills.
2. **`frontend/src/pages/rules.ts`** — page body built entirely from `t()` (no static-i18n duplication beyond h1/lead). Ten sections via a `section()` helper + colored callouts for the two bet types, plus the integer-bet-vs-fractional-average worked-example table (E = 10.7 → 19.3, the example docs/02 §6 says the rules page must show). Reuses the home page's `index.ex*` party-name keys for the table rows.
3. **i18n** — full `rules.*` block + `nav.rules` / `title.rules` in both `he.json` and `en.json`. Key sets verified identical (235 keys each).
4. **Wiring** — `rules` added to `NAV` in `src/lib/ui.ts` (now shows in the header on every page) and to the `pages` array in `vite.config.ts` (MPA build input). Footer "Rules" link repointed from the old `index.html#rules` anchor to `rules.html`.

The home page (`index.html`) still keeps its short "how to play" + example; the new page is the deep version. Left intentionally — see next steps.

## Environment reference

Unchanged from the bootstrap handoff. Relevant bits for this change:

| Thing | Value |
|---|---|
| Dev | `cd frontend && npm run dev` → http://localhost:5173/polishuk-elections-2026/rules.html (Node at `/opt/homebrew/bin`) |
| Build | `npm run build` (tsc --noEmit + vite; must stay clean — it is) |
| Deploy | push-to-main; `deploy-pages.yml` auto-fires on `frontend/**` path changes (no manual dispatch needed unless changing repo *variables*) |
| Key-parity check | `node -e "const he=require('./src/i18n/he.json'),en=require('./src/i18n/en.json');..."` — 235/235, no diff |

## Next steps

1. **Hebrew copy review (Kobi)** — the `rules.*` strings are my first-pass wording in the existing inclusive double-gender style (כולםן, לכםן). Fold into the already-planned Hebrew copy session (bootstrap handoff next-step 4) alongside the i18n and party-name review.
2. **Optional: thin the home page** — now that a full rules page exists, the `index.*` rules/example blocks on `index.html` are somewhat redundant. Decide whether to trim them to a teaser that links to `/rules`, or leave both. Not done pending owner call.
3. Everything from the bootstrap handoff still stands — **Google OAuth is still the single blocking item** before anyone can log in.

## Gotchas (for this change)

- Party names in the worked-example table are **reused** from the home page's `index.exLikud / exTogether / exDems / exShas` keys — don't rename those without updating `rules.ts`.
- `title.rules` feeds `document.title` via `initPage('rules')` (`${t('title.rules')} · ${app.title}`); `nav.rules` is the header label. Two separate keys by design ("חוקי המשחק" as the title, shorter "חוקים" in the nav).
- Adding a page = three touch points, all required or the page 404s / mistranslates: the `.html` file, the `vite.config.ts` `pages` array (build input), and — if it should appear in the header — the `NAV` array in `ui.ts`.
