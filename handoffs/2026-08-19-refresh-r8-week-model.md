# 2026-08-19 — Doc refresh, launch reschedule, R8 Sunday→Saturday week model

## TL;DR

A `/refresh` audit turned into a schedule + game-mechanics change. Three things happened, in order:

1. **Audit found the scraper has been red since 2026-08-07** — `Unmapped column: 'Unity'`, ~50 failed runs, tripwire issue #4 open, no poll ingested for 13 days. Owner decision: **park it** until the final party lists land, then rebuild the registry in one pass. Safe because a scrape re-parses the *whole* Wikipedia table on any revid change, so one green run backfills the entire gap.
2. **Launch rescheduled twice**, ending at: final lists **Thursday 2026-09-10** → launch **Friday morning 2026-09-11** → first lock **Saturday 09-12 midnight** → first playable week **09-13→09-19**. (Was 09-08, then 09-12.)
3. **R8 — the week model moved to Sunday→Saturday with a Saturday-midnight lock.** Code, docs, copy and `seed.sql` are done and verified. **The live DB is not** — see cautions.

Everything is uncommitted on `main` (21 modified files, HEAD still `155ec89`). Tests 56/56, `tsc --noEmit` + vite build clean, SQL parses.

## What was done

### Refresh audit (the part that was actually /refresh)

- **CLAUDE.md gained the two missing standard sections**: `## Key decisions — don't re-litigate` and `## Status / where we stand` (which now holds the `Last refresh: 2026-08-19 @ 155ec89` checkpoint line). The duplicated status claim was trimmed out of "What this is".
- **Scoring-constants drift fixed in three places.** `docs/04` §5 seed plan still specified `{poll: {base:30}, final: {base:100, per_seat:2}}`; `docs/02` §4 has said owner-approved `{poll:100, final:150}` since 07-13 and `pipeline/scoring.py:17-18` matches it. `docs/00`'s Decisions row and open item also still called the constants unsigned. All three corrected to the shipped values.
- **`docs/07` Status rewritten** (was dated 2026-07-11, still claimed Google OAuth and the admin bootstrap were pending — both done 07-12).
- **Three ratified decisions that lived only in handoffs/memory** were written into `docs/00`'s Decisions log: the launch date + coming-soon gate, Wikipedia-as-sole-ingest-source (N12/Kan validate-only), and party codes being permanent (`yesodot` ≠ "Zionist Home").
- **Open security items promoted out of session memory** into a new table in `docs/06` under the risk register — the poll auto-approve gate plus the four LOWs from the 07-15 review. The memory file is now a pointer.
- **Memory pruned and re-indexed**: `security-review-2026-07-15` slimmed to a pointer; `live-db-mock-data`'s "not yet committed/pushed" claim corrected (it shipped in `c1fd6d4`); `raam-jointlist-bloc-open` made accurate against the current registry (raam is a live bettable line *and* has a 06-10 transition into `joint_list`); `launch-plan` reduced to the operational checklist.
- Banned-pattern sweep clean: no physical CSS utilities (`ml-*`/`text-left`) anywhere in the frontend.

### R8 — Sunday→Saturday week, Saturday-midnight lock

Owner asked for "bets until Saturday night" + "launch Friday morning". A Saturday-night lock sits ~33h *inside* a Friday-start week, so a poll fielded Fri/Sat and published Friday night could be public before lock and still count toward the week being bet on. Owner chose to move the week boundary rather than accept that. Owner then specified the lock time as **midnight**, which lands exactly on the new boundary.

- **`pipeline/gameweeks.py`** — `SUNDAY = 6`, `LOCK_TIME = time(0, 0)`; `lock_at_for()` returns the week's own Sunday 00:00 IL. Lock instant == week start instant, by construction.
- **`pipeline/tests/test_weekly_close.py`** — calendar assertions updated (summer 21:00 UTC / winter 22:00 UTC, DST-correct), plus a new `test_lock_coincides_with_week_start` pinning the invariant across three dates spanning a DST flip.
- **`.github/workflows/weekly-close.yml`** — close cron moved to `5 21 * * SAT` / `5 22 * * SAT` (= Sun 00:05 IL either offset). The DST guard now accepts local hour `00` (close) or `12` (Wednesday finalize), rewritten as a readable `if` instead of the old `&&`/`||` one-liner. Verified by simulation that exactly one cron of each pair fires per week in both seasons.
- **`supabase/seed.sql`** regenerated via `cli.py seed-sql` — 38 `game_weeks` rows, now Sunday-start with Saturday-midnight locks.
- **Specs**: `docs/02` §2 (window + membership) and §7 (anti-sniping argument re-derived — it is now closed by construction, not by a "<1 seat" magnitude argument), `docs/00` glossary + Decisions log + lock-time open item, `docs/01`, `docs/03`, `docs/04`, `docs/05` §6, `docs/06` weekly cycle + admin checklist + risk register.
- **`docs/09`**: R7's entry left intact as the historical record, marked superseded; a new **R8** entry records what changed and why.
- **Copy**: every "Friday 12:00" / "Friday to Friday" string in `he.json`/`en.json` moved to Saturday-midnight / Sunday-to-Saturday, and the four HTML fallbacks re-synced to `he.json`.
- **`frontend/src/pages/dashboard.ts`** — `weekBuckets()` was real logic, not just a comment: it bucketed `fieldwork_end` to Fridays via `(getUTCDay() - 5 + 7) % 7`. Now buckets to Sundays (`- getUTCDay()`).

