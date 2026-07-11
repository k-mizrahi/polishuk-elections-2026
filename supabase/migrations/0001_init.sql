-- 0001_init.sql — schema, triggers, RLS, RPCs. Normative spec: docs/04.
-- The database is the referee: bet validity, submission locks and bet
-- privacy are enforced here, not in clients or cron jobs.

-- ============================================================ tables

create table profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  handle         text unique check (handle is null or char_length(handle) between 3 and 20),
  display_name   text,
  twitter_handle text,
  lang           text not null default 'he' check (lang in ('he', 'en')),
  is_admin       boolean not null default false,
  is_banned      boolean not null default false,
  created_at     timestamptz not null default now()
);

create table parties (
  id           serial primary key,
  code         text unique not null,
  name_he      text not null,
  name_en      text not null,
  color        text not null default '#64748b',
  active_from  date not null,
  active_until date,
  sort_order   int  not null default 100
);

create table party_transitions (
  id           serial primary key,
  old_party_id int not null references parties (id),
  new_party_id int not null references parties (id),
  effective_on date not null,
  unique (old_party_id, new_party_id)
);

create table party_aliases (
  id       serial primary key,
  party_id int not null references parties (id),
  alias    text unique not null,
  source   text not null default 'wikipedia_en'
);

create table game_weeks (
  id              serial primary key,
  week_start      date not null unique,
  week_end        date not null,
  lock_at         timestamptz not null,
  status          text not null default 'scheduled'
                    check (status in ('scheduled', 'open', 'locked', 'scored')),
  is_final_week   boolean not null default false,
  avg_computed_at timestamptz
);

create table polls (
  id              serial primary key,
  pollster        text not null,
  publisher       text,
  fieldwork_start date,
  fieldwork_end   date not null,
  sample_size     int,
  source_url      text,
  row_fingerprint text unique not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  game_week_id    int references game_weeks (id),
  admin_note      text,
  scraped_at      timestamptz not null default now()
);

create table poll_results (
  poll_id         int not null references polls (id) on delete cascade,
  party_id        int not null references parties (id),
  seats           numeric not null default 0,
  below_threshold boolean not null default false,
  pct             numeric,
  primary key (poll_id, party_id)
);

create table bets (
  id                  serial primary key,
  user_id             uuid not null references profiles (id),
  week_id             int  not null references game_weeks (id),
  kind                text not null check (kind in ('poll', 'final')),
  is_carried          boolean not null default false,
  carried_from_bet_id int references bets (id),
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

create table app_settings (
  key   text primary key,
  value jsonb not null
);

create table audit_log (
  id      bigserial primary key,
  actor   uuid references profiles (id),
  action  text not null,
  payload jsonb,
  at      timestamptz not null default now()
);

create index polls_week_idx on polls (game_week_id) where status = 'approved';
create index bets_week_idx on bets (week_id);
create index scores_user_idx on scores (user_id);

-- ============================================================ helpers

create function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from profiles where id = auth.uid()), false) $$;

-- ============================================================ triggers

-- auto-create an empty profile on signup
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- non-admins cannot touch privilege/moderation flags
create function guard_profile_flags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.is_admin is distinct from old.is_admin
      or new.is_banned is distinct from old.is_banned)
     and not is_admin() and auth.role() <> 'service_role' then
    raise exception 'not allowed to change admin/ban flags';
  end if;
  if new.handle is distinct from old.handle and old.handle is not null then
    raise exception 'handle cannot be changed';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_flags();

-- bet write gate: open week, before lock, not banned (docs/04 §2).
-- service_role (pipeline carry-forward) is exempt from the lock/status gate
-- but never from validity checks.
create function guard_bet_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare w game_weeks;
begin
  select * into w from game_weeks where id = new.week_id;
  if w is null then raise exception 'unknown week'; end if;
  if auth.role() <> 'service_role' then
    if w.status <> 'open' or now() >= w.lock_at then
      raise exception 'week is locked';
    end if;
    if (select is_banned from profiles where id = new.user_id) then
      raise exception 'user is banned';
    end if;
    if new.user_id <> auth.uid() then
      raise exception 'cannot write bets for another user';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger bets_guard before insert or update on bets
  for each row execute function guard_bet_write();

-- bet completeness at commit: sum = 120; every ACTIVE party has a line
-- (0 allowed) unless the bet is a flagged carried bet (needs_review),
-- which may still reference pre-merger parties (docs/02 §6).
create function validate_bet_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b bets;
  total int;
  missing int;
