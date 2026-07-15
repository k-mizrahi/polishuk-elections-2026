-- 0004_bet_lines_lock.sql — close the post-lock bet-tampering hole.
--
-- The lock, ban check and open-week gate lived only in guard_bet_write, which
-- fires on `bets`. But a bet's content is in `bet_lines`, on which
-- `authenticated` holds full DML gated by ownership-only RLS (0001 bet_lines_write)
-- and a completeness trigger that checks Σ=120 but never the lock. So a player
-- could rewrite their seat lines AFTER lock_at — once the week's bets became
-- publicly readable — via a direct PostgREST upsert that still totals 120, with
-- guard_bet_write never running. Same gap let a banned user keep editing.
--
-- This mirrors guard_bet_write onto bet_lines: resolve the owning bet's week and
-- re-apply open/lock/owner/ban. service_role (pipeline carry-forward) stays exempt
-- from the status/lock gate but never from the validity checks in 0001.

create function guard_bet_line_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b bets;
  w game_weeks;
begin
  select * into b from bets where id = coalesce(new.bet_id, old.bet_id);
  if b is null then return coalesce(new, old); end if;  -- parent bet deleted in same tx
  if auth.role() <> 'service_role' then
    select * into w from game_weeks where id = b.week_id;
    if w is null then raise exception 'unknown week'; end if;
    if w.status <> 'open' or now() >= w.lock_at then
      raise exception 'week is locked';
    end if;
    if (select is_banned from profiles where id = b.user_id) then
      raise exception 'user is banned';
    end if;
    if b.user_id <> auth.uid() then
      raise exception 'cannot write bet lines for another user';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger bet_lines_guard before insert or update or delete on bet_lines
  for each row execute function guard_bet_line_write();
