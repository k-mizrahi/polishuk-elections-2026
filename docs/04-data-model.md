# 04 · Data Model (Normative)

Single source of truth for the Supabase/Postgres schema. The SQL below is written to be copy-pasteable into `supabase/migrations/0001_init.sql` (split into numbered migrations at implementation time). All timestamps are `timestamptz`; all game-time reasoning happens in `Asia/Jerusalem` inside the pipeline, while the DB stores UTC instants.

Design stance: **the database is the referee**. Bet validity, submission locks, and bet privacy are enforced by triggers and RLS — the frontend only provides friendly UX for rules the DB would enforce anyway, and no client (or late cron) can break them.

## 1. Tables

### profiles — 1:1 with `auth.users`

```sql
create table profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  handle         text unique check (char_length(handle) between 3 and 20),
  display_name   text,
  twitter_handle text,                 -- display only, no OAuth
  lang           text not null default 'he' check (lang in ('he', 'en')),
  is_admin       boolean not null default false,
  is_banned      boolean not null default false,
  created_at     timestamptz not null default now()
);
```

- Created empty by a trigger on `auth.users` insert; `handle` is null until first-login onboarding completes.
- Handles may be Hebrew or Latin (URL-encoding handles profile links).
- Email is **not** duplicated here — it stays in `auth.users`, invisible to other players.

### parties — canonical registry, versioned by lifespan

```sql
create table parties (
  id           serial primary key,
  code         text unique not null,          -- 'likud', 'together', ...
  name_he      text not null,
  name_en      text not null,
  color        text not null default '#64748b',  -- hex, charts/UI
  active_from  date not null,
  active_until date,                          -- null = currently running
  sort_order   int  not null default 100
);
```

A party is *active in week w* iff `active_from <= week_end and (active_until is null or active_until >= week_start)`.

### party_transitions — merger/split graph

```sql
create table party_transitions (
  id           serial primary key,
  old_party_id int not null references parties (id),
  new_party_id int not null references parties (id),
  effective_on date not null,
  unique (old_party_id, new_party_id)
);
```

Many rows → one `new_party_id` encode a merger; one `old_party_id` → many rows encode a split. Consumed by: carry-forward remapping, common-partition scoring (doc 02 §6), and the admin party manager.

### party_aliases — scraper column mapping

```sql
create table party_aliases (
  id       serial primary key,
  party_id int not null references parties (id),
  alias    text unique not null,   -- exact Wikipedia column-header string
  source   text not null default 'wikipedia_en'
);
```

### polls & poll_results

```sql
create table polls (
  id              serial primary key,
  pollster        text not null,
  publisher       text,
  fieldwork_start date,
  fieldwork_end   date not null,
  publication_date date,                    -- nullable, future-use (R7); membership keys on fieldwork_end
  sample_size     int,
  source_url      text,
  row_fingerprint text unique not null,     -- sha256(pollster|fieldwork_end|sorted seat vector)
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  game_week_id    int references game_weeks (id),   -- derived from fieldwork_end
  admin_note      text,                     -- scraper diff / reviewer comment
  scraped_at      timestamptz not null default now()
);

create table poll_results (
  poll_id         int not null references polls (id) on delete cascade,
  party_id        int not null references parties (id),
  seats           numeric not null default 0,
  below_threshold boolean not null default false,
  pct             numeric,                  -- the "N%" figure, display only
  primary key (poll_id, party_id)
);
```

### game_weeks

```sql
create table game_weeks (
  id              serial primary key,
  week_start      date not null unique,     -- Friday (Israel); Friday→Thursday window (R7, docs/09)
  week_end        date not null,            -- Thursday
  lock_at         timestamptz not null,     -- the week's own Friday 12:00 Israel, stored UTC
  status          text not null default 'scheduled'
                    check (status in ('scheduled', 'open', 'locked', 'scored')),
  is_final_week   boolean not null default false,
  avg_computed_at timestamptz
);
```

`lock_at` is data, not code — the ⚠️ Friday-noon decision can be changed per-week without a deploy. `status` is bookkeeping for the pipeline/UI; **privacy and write-locks key off `lock_at` directly**, so a late cron never leaks or admits anything.

### bets & bet_lines

```sql
create table bets (
  id                  serial primary key,
  user_id             uuid not null references profiles (id),
  week_id             int  not null references game_weeks (id),
  kind                text not null check (kind in ('poll', 'final')),
  is_carried          boolean not null default false,
  carried_from_bet_id int references bets (id),   -- provenance chain
  needs_review        boolean not null default false,  -- carried bet that could not be remapped (split)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, week_id, kind)
);

create table bet_lines (
  bet_id   int not null references bets (id) on delete cascade,
  party_id int not null references parties (id),
  seats    int not null check (seats = 0 or seats >= 4),
  primary key (bet_id, party_id)
);
```

### weekly_averages, scores, official_results

```sql
create table weekly_averages (
  week_id   int not null references game_weeks (id),
  party_id  int not null references parties (id),
  avg_seats numeric not null,
  n_polls   int not null,
  primary key (week_id, party_id)
);

create table scores (
  user_id     uuid not null references profiles (id),
  week_id     int  not null references game_weeks (id),
  kind        text not null check (kind in ('poll', 'final')),
  error       numeric not null,
  score       numeric not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, week_id, kind)
);

create table official_results (
  party_id int primary key references parties (id),
  seats    int not null check (seats = 0 or seats >= 4)
);
```

`weekly_averages` and `scores` are pipeline-owned and truncate-rewritten on every scoring run (doc 02 §8).

### app_settings & audit_log