### Separate bug found en route

`index.rule5` and `index.exampleTotal` still advertised the **old** scoring caps — "up to 30 points a week… 19.3 out of 30" — while the Rules page correctly said 100/150. The 2026-07-13 constants change updated `rules.*` and missed `index.*`. Fixed in both locales; the worked example now reads **89.3 out of 100**, matching docs/02 Example A (which is milestone 7's acceptance criterion).

## Environment reference

Unchanged. Verification commands used this session:

```sh
cd pipeline && .venv/bin/python -m pytest tests -q          # 56 passed
cd frontend && npm run build                                # tsc --noEmit + vite, clean
pipeline/.venv/bin/python -c "import pglast,glob; [pglast.parse_sql(open(f).read()) for f in glob.glob('supabase/**/*.sql', recursive=True)]"
cd pipeline && .venv/bin/python cli.py seed-sql > ../supabase/seed.sql
```

CI state at handoff: `watchdog` green (4 standing alerts, exits 0), `weekly-close` green, `scrape` **red** since 2026-08-07, issue #4 open.

## Next steps (priority order)

1. **Commit this batch.** 21 modified files, nothing pushed. Note `AGENTS.md` (untracked symlink → `CLAUDE.md`, from the dual-agent migration) and the uncommitted addendum in the 07-27 handoff are also still sitting there — decide whether they go in the same commit.
2. **Decide whether the dry-run week moves earlier.** Milestone 10 is the last launch-blocking V1 item, it does **not** need current polls, and right now it is stacked into the same 09-10→09-11 overnight as everything else. It is the only item in that window that can be pulled forward onto the existing stale poll set. Decide before 09-10.
3. **Regenerate the live `game_weeks` to R8 before launch.** Blocked until you're ready to touch prod; must happen before the gate flips. Same operation as R7's in-place remap, over the pooler. See cautions.
4. **09-10→09-11 launch runbook**, in order: rebuild `registry.py` against the final lists (this is where `Unity` and anything else new gets mapped) → `cli.py seed-sql` → apply → regenerate live `game_weeks` → backfill scrape → clear the review queue → `scripts/mock_data.py teardown` → `gh variable delete VITE_COMING_SOON` + dispatch `deploy-pages`.
5. **Still open from before**: the poll approve-on-review decision (owner wants to think through the process; blocked on nothing technical), the Ra'am/Joint List bloc semantics question, and the four LOW security items — all now tracked in `docs/06` and `docs/00`'s open items rather than in session memory.
6. **Confirm election day 2026-10-27.** Carried as a working date since 07-18 and never re-verified against the official announcement; `docs/00` flags it. `is_final_week` still unset.

## Findings worth remembering

- **The scrape outage is recoverable, and that is why parking it is safe.** `cli.py:30-35` fetches the page, compares `revid`, and on any change re-parses the **entire** table — there is no incremental cursor. So the first green run after the registry rebuild re-ingests every poll missed since 08-07. Verified by reading the code, 2026-08-19. The polls are not lost; they are sitting on Wikipedia.
- **The watchdog reports but never escalates.** It correctly emitted all four alerts (`stale_scrape` 307h, `stale_polls` 14d, `review_backlog` 8 polls / oldest 936h, `outlet_ahead`) and still **exited 0**, so the 13-day outage produced no issue beyond the one the scrape job itself filed on day one. If you want an outage to interrupt you, that exit code is the thing to change.
- **The old lock sat inside the week it governed.** `docs/00`'s glossary said "Friday 12:00 *preceding* week *w*", but `gameweeks.py` used the week's *own* Friday noon — 12 hours after the week opened. The doc and the code had disagreed since R7; R8 removes the ambiguity by making lock == week start. Worth knowing if you read old handoffs.
- **`npm run build` green still does not mean the page renders** (see the `headless-browser-verification` memory). Nothing in this session was verified in a browser — the i18n and dashboard changes are build-clean and invariant-checked, not eyeballed.
- **i18n invariants are cheap to check and were both holding at handoff**: 258 keys in each locale with no drift, and every `data-i18n` HTML fallback byte-equal to `he.json`.
- The two locales' Rules pages and index page had silently disagreed about the scoring caps for **five weeks** (07-13 → 08-19) without anyone noticing. Whatever else changes, a constants change needs a grep for the *numbers*, not just the keys.

## Gotchas / operational cautions

- **Do NOT flip the coming-soon gate before the live `game_weeks` are regenerated.** Code, docs and `seed.sql` are R8 (Sunday weeks, Saturday-midnight locks); the live rows are still R7 Friday weeks with Friday-noon `lock_at`. Launch against the current live schedule and week one locks at the wrong instant, in public.
- **Never hand-edit `seed.sql`.** It is generated — edit `pipeline/registry.py`, then `cli.py seed-sql`. The regenerated file in this batch is correct; a hand-patch would silently diverge from the registry.
- **Do not "fix" the lock back to an offset inside the week.** Lock == week start is load-bearing: it is what makes the anti-sniping property hold by construction (docs/02 §7). Recorded as an invariant in CLAUDE.md for exactly this reason.
- **Do not make the scraper tolerant of unmapped columns.** Failing on `Unity` is the merger tripwire doing its job (docs/06 runbook). The fix is a registry entry, never a `try`/`except`.
- **Do not wipe `email_signups`** at mock-data teardown — it holds real signups from the owner's outreach, and `scripts/mock_data.py teardown` deliberately does not touch it.
- Nothing in this session touched the live database, and no credentials were read.
