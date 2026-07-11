# 05 · Scraper Spec

Source of truth for `pipeline/scraper.py`. Runs on GitHub Actions cron every 6 hours; Python 3.12; `requests` + `beautifulsoup4` + `pandas.read_html`; writes to Supabase with the service-role key.

## Source

English Wikipedia, **`Opinion_polling_for_the_2026_Israeli_legislative_election`** (the page was renamed from "…the next Israeli legislative election" once the date firmed up — the old title is a redirect), fetched via the **MediaWiki API**, not the skinned page:

```
GET https://en.wikipedia.org/w/api.php?action=parse
    &page=Opinion_polling_for_the_2026_Israeli_legislative_election
    &prop=text|revid&format=json&formatversion=2&redirects=1
```

- **`redirects=1` is mandatory** — without it a renamed page silently returns a tiny redirect stub instead of content (observed live 2026-07-11).
- More stable than scraping rendered HTML (no skin/banner markup) and returns a **`revid`**.
- **Change detection**: compare `revid` to `app_settings['last_scraped_revid']`; if unchanged, log "no change" and exit 0 (a keep-alive `select 1` still runs so the Supabase project never idles). Update the stored revid only after a fully successful run.
- Set a descriptive `User-Agent` (`polishuk-elections-scraper/1.0 (contact: mizrahi.kobi@gmail.com)`) per Wikimedia etiquette; one request per run is far below any rate limit.

## Page structure (verified live 2026-07-11, revid 1363501450 — fixtures track this)

The page has ~34 wikitables but **only tables under H2 "Seat projections" → year H3 sections (2026, 2025, …) are ingested**. Everything else — scenario polls ("Likud B", "Netanyahu retirement"…), percentage-only tables, the Arab-voters section, preferred-PM tables, the pollster directory — is excluded by the section rule, not by header heuristics.

Main-table structure:
- Columns: fieldwork date · polling firm · publisher · sample size (**absent in some table segments**) · one column per party (~12–16, **changes over time** via mergers/splits) · "Others" · "Gov." (coalition checksum).
- **Multi-row headers with rowspan/colspan**: a bloc column (e.g. "Joint List") can span leaf sub-columns ("Hadash–Ta'al", "Balad"). Canonical mapping is by the **top-level header**; leaf cells are **summed into the bloc**, identity-deduped because a poll may report the bloc as a single `colspan` cell. The bloc is what appears on the ballot, so it is what bets and averages are defined on.
- **Two-row polls**: one poll can span two result rows sharing rowspanned meta cells (scenario variants). The first row is the headline result (auto-approvable); **second+ rows route to `pending`** ("secondary scenario row") so one pollster never gets two votes in a weekly average.
- **Announcement rows**: political events ("X and Y merge to form Z") appear as rows whose text spans the party columns — detected (≤1 unique non-numeric cell across party columns) and skipped.
- Merger events appear as footnotes and as column-set changes between table segments.

## Parsing pipeline

Per year-table, per row:

1. **Header mapping.** Each party column header string is looked up in `party_aliases` (exact match after whitespace/footnote-marker normalization — strip `[a]`-style refs and NBSPs). **Any unmapped header aborts the entire run** with an error naming the header verbatim.
   *This is the merger tripwire, and it is a feature*: when Wikipedia adds a "Yesodot Yisrael" column, the run fails loudly → admin performs the merger-day runbook (doc 06) → rerun succeeds. Fail-loud beats silently mangled data. Non-party columns matched by their own alias list (`Polling firm`, `Date`, `Sample size`, `Others`, `Gov.`, …); an unmapped *non-party* header also aborts (layout drift).
2. **Cell normalization** (validation matrix):

   | Cell looks like | Interpretation |
   |---|---|
   | integer `n` | `seats = n` |
   | `(n.n%)` / `n%` / `(<n%)` | `seats = 0, below_threshold = true, pct = n` |
   | dash / blank / `— N/a` | `seats = 0` (a party absent from a 120-seat projection got no seats) |
   | percent + trailing text (`(1.8%) Zehut at 1.8%`) | as percent; trailing text kept as a note |
   | anything else (e.g. `?`) | row → review queue (`pending`), note the cell |

3. **Dates.** Fieldwork cell parsed to `(fieldwork_start, fieldwork_end)`; handles single dates ("9 Jul"), same-month ranges ("10–12 Jul" — the start inherits the end's month), cross-month ranges ("30 Jun – 3 Jul") and Dec→Jan crossings, with the table's year-section as context; all dash variants accepted. Unparseable → `pending`.
4. **Row validation.** Σ(party seats) + Others = **exactly 120** (tolerance 0); "Gov." parsed and used **only as a checksum** against the sum of mapped coalition parties (mismatch → `pending`, note the delta; the set of coalition parties is an alias-table-style config, not hardcoded).
5. **Fingerprint & dedupe.** `row_fingerprint = sha256(pollster | fieldwork_end | sorted "(party_code:seats)" vector)`. Unseen fingerprint → insert. Seen and identical → skip.
6. **Week assignment.** `game_week_id` = the game week whose [Sunday, Saturday] contains `fieldwork_end`; polls before the first game week get `null` (displayed, never scored).
7. **Status routing.**
   - Clean row → `status = 'approved'` directly (no human in the loop for the ~95% happy path).
   - Failed sum/date/cell checks → `status = 'pending'`, anomaly description in `admin_note`.
   - **Edited history**: if a row matching an existing poll's (pollster, fieldwork_end) appears with a *different* seat vector — i.e., Wikipedia corrected a poll — do **not** auto-mutate the approved poll. Insert the new version as `pending` with a field-level diff in `admin_note`; the admin approves (which rejects the old version) per the doc 06 runbook. Scores self-heal on the next recompute (doc 02 §8).
   - A previously seen poll vanishing from the page is logged as a warning only (Wikipedia churn; admin judgment).

All writes for a run happen in **one transaction**: either the whole scrape lands or none of it.

## Live backfill reference (2026-07-11)

First production run against revid 1363501450: **148 rows parsed → 147 ingested** (one exact-duplicate fingerprint on the page), 136 auto-approved, 12 pending (9 secondary scenario rows, 3 genuine data anomalies: a `?` cell, seat sums of 117/118/121). Use these numbers as a sanity baseline when validating parser changes against the fixture.

## Failure alerting

- GH Actions failure → native email to the repo owner.
- The workflow's `if: failure()` step also creates/updates a GitHub issue `Scraper failure <date>` (via `gh`) with the log tail, so failures are tracked even if email is missed.
- A run that inserts > 0 `pending` rows exits 0 but prints a `::warning::` annotation ("N polls awaiting review") visible in the Actions summary.

## Testing & fixtures

- `pipeline/fixtures/` holds saved API responses (full JSON) captured at meaningful moments: current format, pre/post a merger column change, a sub-threshold-heavy week, a malformed-cell example.
- Unit tests: header mapping (incl. footnote-marker stripping), each cell-normalization case, date-range parsing table, sum/Gov. checksum, fingerprint stability (column order must not matter), dedupe, edited-history diff routing.
- Integration test: full fixture → expected `polls` + `poll_results` rows against a local/ephemeral schema.
- When Wikipedia format drift breaks production: first commit the new page snapshot as a fixture, then fix the parser against it (regression suite grows monotonically).

## Manual fallback

If the page becomes unscrapeable for an extended period, the admin console's poll CRUD (doc 01, admin tab 1 — the same editor used for the review queue) supports hand-entering polls. The game never depends on the scraper being alive — only on polls existing by the Wednesday finalize run.
