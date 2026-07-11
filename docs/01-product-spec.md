# 01 · Product Spec (UX)

Source of truth for pages, states, i18n/RTL behavior, and copy tone. Game math lives in [02](02-scoring-spec.md); schema in [04](04-data-model.md).

## Personas

- **The Twitter poll-junkie** (primary): follows Israeli politics obsessively, found the game via a tweet, plays weekly on mobile. Hebrew UI.
- **The casual friend**: joins once, forgets some weeks — carry-forward keeps them in the game. Needs the rules explained in 30 seconds.
- **The diaspora observer**: prefers the English UI; same features.
- **The admin (Kobi)**: reviews scraped polls, manages the party list on merger days, enters official results.

## Weekly player loop (the 30-second pitch)

1. Log in → see your current standing bets (fresh, carried, or none).
2. Adjust two lists so each sums to 120 — before **Friday 12:00**.
3. Saturday night the polls week closes; mid-week your poll score lands and everyone's bets go public.
4. Repeat until election day; after results, every week you were right pays out.

## Visual identity

Direct lift from Polishuk: page `bg-sky-50`, content in white `rounded-2xl shadow-xl` cards inside a `max-w-4xl` centered container; headings `text-blue-900 font-extrabold`; body `text-slate-600/700/800`; primary buttons `bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl`; warnings in `bg-amber-50 border-amber-200` callouts with an emoji lead (⚠️/⏱️); success states emerald with 🎉. Logo: Polishuk logo adapted ("פולי-שוק בחירות").

**Copy tone**: playful, self-deprecating Hebrew in Polishuk's register — e.g., "הימורים (לא) נושאי פרסים", gender-inclusive forms ("תזכה אתכםן"). English copy is a clean translation, slightly drier. All numbers/dates render as digits (LTR-safe).

## i18n & RTL rules

- Default `he`/`rtl`; toggle in the header, persisted to `localStorage` and `profiles.lang`; sets `<html lang dir>` on load before first paint (inline script, no flash).
- All UI strings via `t(key)` over `frontend/src/i18n/{he,en}.json` — no literals in page code. Party names come from `parties.name_he/name_en`.
- Tailwind **logical properties only** (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `start-0`) so one stylesheet serves both directions. Numbers, handles, and URLs wrapped in `dir="ltr"` spans where mixed-direction text would garble.
- Dates displayed per-locale (`Intl.DateTimeFormat`, `Asia/Jerusalem` explicitly).

## Pages

Shared chrome on every page: header (logo, nav, language toggle, login state), footer (rules link, GitHub, @_kobim). Nav highlights current page. All pages readable logged-out except `bets` and `admin`.

### `index.html` — Landing & rules

- Hero: logo, one-line pitch, primary CTA ("להתחיל לנחש" → login or bets).
- **Status strip** (logged-in): week number, countdown to lock, per-kind bet state — ✓ submitted this week / ⟳ carried from week N ("לחצו לעדכן") / ✗ none yet.
- Rules section in plain language, including: the two bets, Friday-noon lock, carry-forward, hidden-until-lock, and a **worked scoring example card** showing an integer bet scored against a fractional average (doc 02 Example A) — this is the single most confusing mechanic; it gets a visual.
- Amber callout: "מה זה הימור מתגלגל?" explaining carried bets.
- States: logged-out / logged-in / banned (dimmed CTA + explanation).

### `login.html`

- Google button (primary, large) + magic-link email form (secondary).
- Post-auth **handle onboarding modal** (blocking until done): unique handle (3–20 chars, Hebrew/Latin, live uniqueness check), optional display name and X handle. Shown whenever `profiles.handle` is null.
- States: error (OAuth failure, link expired), banned (signed in but blocked from play, message with contact).

### `bets.html` — My Bets (the core form)

