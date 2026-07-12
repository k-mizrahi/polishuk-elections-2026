# 08 · Final party slate — 2026 Knesset elections (PLACEHOLDER)

**Status: ⬜ PENDING — lists not yet final.** Fill this in once the Central Elections
Committee publishes the final, confirmed list of parties running. This doc is the
**human worksheet**; it is *not* a data source. Once confirmed, reconcile it into
`pipeline/registry.py`, then regenerate the seed:

```sh
cd pipeline
.venv/bin/python cli.py seed-sql > ../supabase/seed.sql   # then apply to DB (docs/06)
```

The registry stays the single source of truth (the one-way flow in CLAUDE.md). This
worksheet just tracks *which* parties are final and their launch-time details before
they land in code.

## Deadlines to track

- ⬜ Final list-submission deadline (Central Elections Committee): _TBD_
- ⬜ Final ballot-letter / party-name confirmation: _TBD_
- ⬜ Our launch date (after slate is final): _TBD_

## Confirmed running slate

For each party set: `code` (kebab, stable), Hebrew name (official), English name,
brand color (hex), and whether currently in the registry. Add/remove rows to match
the real final list — **placeholders below, verify every one.**

| # | code | name_he (official) | name_en | color | in registry.py? | notes |
|---|------|--------------------|---------|-------|-----------------|-------|
| 1 | likud | הליכוד | Likud | #1d4ed8 | yes | verify color/name |
| 2 | together | ביחד | Together | #0ea5e9 | yes | ⚠️ he name was a guess |
| 3 | yashar | ישר | Yashar | #7c3aed | yes | verify |
| 4 | democrats | הדמוקרטים | The Democrats | #16a34a | yes | verify |
| 5 | blue_white | כחול לבן | Blue & White | #38bdf8 | yes | verify still running |
| 6 | yesodot | יסודות ישראל | Yesodot Yisrael | #f59e0b | yes | verify |
| 7 | shas | ש"ס | Shas | #111827 | yes | verify |
| 8 | utj | יהדות התורה | United Torah Judaism | #374151 | yes | verify |
| 9 | rzp | הציונות הדתית | Religious Zionist Party | #365314 | yes | verify (joint w/ Otzma?) |
| 10 | otzma | עוצמה יהודית | Otzma Yehudit | #78350f | yes | verify (joint w/ RZP?) |
| 11 | yisrael_beiteinu | ישראל ביתנו | Yisrael Beiteinu | #0f766e | yes | verify |
| 12 | raam | רע"מ | Ra'am | #065f46 | yes | verify (running solo or in Joint List?) |
| 13 | joint_list | הרשימה המשותפת | Joint List | #b91c1c | yes | verify composition |
| _ | _TBD_ | _new party?_ | _TBD_ | _TBD_ | no | add any new registrant |

## Not running in 2026 (historical — keep in registry for backfill only)

These stay in `registry.py` with an `active_until` date so old polls/transitions still
score, but they must **not** appear as bettable parties in the UI.

| code | name_en | why historical |
|------|---------|----------------|
| yesh_atid | Yesh Atid | merged → together (2026-04-26) |
| bennett_2026 | Bennett 2026 | merged → together (2026-04-26) |
| reservists | Reservists | merged → yesodot (2026-07-06) |

## Sign-off checklist (before launch)

- ⬜ Every running party in the table above exists in `registry.py` with correct
  `code`, `name_he`, `name_en`, `color`, `active_from`, `sort_order`.
- ⬜ Any party that dropped out has an `active_until` set (won't show as bettable).
- ⬜ Mergers/splits since last update captured in `TRANSITIONS` (docs/02 §6 scoring).
- ⬜ Wikipedia column headers for the final slate mapped in `ALIASES` (docs/05).
- ⬜ `python cli.py seed-sql` regenerated and applied to the live DB.
- ⬜ Frontend party list/colors reflect the final slate (verify bets + polls pages).
- ⬜ Scoring constants frozen (docs/02 §3–4).
