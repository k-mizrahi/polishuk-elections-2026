-- 0002_grants.sql — role privileges (docs/04). Privileges gate SQL verbs;
-- RLS (0001) gates rows. Needed explicitly because migrations run as the
-- postgres role over a direct connection, where the dashboard's default
-- privileges do not apply.

grant usage on schema public to anon, authenticated, service_role;

-- the pipeline (service_role) may do anything; RLS doesn't apply to it
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- everyone may read; RLS narrows rows (e.g. pending polls, pre-lock bets)
grant select on all tables in schema public to anon, authenticated;

-- players: own bets + own profile; admins act as authenticated with
-- is_admin() RLS policies, so they need the verbs too
grant insert, update, delete on bets, bet_lines to authenticated;
grant update on profiles to authenticated;
grant insert, update, delete on parties, party_transitions, party_aliases,
  game_weeks, polls, poll_results, official_results, app_settings to authenticated;
grant insert on audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- pipeline RPCs: 0001 revoked EXECUTE from public/anon/authenticated, which
-- also strips the default grant — service_role needs it back explicitly
grant execute on function ingest_polls(jsonb) to service_role;
grant execute on function apply_scoring(jsonb, jsonb) to service_role;
grant execute on function admin_upsert_bet(uuid, int, text, jsonb, int, boolean) to service_role;

-- future objects created by postgres get the same treatment
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant select on tables to anon, authenticated;
