# 2026-07-27 — Zionist Home rename (merger tripwire, first live firing)

## TL;DR

The scraper had been red since 2026-07-26 ~04:00: Wikipedia renamed the Tropper-Hendel list's column from "Yesodot Yisrael" to **"Zionist Home"** (article moved; old title redirects). Treated as a rename-in-place — code `yesodot` kept, names updated to בית ציוני / Zionist Home, new alias added — in registry.py, seed.sql, and the live DB. Scrape rerun green (run 30237861087); one missed poll (Filber/Ch14, 07-26) is in the review queue. `scrape.yml` now has `issues: write` so the failure step can actually file its tripwire issue next time.

## What was done

- **Diagnosis**: 5 scheduled runs failed on `Unmapped column: 'Zionist Home'` — the docs/06 merger tripwire working as designed. The header links to `/wiki/Yesodot_Yisrael` (mw-redirect) and the EN article says "formerly known as Yesodot Yisrael", so it's the same list renamed, NOT a new party — no transition, no `active_until`, existing bets untouched.
- **registry.py**: yesodot row → name_he `בית ציוני` (confirmed vs he.wiki Tropper article), name_en `Zionist Home`; alias `zionist home` added; `yesodot yisrael` alias kept for historical tables. Also fixed a latent bug: the "curly-apostrophe variant" ra'am alias was a duplicate ASCII key — now actually `ra’am` (U+2019).
- **Live DB** (pooler, same session): `update parties …` + alias inserts for `zionist home` and curly `ra’am`. Frontend needed nothing — party names render from the DB.
- **seed.sql regenerated** — and this surfaced drift: the committed copy had pre-R7 Sunday-start game_weeks; current cli.py emits Friday-start, which matches the live DB series. The regenerated (committed) file is now the correct one.
- **scrape.yml**: added `permissions: {contents: read, issues: write}` — the auto-file-issue step had been dying on `Resource not accessible by integration`, which is why the outage surfaced as failure emails instead of one GitHub issue.
- **Docs updated**: 04 (column list), 06 (N12 label note), 08 (party table row 6). Tests 55/55 green; dry-run parses 162 polls.

## Environment reference

Unchanged. Rerun scraper: `gh workflow run scrape.yml -R k-mizrahi/polishuk-elections-2026`.

## Next steps (priority order)

1. **Clear the poll review queue — before Wednesday's finalize.** 7 pending rows: Filber/Ch14 07-26 (the outage poll), Kantar/Israel Hayom 07-23, Midgam×2 07-21, plus three old ones (Kantar 03-29, Midgam 04-23, Lazar 06-11 — likely Wikipedia-edit re-versions; review the diffs). The 36h `review_backlog` watchdog alert is presumably already tripping on the old ones.
2. **Owner eyeball**: Hebrew name בית ציוני (EN wiki romanizes "Bayit Tzioni", no definite article) and the kept #f59e0b color — one-line DB+registry fix if either is wrong.
3. Still open from before: poll approve-on-review decision (blocked on Ra'am/Joint List bloc question); behavioral trigger test for 0004; launch-day checklist in 07-18 handoff.

## Gotchas

- **`yesodot` code ≠ display name is now permanent.** Code stays for bets/polls/transitions integrity; anyone "fixing" the code to `zionist_home` breaks FKs and carry-forward remapping.
- The committed seed.sql between R7 and today was stale (wrong game_weeks) — fresh installs from it would have mismatched weeks. If a script diffs seed vs DB, regenerate seed first.
- Wikipedia's Ra'am header currently uses an ASCII apostrophe; the curly variant is now aliased too, so a typographic edit won't trip the scraper.
