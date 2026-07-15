-- 0005_profile_privacy.sql — stop anon/authenticated enumerating is_admin/is_banned.
--
-- 0001's `profiles_select using (true)` made the whole row world-readable, so
-- anyone with the anon key could `GET /profiles?is_admin=eq.true` to list admin
-- UUIDs, or read every player's ban status. RLS is row-level, not column-level,
-- so the fix is: restrict the base table to own-row (+ admins), and expose the
-- genuinely public columns through a view for cross-user display (leaderboard,
-- public profile pages, handle-availability checks, archive bet attribution).

drop policy profiles_select on profiles;
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_admin());

-- Public-safe projection. Runs with the view owner's rights (security_invoker
-- off) so it is world-readable regardless of the base-table policy above, but it
-- only ever exposes non-sensitive columns. All rows with a chosen handle appear
-- (banned users included) so presence/absence never leaks ban status.
create view public_profiles as
  select id, handle, display_name, twitter_handle, lang
  from profiles
  where handle is not null;

grant select on public_profiles to anon, authenticated;
