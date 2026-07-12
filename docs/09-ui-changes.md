# 09 — UI Changes

A running list of UI change tasks. Each task is captured here first, then implemented separately. This doc is the source of truth for *what* should change; the code is the source of truth for *what has* changed.

Status legend: 🔲 todo · 🚧 in progress · ✅ done

> **Cross-doc note:** several tasks below also touch the normative specs (`docs/02` scoring, `docs/04` data model) and the `pipeline/`. Those are flagged **⚠️ spec/pipeline dependency** so we don't ship a rules page that contradicts the engine. Rules-page copy and engine must change together.

---

## Batch 1 — Rules page (`frontend/rules.html`, `frontend/src/pages/rules.ts`, i18n `rules.*`)

### R1 · About intro: polls are for *next week* ✅
Clarify in the opening section that the poll bet targets **next week's** poll average, not this week's.

- **Where:** `rules.aboutBody`.
- **Change:** the phrase `…גם בבחירות עצמן וגם בסקרים…` → `…גם בבחירות עצמן וגם בסקרים של שבוע הבא…`.
- Pure copy change. `rules.pollBody` already says "שבוע הקרוב", so this just makes the intro consistent. Mirror in `en.json`.

---

### R2 · New scoring: stop losing information on large errors ✅ ⚠️ spec/pipeline dependency
Drop the `30 − E` idea because the `max(0, …)` floor collapses every large error to 0 — big misses become indistinguishable.

**Reframe:** keep the *distance* (total absolute seat error, `E = Σ_p |bet_p − actual_p|`). It is intuitive ("total seats you were off") and already loses nothing. The information loss is in the **score transform's floor**, not the distance. Fix the transform.

Three options to choose from (all keep the same `E` distance):

| # | Transform | Keeps info on big errors? | Incentive-compatible (median-optimal)? | Positive & bounded? | Feel |
|---|---|---|---|---|---|
| **1 (rec.)** | `max(0, M − E)` with **M raised well above realistic max E** (e.g. M≈120) so the floor almost never binds | ✅ across the entire plausible range | ✅ exactly (unchanged structure) | ✅ | Same as today, just bigger numbers; least disruptive |
| 2 | `M − E`, **no floor** (weeks can go negative) | ✅ fully | ✅ exactly | ❌ can go negative | Purest; a disastrous week can cost you points |
| 3 | Exponential decay `M · 2^(−E/H)` — every `H` seats of error halves your points | ✅ (strictly decreasing, never hits 0) | ⚠️ slight departure (optimum becomes mode-like, not the L1 median) | ✅ (0, M] | Very tweetable ("every H seats halves it"), small numbers |

**Recommendation: Option 1.** It directly fixes the complaint (raise the cap so the floor stops eating the tail), keeps all four design principles in `docs/02` §5 intact (still simple, still incentive-compatible, still equal-weight-per-week), and is the smallest change to `scoring.py`. Realistic total poll error runs ~8–14 seats and finals ~20–30; a cap around 120 means only troll/random bets ever floor.

- **Rules-page copy affected:** `rules.scoreIntro`, `rules.scoreErr`, `rules.scorePollFormula`, `rules.scoreFinalFormula`, and the worked-example total `rules.exampleTotal` (recompute with the new M).
- **⚠️ spec/pipeline:** `docs/02` §3 and §4 formulas; `app_settings.scoring_constants`; `pipeline/scoring.py`; `pipeline/tests/test_scoring.py` worked-example expectations.
- **Open decision for owner:** pick Option 1/2/3, then pick the actual constant(s).

---

### R3 · Final bet worth 50% more than polls (not ~triple) ✅ ⚠️ spec/pipeline dependency
Today finals aggregate to ~2.5–3× poll points (`docs/02` §4). Rebalance so a final week is worth **1.5×** a poll week.

- **Implementation:** with the R2 transform, set the final per-week max `M_final = 1.5 · M_poll`. Final and poll bets are both scored once per week, so per-week ratio ≈ aggregate ratio ⇒ ~1.5×.
- **Rules-page copy affected:** `rules.finalBody` ("שווה הכי הרבה נקודות"), `rules.scoreFinalFormula`, and the aggregate-weighting note.
- **⚠️ spec/pipeline:** `docs/02` §4 "Aggregate weighting check"; the stored constants.

---