Two stacked cards — **final-outcome bet** first (it's the headline game), then **poll-average bet**. Each card:

- One row per active party: color chip, name, − / + steppers and a numeric input. Tapping into the input selects content (mobile-friendly).
- Per-row validation: values 1–3 invalid → red row + hint "0 או 4 ומעלה" (0 or 4+).
- **Sticky sum bar** at the card top while scrolling: "87 / 120 · נותרו 33" — slate while under, **emerald at exactly 120**, red when over. Submit enabled only at 120 with all rows valid.
- Quick-fills: "העתיקו מההימור הסופי" (copy final → poll), "התחילו מממוצע השבוע שעבר" (prefill from last week's `weekly_averages`, rounded to a valid 120 vector — nearest-integer then largest-remainder fixup).
- Carried-bet banner (amber): "זהו ההימור שלכם משבוע 25, מתגלגל אוטומטית — ערכו אותו כדי לעדכן".
- Countdown to lock; saves via the `upsert_bet` RPC with optimistic UI, server (trigger) errors surfaced verbatim-but-translated.
- States: **open** (editable) / **locked** (read-only, "ההימורים נעולים ופומביים", link to archive) / **no open week** / **not logged in** (redirect) / **banned**.

### `polls.html` — The aggregator

- Reverse-chronological table of approved polls: date, pollster, publisher, sample size, one column per party (sticky first column; horizontal scroll on mobile, RTL-aware).
- The **current week's running average** pinned as a highlighted row; previous weeks' finalized averages collapsible below.
- Sub-threshold entries shown as their stored pct ("2.8%") in muted text, counted as 0 in averages (tooltip explains).
- V1.5: per-party trend chart (polls as dots, weekly averages as line).

### `leaderboard.html`

- Rank, handle (→ public profile), X handle link, **total**, final subtotal, poll subtotal, weeks played, pts/week. Sorted per doc 02 §5 tie-breakers; ties display same rank number.
- Note under the table: finals ≈ ×2.5 polls, link to rules. Empty state pre-first-scoring: "עוד אין ניקוד — ההימורים הראשונים ננעלים ביום שישי".

### `archive.html` — Week archive

- Week picker (locked weeks only). Per week: the finalized average vector, then every player's now-public bets (both kinds) with their errors/scores, sortable by score. This is the social payoff of hidden-until-lock — the weekly reveal.

### `profile.html`

- Own view: edit display name / X handle / language; handle immutable after creation (V2: one rename).
- History table: week, kind, carried?, error, score; personal totals.
- Public read-only variant at `?u=<handle>` (URL-encoded; Hebrew handles fine).

### `admin.html`

UI-gated by `profiles.is_admin`; **RLS is the real gate** — the page just doesn't render for others. Tabs:

1. **Poll queue**: pending polls with the scraper's diff/anomaly note; inline-editable seat cells; approve / reject. Approving triggers nothing special — next pipeline run recomputes (doc 02 §8).
2. **Parties**: add/rename/retire party, alias editor, transition editor (old → new + effective date). "Merger-day" flow documented in doc 06.
3. **Weeks**: table of game_weeks with status and lock_at override (⚠️ the flagged lock-time revisit lands here as a data edit).
4. **Official results**: same 120-sum stepper UX as the bets form; double-confirm modal; writes `official_results` + sets `election_date`.
5. **Users**: search, ban/unban (with audit note).
6. **Ops**: "run recompute" instructions (GitHub `workflow_dispatch` link), pipeline status (last scrape revid/time from `app_settings`).

## Empty/edge states checklist (QA against doc 06 scenarios)

- Week 1: no carried bets anywhere; archive empty; leaderboard empty-state.
- Void week (zero polls): polls page shows "אין סקרים השבוע"; archive shows bets but "לא נוקד — שבוע ללא סקרים".
- Player joins mid-game: history starts at their first week; pts/week column keeps them motivated.
- Party merged mid-week while a bet is open: bet form re-renders against the active list; carried remap banner explains what happened.
- Post-election: bets page closes ("המשחק הסתיים 🎉"), leaderboard becomes the permanent front page.
