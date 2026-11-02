-- Rate limits on everything a person can do over and over. Enforced in the
-- database, so a modified app can't skip them. The service role and SQL editor
-- (auth.uid() is null) are never limited.

create table private.rate_counters (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (user_id, action, window_start)
);
revoke all on private.rate_counters from public, anon, authenticated;

-- Raises 'rate_limited' past p_max in the current minute, hour or day (UTC).
-- The raise rolls back the count too, so refused tries don't use up the window.
create function private.hit(p_user uuid, p_action text, p_max integer, p_window text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  used integer;
begin
  if p_user is null then return; end if;
  insert into private.rate_counters as r (user_id, action, window_start, n)
  values (p_user, p_action || ':' || p_window, date_trunc(p_window, now()), 1)
  on conflict (user_id, action, window_start) do update set n = r.n + 1
  returning r.n into used;
  if used > p_max then raise exception 'rate_limited'; end if;
  -- Tidy up now and then rather than with a scheduled job.
  if random() < 0.002 then
    delete from private.rate_counters where window_start < now() - interval '2 days';
  end if;
end $$;

-- action, per minute, per day
create function private.limits_for(p_table text) returns table (action text, per_minute integer, per_day integer)
language sql immutable set search_path = '' as $$
  select * from (values
    ('comments', 8, 300),
    ('messages', 30, 1500),
    ('follows', 30, 400),
    ('likes', 60, 2000),
    ('comment_likes', 60, 2000),
    ('reports', 5, 40),
    ('saves', 60, 1000),
    ('blocks', 20, 200)
  ) v (action, per_minute, per_day)
  where v.action = p_table
$$;

create function private.rate_limit_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l record;
begin
  if auth.uid() is null then return new; end if;
  select * into l from private.limits_for(tg_table_name);
  perform private.hit(auth.uid(), l.action, l.per_minute, 'minute');
  perform private.hit(auth.uid(), l.action, l.per_day, 'day');
  return new;
end $$;

create trigger comments_rate before insert on public.comments for each row execute function private.rate_limit_insert();
create trigger messages_rate before insert on public.messages for each row execute function private.rate_limit_insert();
create trigger follows_rate before insert on public.follows for each row execute function private.rate_limit_insert();
create trigger likes_rate before insert on public.likes for each row execute function private.rate_limit_insert();
create trigger comment_likes_rate before insert on public.comment_likes for each row execute function private.rate_limit_insert();
create trigger reports_rate before insert on public.reports for each row execute function private.rate_limit_insert();
create trigger saves_rate before insert on public.saves for each row execute function private.rate_limit_insert();
create trigger blocks_rate before insert on public.blocks for each row execute function private.rate_limit_insert();

-- Edits too: otherwise editing a comment over and over would be unlimited.
create function private.rate_limit_comment_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.body is distinct from old.body then
    perform private.hit(auth.uid(), 'comment_edits', 10, 'minute');
  end if;
  return new;
end $$;
create trigger comments_edit_rate before update on public.comments for each row execute function private.rate_limit_comment_edit();

-- ---------------------------------------------------------------- sign-in

-- login-with-username and request-reset call this with keys like 'u:<name>' and
-- 'ip:<address>', because Supabase's own limits only see the function's address.
create table private.login_attempts (
  key text not null,
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (key, window_start)
);
revoke all on private.login_attempts from public, anon, authenticated;

-- True while under p_max tries in the current 15 minutes.
create function public.note_login_attempt(p_key text, p_max integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  used integer;
  start timestamptz := date_trunc('hour', now()) + floor(extract(minute from now()) / 15) * interval '15 minutes';
begin
  insert into private.login_attempts as a (key, window_start, n) values (left(p_key, 200), start, 1)
  on conflict (key, window_start) do update set n = a.n + 1
  returning a.n into used;
  if random() < 0.01 then delete from private.login_attempts where window_start < now() - interval '1 day'; end if;
  return used <= p_max;
end $$;

revoke all on function private.hit(uuid, text, integer, text), public.note_login_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.note_login_attempt(text, integer) to service_role;