### R4 · Remove mergers & splits ✅ ⚠️ spec/pipeline dependency
We publish only after the party lists are **final and official**, so no mid-game mergers/splits can occur.

- **Remove from rules page:** the entire `rules.mergeTitle` / `rules.mergeBody` / `rules.mergeExample` section (rules.ts line ~93).
- **Also trim:** the carried-forward copy `rules.carriedBody` — drop the clause `…כולל התאמה אוטומטית למיזוגי מפלגות…`.
- **⚠️ spec/pipeline:** this is the visible tip of the common-partition machinery (`docs/02` §6, `party_transitions` in `docs/04`, the partition logic in `scoring.py`, and `test_scoring.py::test_doc02_example_b_merger_scored_as_bloc`). Removing the *copy* is safe now; decide separately whether to also retire the underlying feature or keep it dormant as insurance. **Recommend keeping the engine code dormant** (cheap insurance if a list somehow changes) but removing it from the player-facing rules.

---

### R5 · Remove tie-breakers text ✅
- **Remove:** `rules.lbTie` (the "שוברי שוויון, לפי הסדר…" paragraph) from the leaderboard section (rules.ts line ~95, second `p`).
- Keep `rules.lbBody`. The engine can still break ties deterministically; we just don't advertise the ladder.
- Note: `docs/02` §5 still documents the internal tie-break order — that's fine, it's a spec, not player copy.

---

### R6 · Remove fair-play text ✅
- **Remove:** the entire `rules.fairTitle` / `rules.fairBody` section (rules.ts line ~97).

---

### R7 · Friday→Friday poll window ✅ ⚠️ spec/pipeline dependency
Poll copy + the actual measurement window now say/count **Friday to Friday**.

**Decisions made:** date basis = **fieldwork_end** (Wikipedia has no publication date; confirmed by inspecting the live fixture); week model = **Friday 00:00 → Thursday 23:59**, bets lock at the week's own **Friday 12:00**. Done as a full spec + pipeline + live-schedule migration.

Shipped:
- **Copy:** new `rules.pollsTitle`/`rules.pollsBody` ("published Friday to Friday") + updated `polls.lead` (+ HTML fallback).
- **Pipeline:** `gameweeks.py` now Friday→Thursday, lock at the week's Friday noon; `test_weekly_close.py` updated.
- **Schema:** migration `0003_publication_date.sql` adds a **nullable `polls.publication_date`** (future-use; membership still keys on `fieldwork_end`, since Wikipedia lists no publication date).
- **Spec:** `docs/02` §2 (window + membership) and §7 (re-derived anti-sniping argument for the Friday model — residual one-poll edge is <1 seat on the unweighted mean); `docs/04` (game_weeks + publication_date), `docs/00`/`01`/`05`/`06` week-model references.
- **Live DB:** all 38 `game_weeks` remapped in place to Friday weeks (open week now 07-17→07-23); approved polls reassigned by fieldwork_end (historical polls remain pre-schedule/unassigned, as before).
- **Residual (flagged):** "published" in the rules is colloquial — internally it's the fieldwork date. A true publication-date basis needs a real source (the `publication_date` column is ready for it).

---

## Batch 2 — Polls page (`frontend/polls.html`, `frontend/src/pages/polls.ts`, i18n `polls.*`)

### P1 · Replace the wide table with a graphical UI ✅
Today the page renders one big `wideTable`: rows = approved polls (newest first), columns = date / pollster / publisher / sample + one seat column per party, with a highlighted current-week running-average row on top. It gets very wide (~10–15 party columns) and reads poorly, especially on mobile / RTL.

