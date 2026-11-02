-- Limits that keep model costs bounded.
--
-- Counters instead of counting posts: deleting a post must not hand back its slot,
-- because its check has already been paid for. Blocked posts count for the same reason.
-- Stories have no limit: they make no model call (see moderation.ts).

create table public.daily_post_counts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  used integer not null default 0,
  proofs integer not null default 0,
  primary key (user_id, day)
);

create table public.moderation_usage (
  day date primary key,
  checks integer not null default 0
);

-- Not granted to users: they could otherwise read when another check was claimed.
alter table public.posts add column check_claimed_at timestamptz;

-- RLS on, no policies, no grants: only the functions below touch these.
alter table public.daily_post_counts enable row level security;
alter table public.moderation_usage enable row level security;
revoke all on public.daily_post_counts, public.moderation_usage from anon, authenticated;

-- Posts and scrolls combined, per person per day. Change the number here; the app reads it.
create function private.daily_post_limit() returns integer
language sql immutable set search_path = '' as $$
  select 5
$$;

-- ponytail: a user can change time zone to reach another calendar day, at most a
-- couple of extra days' worth. The all-users ceiling below still holds.
create function private.local_day(p_user uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select s.timezone from public.streaks s where s.user_id = p_user), 'UTC'))::date
$$;

-- auth.uid() is null for the service role and SQL editor, so admin work isn't limited.
-- A failed insert rolls this back too, so a rejected post uses no slot.
create function private.count_daily_post() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  used_now integer;
begin
  if auth.uid() is null or new.kind = 'story' then return new; end if;
  insert into public.daily_post_counts as c (user_id, day, used)
  values (new.author_id, private.local_day(new.author_id), 1)
  on conflict (user_id, day) do update set used = c.used + 1
    where c.used < private.daily_post_limit()
  returning c.used into used_now;
  if used_now is null then raise exception 'daily_limit_reached'; end if;
  return new;
end $$;
create trigger posts_count_daily before insert on public.posts
for each row execute function private.count_daily_post();

-- Proofs cost an AI check even as stories, so they have their own limit. Copies the goal,
-- so a post can only ever finish the goal it was judged against.
create function private.count_goal_proof() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  used_now integer;
begin
  if not new.goal_proof then return new; end if;
  select nullif(goal, '') into new.proof_goal from public.profiles where id = new.author_id;
  if new.proof_goal is null then raise exception 'no_goal'; end if;
  if auth.uid() is null then return new; end if;
  insert into public.daily_post_counts as c (user_id, day, proofs)
  values (new.author_id, private.local_day(new.author_id), 1)
  on conflict (user_id, day) do update set proofs = c.proofs + 1
    where c.proofs < 3
  returning c.proofs into used_now;
  if used_now is null then raise exception 'goal_proof_limit'; end if;
  return new;
end $$;
create trigger posts_count_proof before insert on public.posts
for each row execute function private.count_goal_proof();

create function public.posting_limits() returns table (posts_used integer, posts_limit integer)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select c.used from public.daily_post_counts c
      where c.user_id = auth.uid() and c.day = private.local_day(auth.uid())), 0),
    private.daily_post_limit()
$$;

-- Called by moderate-post right before each model call. 'busy' means a check of this
-- post ran in the last 3 minutes, so repeat calls can't each buy a model call; the
-- window matches the SDK's longest time on one call (3 tries, 60 seconds each).
-- 'over_limit' means the day's ceiling is reached; the post waits for tomorrow.
create function public.claim_moderation_check(p_post uuid, p_daily_limit integer) returns text
language plpgsql security definer set search_path = '' as $$
declare
  used_now integer;
begin
  update public.posts set check_claimed_at = now()
  where id = p_post and status = 'checking'
    and (check_claimed_at is null or check_claimed_at < now() - interval '3 minutes');
  if not found then return 'busy'; end if;

  if p_daily_limit > 0 then
    insert into public.moderation_usage as u (day, checks)
    values ((now() at time zone 'utc')::date, 1)
    on conflict (day) do update set checks = u.checks + 1 where u.checks < p_daily_limit
    returning u.checks into used_now;
  end if;

  if used_now is null then
    update public.posts set check_claimed_at = null where id = p_post;
    return 'over_limit';
  end if;
  return 'ok';
end $$;

revoke all on function private.daily_post_limit(), private.local_day(uuid), private.count_daily_post(), private.count_goal_proof() from public, anon, authenticated;
revoke all on function public.posting_limits(), public.claim_moderation_check(uuid, integer) from public, anon, authenticated;
grant execute on function public.posting_limits() to authenticated;
grant execute on function public.claim_moderation_check(uuid, integer) to service_role;
