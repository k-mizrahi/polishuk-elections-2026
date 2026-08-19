-- 0007 · Field-format validation for user- and admin-writable text columns
--
-- Closes two LOW findings from the 2026-07-15 whole-app review (docs/06,
-- "Open security items"): `profiles.twitter_handle` and `parties.color` were
-- accepted verbatim.
--
-- Why the DB and not just the form: both columns are written straight from the
-- browser with the publishable key (docs/03 — there is no app server), so the
-- frontend input types are a convenience, not a boundary. A handcrafted
-- PostgREST PATCH bypasses them entirely. `twitter_handle` is rendered into an
-- `https://x.com/<handle>` href on the profile and leaderboard pages; the
-- character class below is what keeps that href a URL and nothing else.
-- `parties.color` is interpolated into inline style on every party chip.
--
-- Both constraints are NOT VALID-free: existing rows were checked first (all 13
-- registry colours are #rrggbb, all mock handles are word characters), so the
-- constraints validate on creation and future writes are gated.

-- X handles: 1–15 chars, letters/digits/underscore. The leading '@' is stripped
-- client-side before save and is deliberately not accepted here.
alter table profiles
  add constraint profiles_twitter_handle_format
  check (twitter_handle is null or twitter_handle ~ '^[A-Za-z0-9_]{1,15}$');

-- Party colours: 6-digit hex, '#' included — the exact shape `<input type=color>`
-- produces and the only shape the chip renderer can safely inline.
alter table parties
  add constraint parties_color_format
  check (color ~ '^#[0-9a-fA-F]{6}$');