**Recommended design — a poll-tracking trend chart:**
- **Time-series line chart:** x = poll date (`fieldwork_end`), y = seats; **one line per party**, showing how each party's polling has moved over the campaign. This is the standard "poll of polls" view and answers the real question (who's trending up/down) far better than a table.
- Optionally overlay the individual poll points as dots and draw the line through the weekly average.
- **Reuse existing party colors** from `partyChip` so the chart matches chips elsewhere; legend from the same source.
- Keep the **current-week running average** as a summary (chip row or the chart's latest point), preserving today's client-side average computation.

**Implementation approach:** hand-rolled inline **SVG** (no chart library) — fits the vanilla-TS / no-framework / self-contained-build ethos; no CDN dependency. Add a small chart helper to `lib/ui`.

**Things to handle:**
- **Clutter:** ~10–15 lines is a lot. Options — highlight-on-hover + dimmed rest, a legend that toggles parties, or plot top-N by latest seats and fold the rest. (Open decision.)
- **Interactivity:** hover/tap tooltip showing date + per-party seats for that poll.
- **RTL:** time axis direction and tooltip anchoring must respect `dir`; use logical positioning.
- **Mobile:** responsive width, `overflow-x:auto` if a minimum width is needed; touch-friendly tooltips.
- **Sub-threshold / missing:** current table shows `N%` / `–`; decide how the chart treats 0-seat / below-threshold points (drop to 0 vs. gap).

**Open decisions for owner:**
- Chart type: **time-series line** (recommended) vs. latest-poll bar chart vs. small-multiples per party.
- Keep the detailed table too (as a "table view" toggle or moved to archive) or drop it entirely?
- Clutter strategy (hover-highlight / legend toggle / top-N).

---

## Batch 3 — Bets page (`frontend/src/pages/bets.ts`, i18n `bets.*`)

### B1 · Default to last week's *bet*, drop the "start from last week's average" button ✅
Replace the quick-fill button `bets.prefillAvg` ("התחילו מממוצע השבוע שעבר") — which seeds the form from **last week's poll average** — with the form simply **defaulting to the player's own bet from last week**.

- **Remove:** the `prefillBtn` (`bets.prefillAvg`) and its `prevAverages()` machinery (the `weekly_averages` fetch + `roundTo120`) in `bets.ts` (lines ~79–97, 145–150, and the button in the button row line ~158).
- **Remove i18n key:** `bets.prefillAvg` (he + en).
- **Default behavior:** the form should open pre-filled with last week's bet for that kind.
  - **Note — mostly already true:** the weekly carry-forward (`weekly_close.py`) auto-rolls the last standing bet into the new open week, so `bets.get(kind)` is already last week's bet and the form seeds from it via `linesToValues`. In the common case this task is *just removing the average button* — the "default to last week's bet" already holds.
  - **Edge case to confirm:** a player who has a prior-week bet but **no** carried row for the open week (shouldn't normally happen given carry-forward) would still open empty. If we want the default to cover that too, add an explicit fallback that fetches the player's own previous-week bet for that kind and seeds the form when there's no standing bet.
- **Keep:** the "copy from final bet" button (`bets.copyFinal`) on the poll card and the carried-bet banner (`bets.carried` / `bets.carriedUnknown`) — unaffected.

**Open decision for owner:** purely automatic default (no button), or also keep a manual "reset to last week's bet" button? Recommend automatic only, since carry-forward already does it.

---

## Batch 4 — Archive page (`frontend/archive.html`, `frontend/src/pages/archive.ts`, i18n `archive.*`)

### A1 · Toggle between poll / final instead of one combined table ✅
Today the archive shows poll and final bets together. Add a **poll / final toggle** (segmented control) so only one kind is shown at a time, halving table width and matching how players think about the two bets.

- **Where:** `archive.ts` render; add a two-button segmented toggle (reuse the bets-page button styles), default to **final** (the real game).
- **i18n:** add toggle labels (reuse `bets.finalTitle`/`bets.pollTitle` or new `archive.showPoll`/`archive.showFinal`).
- Preserve the existing per-week layout; just filter to the selected kind and re-render on toggle.

---

## Decisions made (all batches implemented)
- **R2:** Option 1 — `max(0, 100 − E)` polls, `max(0, 150 − E)` finals (caps high so the floor rarely binds). Config-only; `scoring.py` + `app_settings` + tests updated.
- **R3:** final cap = 1.5× poll cap → ~1.5× per week. ✅
- **R4:** merger *engine* kept **dormant** (still covered by `test_scoring.py`); removed only from player-facing rules. ✅
- **R7:** **fieldwork-date** basis (Wikipedia has no publication date), **Friday→Thursday** weeks, lock at the week's Friday noon; nullable `publication_date` column added for the future. Full spec + pipeline + live-schedule migration done. ✅

### Deploy / follow-up notes
- Nothing is deployed yet (deploy is push-to-main). Frontend build + `tsc` clean; 35 pipeline tests + SQL parse pass.
- Migration `supabase/migrations/0003_publication_date.sql` was **applied to the live DB**; commit it with the rest.
- Live schedule regenerated to Friday weeks and mock re-seeded under the new constants — see the `live-db-mock-data` memory; run `scripts/mock_data.py teardown` before real launch.