begin
  select * into b from bets where id = coalesce(new.bet_id, old.bet_id);
  if b is null then return null; end if;  -- bet deleted in same tx
  select coalesce(sum(seats), 0) into total from bet_lines where bet_id = b.id;
  if total <> 120 then
    raise exception 'bet must total exactly 120 seats (got %)', total;
  end if;
  if not b.needs_review then
    select count(*) into missing
    from parties p
    join game_weeks w on w.id = b.week_id
    where p.active_from <= w.week_end
      and (p.active_until is null or p.active_until >= w.week_start)
      and not exists (select 1 from bet_lines l
                      where l.bet_id = b.id and l.party_id = p.id);
    if missing > 0 then
      raise exception 'bet is missing lines for % active parties', missing;
    end if;
  end if;
  return null;
end $$;

create constraint trigger bet_lines_complete
  after insert or update or delete on bet_lines
  deferrable initially deferred
  for each row execute function validate_bet_lines();

-- ============================================================ RPCs

-- Atomic bet upsert used by the frontend: replaces the user's bet for
-- (week, kind) in one transaction. lines: {"likud": 24, ...} by party code.
create function upsert_bet(p_week_id int, p_kind text, p_lines jsonb)
returns int language plpgsql security invoker set search_path = public as $$
declare v_bet_id int;
begin
  insert into bets (user_id, week_id, kind, is_carried, needs_review)
  values (auth.uid(), p_week_id, p_kind, false, false)
  on conflict (user_id, week_id, kind)
    do update set is_carried = false, needs_review = false,
                  carried_from_bet_id = null, updated_at = now()
  returning id into v_bet_id;
  delete from bet_lines where bet_id = v_bet_id;
  insert into bet_lines (bet_id, party_id, seats)
  select v_bet_id, p.id, (kv.value)::int
  from jsonb_each_text(p_lines) kv
  join parties p on p.code = kv.key;
  if (select count(*) from bet_lines where bet_id = v_bet_id)
     <> (select count(*) from jsonb_each_text(p_lines)) then
    raise exception 'unknown party code in bet';
  end if;
  return v_bet_id;
end $$;

-- Pipeline-only: atomic carried-bet insert (docs/06 weekly close).
create function admin_upsert_bet(
  p_user_id uuid, p_week_id int, p_kind text, p_lines jsonb,
  p_carried_from int, p_needs_review boolean)
returns int language plpgsql security definer set search_path = public as $$
declare v_bet_id int;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role only';
  end if;
  insert into bets (user_id, week_id, kind, is_carried, carried_from_bet_id, needs_review)
  values (p_user_id, p_week_id, p_kind, true, p_carried_from, p_needs_review)
  on conflict (user_id, week_id, kind) do nothing
  returning id into v_bet_id;
  if v_bet_id is null then return null; end if;  -- player already bet
  insert into bet_lines (bet_id, party_id, seats)
  select v_bet_id, p.id, (kv.value)::int
  from jsonb_each_text(p_lines) kv
  join parties p on p.code = kv.key;
  return v_bet_id;
end $$;