```sql
create table app_settings (
  key   text primary key,     -- 'scoring_constants', 'election_date', 'announcement',
  value jsonb not null        -- 'last_scraped_revid', ...
);

create table audit_log (
  id      bigserial primary key,
  actor   uuid references profiles (id),   -- null = pipeline/service-role
  action  text not null,                   -- 'poll.approve', 'party.merge', 'user.ban', ...
  payload jsonb,
  at      timestamptz not null default now()
);
```

## 2. Validation triggers (the referee)

**Bet write gate** — `before insert or update on bets` and a statement-level check on `bet_lines`:

1. Reject if `now() >= (select lock_at from game_weeks where id = week_id)`.
2. Reject if the week's `status` is not `open`.
3. Reject if `(select is_banned from profiles where id = user_id)`.
4. `service_role` (the pipeline's carried-bet writes) is exempt from 1–3 but never from the completeness checks below.

**Bet completeness** — a `constraint trigger ... deferrable initially deferred` on `bet_lines` validating, at transaction commit:

1. `sum(seats) = 120` across the bet's lines.
2. Every line's party is active for the bet's week and every active party has a line (0 allowed) — **unless `bets.needs_review`** (a carried bet whose party split and could not be deterministically remapped is stored as-is and flagged; scoring bridges it via the common partition, docs/02 §6).

(Frontend writes a bet atomically via an `upsert_bet(week_id, kind, lines jsonb)` **security-invoker RPC** that replaces all lines in one transaction, keeping the deferred trigger simple and the client code sane.)

**Profile guard** — `before update on profiles`: non-admins cannot change `is_admin` or `is_banned` (compare `old`/`new`, check `is_admin()`).

**Auto-profile** — `after insert on auth.users`: insert an empty `profiles` row.

**updated_at** — standard touch trigger on `bets`.

## 3. Row-Level Security

Helper:

```sql
create function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from profiles where id = auth.uid()), false) $$;
```

| Table | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `profiles` | everyone (public leaderboard identity) | own row only (guard trigger protects flag columns) |
| `parties`, `party_transitions`, `party_aliases`, `game_weeks`, `weekly_averages`, `official_results`, `app_settings` | everyone | `is_admin()` only (pipeline uses service-role, bypasses RLS) |
| `polls`, `poll_results` | everyone **where `status = 'approved'`** (join for results); admins see all statuses | `is_admin()` only |
| `bets`, `bet_lines` | **`user_id = auth.uid()` OR the bet's week has `now() >= lock_at`** — privacy flips to public automatically at the lock instant, no job required | own rows only, AND week `open`, AND `now() < lock_at`, AND not banned (mirrors the trigger; defense in depth) |
| `scores` | everyone | service-role only (no policy) |
| `audit_log` | `is_admin()` | service-role / `is_admin()` |

The bets SELECT policy in SQL:

```sql
create policy bets_select on bets for select using (
  user_id = auth.uid()
  or exists (select 1 from game_weeks w where w.id = bets.week_id and now() >= w.lock_at)
);
```

(`bet_lines` gets the same policy via a join to `bets`.)

## 4. Leaderboard view

```sql
create view leaderboard as
select p.id, p.handle, p.display_name, p.twitter_handle,
       coalesce(sum(s.score), 0)                                  as total,
       coalesce(sum(s.score) filter (where s.kind = 'final'), 0)  as final_total,
       coalesce(sum(s.score) filter (where s.kind = 'poll'), 0)   as poll_total,
       coalesce(sum(s.error) filter (where s.kind = 'final'), 0)  as final_error_total,  -- tie-break 3
       count(distinct s.week_id)                                  as weeks_played,
       min(b.created_at)                                          as first_bet_at        -- tie-break 4
from profiles p
left join scores s on s.user_id = p.id
left join bets   b on b.user_id = p.id
where not p.is_banned
group by p.id;
```

Ordering (tie-breakers, doc 02 §5) is applied in the query: `order by total desc, final_total desc, final_error_total asc, first_bet_at asc`.

## 5. Seed plan (`supabase/seed.sql`)

1. **Parties + aliases** — the party columns on the Wikipedia page as of July 2026 (⚠️ **verify against the live page at implementation time**; Hebrew names to be confirmed by owner): Likud / הליכוד, Together / the Yesh Atid–Bennett merger list, Religious Zionist Party / הציונות הדתית, Otzma Yehudit / עוצמה יהודית, Blue & White / כחול לבן, Shas / ש"ס, United Torah Judaism / יהדות התורה, Yisrael Beiteinu / ישראל ביתנו, Joint List / הרשימה המשותפת, The Democrats / הדמוקרטים, Yashar / ישר, Yesodot Yisrael / יסודות ישראל. One alias row per party with the exact column-header string; extra aliases added as the scraper trips on variants.
2. **Transitions** — known 2026 events: Yesh Atid → Together, Bennett-2026 → Together (April 2026); Hadash-Ta'al / Balad / Ra'am → Joint List (June 2026); Hendel/Reservists → Yesodot Yisrael (July 2026). Pre-merger parties are seeded with `active_until` set, so historical polls can be stored against them.
3. **game_weeks** — generate rows from launch week through end of 2026; `lock_at` = preceding Friday 12:00 Asia/Jerusalem converted to UTC per-row (DST-correct because it's per-date data, not a cron expression).
4. **app_settings** — `scoring_constants: {poll: {base: 30, per_seat: 1}, final: {base: 100, per_seat: 2}}`, `election_date: null`, `last_scraped_revid: null`.
5. **First admin** — set `is_admin = true` for the owner's profile id after first login (documented manual step in doc 06).

## 6. Type generation

Frontend types are generated, not hand-written: `supabase gen types typescript --project-id <ref> > frontend/src/lib/database.types.ts`, regenerated on every migration (checked in, so the frontend builds without Supabase access).
