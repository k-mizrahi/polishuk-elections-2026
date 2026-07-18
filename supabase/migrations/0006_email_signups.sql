-- 0006_email_signups.sql — coming-soon mailing list.
-- Writes go only through the security-definer RPC below; emails are never
-- readable by anon/authenticated (RLS default-deny, table grant revoked).

create table email_signups (
  email      text primary key,
  created_at timestamptz not null default now()
);

alter table email_signups enable row level security;
-- no policies on purpose: default-deny for anon/authenticated

-- 0002's default privileges auto-grant SELECT on new tables to
-- anon/authenticated; strip it so even a future permissive policy
-- can't expose emails. service_role keeps full access (0002 defaults).
revoke all on table email_signups from anon, authenticated;

-- Anon-callable signup. Validates + lowercases; on-conflict-do-nothing so
-- the response never reveals whether the email was already registered.
create function subscribe_email(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  if v_email is null
     or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;
  insert into email_signups (email) values (v_email)
  on conflict (email) do nothing;
end $$;

revoke execute on function subscribe_email(text) from public;
grant execute on function subscribe_email(text) to anon, authenticated;