-- Pipeline-only: atomic poll ingest. Each element:
-- {pollster, publisher, fieldwork_start, fieldwork_end, sample_size,
--  source_url, row_fingerprint, status, admin_note,
--  results: {code: {seats, below_threshold, pct}}}
create function ingest_polls(p_polls jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  v_poll_id int;
  v_week_id int;
  inserted int := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role only';
  end if;
  for rec in select * from jsonb_array_elements(p_polls) loop
    if exists (select 1 from polls where row_fingerprint = rec->>'row_fingerprint') then
      continue;
    end if;
    select id into v_week_id from game_weeks
    where week_start <= (rec->>'fieldwork_end')::date
      and week_end   >= (rec->>'fieldwork_end')::date;
    insert into polls (pollster, publisher, fieldwork_start, fieldwork_end,
                       sample_size, source_url, row_fingerprint, status,
                       game_week_id, admin_note)
    values (rec->>'pollster', rec->>'publisher',
            (rec->>'fieldwork_start')::date, (rec->>'fieldwork_end')::date,
            (rec->>'sample_size')::int, rec->>'source_url',
            rec->>'row_fingerprint', coalesce(rec->>'status', 'pending'),
            v_week_id, rec->>'admin_note')
    returning id into v_poll_id;
    insert into poll_results (poll_id, party_id, seats, below_threshold, pct)
    select v_poll_id, p.id,
           coalesce((kv.value->>'seats')::numeric, 0),
           coalesce((kv.value->>'below_threshold')::boolean, false),
           (kv.value->>'pct')::numeric
    from jsonb_each(rec->'results') kv
    join parties p on p.code = kv.key;
    inserted := inserted + 1;
  end loop;
  return inserted;
end $$;

-- Pipeline-only: atomic scoring rewrite (docs/02 §8).
-- averages: [{week_id, party_code, avg_seats, n_polls}]
-- scores:   [{user_id, week_id, kind, error, score}]
create function apply_scoring(p_averages jsonb, p_scores jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role only';
  end if;
  -- "where true" satisfies pg-safeupdate, which Supabase runs in the
  -- PostgREST session and which rejects bare deletes even inside functions
  delete from weekly_averages where true;
  insert into weekly_averages (week_id, party_id, avg_seats, n_polls)
  select (a->>'week_id')::int, p.id, (a->>'avg_seats')::numeric, (a->>'n_polls')::int
  from jsonb_array_elements(p_averages) a
  join parties p on p.code = a->>'party_code';
  delete from scores where true;
  insert into scores (user_id, week_id, kind, error, score)
  select (s->>'user_id')::uuid, (s->>'week_id')::int, s->>'kind',
         (s->>'error')::numeric, (s->>'score')::numeric
  from jsonb_array_elements(p_scores) s;
  update game_weeks set avg_computed_at = now()
  where id in (select distinct (a->>'week_id')::int from jsonb_array_elements(p_averages) a);
end $$;

revoke execute on function admin_upsert_bet(uuid, int, text, jsonb, int, boolean) from public, anon, authenticated;
revoke execute on function ingest_polls(jsonb) from public, anon, authenticated;
revoke execute on function apply_scoring(jsonb, jsonb) from public, anon, authenticated;

-- ============================================================ views

create view leaderboard as
select p.id, p.handle, p.display_name, p.twitter_handle,
       coalesce(sum(s.score), 0)                                 as total,
       coalesce(sum(s.score) filter (where s.kind = 'final'), 0) as final_total,
       coalesce(sum(s.score) filter (where s.kind = 'poll'), 0)  as poll_total,
       coalesce(sum(s.error) filter (where s.kind = 'final'), 0) as final_error_total,
       count(distinct s.week_id)                                 as weeks_played,
       (select min(b.created_at) from bets b where b.user_id = p.id) as first_bet_at
from profiles p
left join scores s on s.user_id = p.id
where not p.is_banned and p.handle is not null
group by p.id;

-- ============================================================ RLS

alter table profiles          enable row level security;
alter table parties           enable row level security;
alter table party_transitions enable row level security;
alter table party_aliases     enable row level security;
alter table game_weeks        enable row level security;
alter table polls             enable row level security;
alter table poll_results      enable row level security;
alter table bets              enable row level security;
alter table bet_lines         enable row level security;
alter table weekly_averages   enable row level security;
alter table scores            enable row level security;
alter table official_results  enable row level security;
alter table app_settings      enable row level security;
alter table audit_log         enable row level security;

-- public reference data: world-readable, admin-writable
create policy profiles_select on profiles for select using (true);
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());

create policy parties_select     on parties           for select using (true);
create policy parties_write      on parties           for all using (is_admin()) with check (is_admin());
create policy transitions_select on party_transitions for select using (true);
create policy transitions_write  on party_transitions for all using (is_admin()) with check (is_admin());
create policy aliases_select     on party_aliases     for select using (true);
create policy aliases_write      on party_aliases     for all using (is_admin()) with check (is_admin());
create policy weeks_select       on game_weeks        for select using (true);
create policy weeks_write        on game_weeks        for all using (is_admin()) with check (is_admin());
create policy averages_select    on weekly_averages   for select using (true);
create policy results_select     on official_results  for select using (true);
create policy results_write      on official_results  for all using (is_admin()) with check (is_admin());
create policy settings_select    on app_settings      for select using (true);
create policy settings_write     on app_settings      for all using (is_admin()) with check (is_admin());
create policy scores_select      on scores            for select using (true);

-- polls: only approved rows are public; admins see the queue
create policy polls_select on polls for select
  using (status = 'approved' or is_admin());
create policy polls_write on polls for all using (is_admin()) with check (is_admin());
create policy poll_results_select on poll_results for select
  using (exists (select 1 from polls q where q.id = poll_id
                 and (q.status = 'approved' or is_admin())));
create policy poll_results_write on poll_results for all using (is_admin()) with check (is_admin());

-- bets: own rows always; everyone's rows once the week's lock has passed
create policy bets_select on bets for select
  using (user_id = auth.uid() or is_admin()
         or exists (select 1 from game_weeks w
                    where w.id = bets.week_id and now() >= w.lock_at));
create policy bets_write on bets for insert with check (user_id = auth.uid());
create policy bets_update on bets for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bets_delete on bets for delete
  using (user_id = auth.uid()
         and exists (select 1 from game_weeks w
                     where w.id = bets.week_id and now() < w.lock_at));

create policy bet_lines_select on bet_lines for select
  using (exists (select 1 from bets b where b.id = bet_id
                 and (b.user_id = auth.uid() or is_admin()
                      or exists (select 1 from game_weeks w
                                 where w.id = b.week_id and now() >= w.lock_at))));
create policy bet_lines_write on bet_lines for all
  using (exists (select 1 from bets b where b.id = bet_id and b.user_id = auth.uid()))
  with check (exists (select 1 from bets b where b.id = bet_id and b.user_id = auth.uid()));

create policy audit_select on audit_log for select using (is_admin());
create policy audit_insert on audit_log for insert with check (is_admin());
