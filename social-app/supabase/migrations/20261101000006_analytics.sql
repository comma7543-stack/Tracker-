-- First-party analytics and crash reports. Kept in this database instead of a
-- third-party service, so teens' usage data goes nowhere else. No IP addresses,
-- no device IDs, no content: event names and a few small properties.
-- Read them in the SQL editor through the admin_* views at the bottom.

create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z_]{1,39}$'),
  props jsonb not null default '{}',
  session_id text check (char_length(session_id) <= 40),
  platform text check (platform in ('ios', 'android', 'web')),
  app_version text check (char_length(app_version) <= 20),
  at timestamptz not null default now()
);
create index analytics_events_name_idx on public.analytics_events (name, at desc);
create index analytics_events_user_idx on public.analytics_events (user_id, at desc);

create table public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  message text not null,
  stack text,
  screen text,
  fatal boolean not null default false,
  platform text,
  app_version text,
  at timestamptz not null default now()
);
create index client_errors_at_idx on public.client_errors (at desc);

alter table public.analytics_events enable row level security;
alter table public.client_errors enable row level security;
revoke all on public.analytics_events, public.client_errors from anon, authenticated;

-- Up to 50 events per call. Times are trusted only within a day either way, since a
-- phone's clock can be wrong.
create function public.log_events(p_events jsonb, p_platform text, p_version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or jsonb_typeof(p_events) <> 'array' then return; end if;
  perform private.hit(auth.uid(), 'log_events', 20, 'minute');
  insert into public.analytics_events (user_id, name, props, session_id, platform, app_version, at)
  select auth.uid(), e ->> 'name',
    case when jsonb_typeof(e -> 'props') = 'object' and pg_column_size(e -> 'props') <= 1024 then e -> 'props' else '{}' end,
    left(e ->> 'session_id', 40),
    case when p_platform in ('ios', 'android', 'web') then p_platform end,
    left(p_version, 20),
    case when (e ->> 'at') ~ '^\d{4}-\d{2}-\d{2}T'
      and (e ->> 'at')::timestamptz between now() - interval '1 day' and now() + interval '5 minutes'
      then (e ->> 'at')::timestamptz else now() end
  from (select e from jsonb_array_elements(p_events) e limit 50) x
  where (e ->> 'name') ~ '^[a-z][a-z_]{1,39}$';
end $$;

-- Crashes can happen before sign-in, so anon may call this. Signed-out reports share
-- one counter, so they can't flood the table.
create function public.log_error(p_message text, p_stack text, p_screen text, p_fatal boolean, p_platform text, p_version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.hit(coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'), 'log_error', case when auth.uid() is null then 60 else 10 end, 'minute');
  insert into public.client_errors (user_id, message, stack, screen, fatal, platform, app_version)
  values (auth.uid(), left(coalesce(p_message, ''), 500), left(p_stack, 4000), left(p_screen, 200), coalesce(p_fatal, false),
    case when p_platform in ('ios', 'android', 'web') then p_platform end, left(p_version, 20));
end $$;

-- ---------------------------------------------------------------- for the owner (SQL editor only)

-- People who opened the app each day.
create view public.admin_daily_active as
  select (at at time zone 'utc')::date as day, count(distinct user_id) as people
  from public.analytics_events
  where name = 'app_open' and at > now() - interval '60 days'
  group by 1 order by 1 desc;

-- Of the people who signed up each week, how many came back after 1, 7 and 30 days.
create view public.admin_retention as
  select date_trunc('week', p.created_at)::date as signup_week,
    count(*) as signed_up,
    count(*) filter (where exists (select 1 from public.analytics_events e where e.user_id = p.id and e.name = 'app_open'
      and e.at >= p.created_at + interval '1 day' and e.at < p.created_at + interval '2 days')) as back_day_1,
    count(*) filter (where exists (select 1 from public.analytics_events e where e.user_id = p.id and e.name = 'app_open'
      and e.at >= p.created_at + interval '7 days' and e.at < p.created_at + interval '8 days')) as back_day_7,
    count(*) filter (where exists (select 1 from public.analytics_events e where e.user_id = p.id and e.name = 'app_open'
      and e.at >= p.created_at + interval '30 days' and e.at < p.created_at + interval '31 days')) as back_day_30
  from public.profiles p
  where p.created_at > now() - interval '120 days'
  group by 1 order by 1 desc;

-- Where new people drop off, for those who signed up in the last 30 days.
create view public.admin_funnel as
  with recent as (select id from public.profiles where created_at > now() - interval '30 days')
  select
    (select count(*) from recent) as signed_up,
    (select count(*) from recent r where exists (select 1 from public.follows f where f.follower_id = r.id)) as supported_someone,
    (select count(*) from recent r where exists (select 1 from public.posts p where p.author_id = r.id and p.status = 'live' and p.kind <> 'story')) as posted_once,
    (select count(*) from recent r where (select count(distinct (p.created_at at time zone 'utc')::date) from public.posts p
      where p.author_id = r.id and p.status = 'live' and p.kind <> 'story') >= 2) as posted_two_days,
    (select count(*) from recent r where exists (select 1 from public.streaks s where s.user_id = r.id and s.current >= 7)) as streak_7;

-- The most common crashes this week.
create view public.admin_top_errors as
  select left(message, 200) as message, count(*) as times, count(distinct user_id) as people,
    bool_or(fatal) as ever_fatal, max(at) as last_seen, max(app_version) as latest_version
  from public.client_errors
  where at > now() - interval '7 days'
  group by 1 order by 2 desc limit 50;

-- Which events happen how often, to check the tracking works.
create view public.admin_event_counts as
  select name, count(*) as times, count(distinct user_id) as people
  from public.analytics_events where at > now() - interval '7 days'
  group by 1 order by 2 desc;

revoke all on public.admin_daily_active, public.admin_retention, public.admin_funnel, public.admin_top_errors,
  public.admin_event_counts, public.admin_open_appeals from anon, authenticated;

-- A short version for the admin screen.
create function public.admin_metrics()
returns table (active_today integer, active_7d integer, signups_7d integer, posts_7d integer, errors_24h integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select
    (select count(distinct user_id)::integer from public.analytics_events where name = 'app_open' and at > now() - interval '1 day'),
    (select count(distinct user_id)::integer from public.analytics_events where name = 'app_open' and at > now() - interval '7 days'),
    (select count(*)::integer from public.profiles where created_at > now() - interval '7 days'),
    (select count(*)::integer from public.posts where status = 'live' and kind <> 'story' and created_at > now() - interval '7 days'),
    (select count(*)::integer from public.client_errors where at > now() - interval '1 day');
end $$;

revoke all on function public.log_events(jsonb, text, text), public.log_error(text, text, text, boolean, text, text), public.admin_metrics()
from public, anon, authenticated;
grant execute on function public.log_events(jsonb, text, text), public.admin_metrics() to authenticated;
grant execute on function public.log_error(text, text, text, boolean, text, text) to anon, authenticated;
