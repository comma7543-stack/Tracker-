-- Discovery: a For You feed, ranked Scrolls, watch tracking and suggested people.
--
-- Teens (13-17) get no engagement ranking. Their For You and Scrolls are newest
-- first, narrowed only by topics they picked themselves. California's SB 976 and
-- similar laws restrict feeds that rank minors' content from data about them without
-- parental consent; a lawyer should confirm this setup before launch (PROGRESS.md).

-- ---------------------------------------------------------------- interests

-- Topics the person picked at sign-up. No column grant, so only the owner reads them,
-- through my_interests().
alter table public.profiles add column interests text[] not null default '{}';

create function public.set_interests(p_topics text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.profiles
  set interests = coalesce((
    select array_agg(distinct t order by t) from unnest(p_topics) t
    where t in ('Fitness', 'Learning', 'Work and tech', 'Money and health', 'Motivation')
  ), '{}')
  where id = auth.uid();
end $$;

create function public.my_interests() returns text[]
language sql stable security definer set search_path = '' as $$
  select interests from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------- views (watch time)

-- One row per person per post: the longest they watched or looked at it.
create table public.post_views (
  post_id uuid not null references public.posts (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  ms integer not null default 0 check (ms >= 0),
  created_at timestamptz not null default now(),
  primary key (post_id, viewer_id)
);
create index post_views_viewer_idx on public.post_views (viewer_id, created_at desc);
alter table public.post_views enable row level security;
revoke all on public.post_views from anon, authenticated;

create function public.record_view(p_post uuid, p_ms integer) returns void
language sql security definer set search_path = '' as $$
  insert into public.post_views (post_id, viewer_id, ms)
  select p.id, auth.uid(), least(greatest(p_ms, 0), 600000)
  from public.posts p
  where p.id = p_post and p.status = 'live' and auth.uid() is not null
    and private.can_view_content(auth.uid(), p.author_id)
  on conflict (post_id, viewer_id) do update set ms = greatest(public.post_views.ms, excluded.ms)
$$;

-- ---------------------------------------------------------------- ranking

-- Engagement over age, so new posts get a chance and old hits fade.
-- Comments count double likes; views count a little, and long watches more.
create function private.rank_score(p_post uuid, p_created timestamptz) returns double precision
language sql stable security definer set search_path = '' as $$
  select (
    1
    + (select count(*) from public.likes l where l.post_id = p_post)
    + 2 * (select count(*) from public.comments c where c.post_id = p_post)
    + coalesce((select sum(least(v.ms, 30000)) / 30000.0 from public.post_views v where v.post_id = p_post), 0) * 0.5
  ) / power(extract(epoch from (now() - p_created)) / 3600 + 2, 1.5)
$$;

-- Multiplies the score: 2x for a topic the viewer picked, 0.2x for something already seen.
create function private.rank_boost(p_viewer uuid, p_post uuid, p_topic text) returns double precision
language sql stable security definer set search_path = '' as $$
  select
    case when p_topic = any(coalesce((select interests from public.profiles where id = p_viewer), '{}')) then 2.0 else 1.0 end
    * case when exists (select 1 from public.post_views v where v.post_id = p_post and v.viewer_id = p_viewer) then 0.2 else 1.0 end
$$;

-- An empty interest list means every topic.
create function private.in_interests(p_viewer uuid, p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(cardinality(interests), 0) = 0 or p_topic = any(interests) or p_topic = 'Motivation'
  from public.profiles where id = p_viewer
$$;

-- Posts and scrolls from people the viewer doesn't support yet. Offset paging,
-- because a ranked order has no stable cursor. RLS applies through post_cards.
create function public.for_you_feed(p_offset integer default 0, p_limit integer default 20)
returns setof public.post_cards
language sql stable set search_path = '' as $$
  select c.* from public.post_cards c
  where c.kind in ('post', 'scroll') and c.status = 'live'
    and c.author_id <> auth.uid()
    and private.discoverable(auth.uid(), c.author_id)
    and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = c.author_id)
    and c.created_at > now() - interval '30 days'
    and (not private.is_minor(auth.uid()) or private.in_interests(auth.uid(), c.topic))
  order by
    case when private.is_minor(auth.uid()) then 0
      else private.rank_score(c.id, c.created_at) * private.rank_boost(auth.uid(), c.id, c.topic) end desc,
    c.created_at desc
  offset greatest(p_offset, 0)
  limit least(p_limit, 30)
$$;

-- Ranked Scrolls. People you support get a 1.5x lift.
create function public.scrolls_ranked(p_offset integer default 0, p_limit integer default 10)
returns setof public.post_cards
language sql stable set search_path = '' as $$
  select c.* from public.post_cards c
  where (c.kind = 'scroll' or c.also_scroll) and c.status = 'live'
    and private.discoverable(auth.uid(), c.author_id)
    and (not private.is_minor(auth.uid()) or private.in_interests(auth.uid(), c.topic)
      or private.follows_accepted(auth.uid(), c.author_id))
  order by
    case when private.is_minor(auth.uid()) then 0
      else private.rank_score(c.id, c.created_at) * private.rank_boost(auth.uid(), c.id, c.topic)
        * case when private.follows_accepted(auth.uid(), c.author_id) then 1.5 else 1.0 end end desc,
    c.created_at desc
  offset greatest(p_offset, 0)
  limit least(p_limit, 30)
$$;

-- ---------------------------------------------------------------- suggested people

-- People worth supporting: shared supporters first, then active people in the viewer's
-- topics. Only shows a streak the viewer is allowed to see, and only scores on it then.
create function public.suggested_people(p_limit integer default 20)
returns table (id uuid, username text, full_name text, avatar_url text, streak integer, top_topic text, mutuals integer)
language sql stable security definer set search_path = '' as $$
  with cand as (
    select p.id, p.username::text as username, p.full_name, p.avatar_url,
      case when private.can_see_streak(auth.uid(), p.id) then s.current end as streak,
      case when private.can_view_content(auth.uid(), p.id) then (
        select x.topic from public.posts x
        where x.author_id = p.id and x.status = 'live' and x.kind <> 'story'
        group by x.topic order by count(*) desc limit 1
      ) end as top_topic,
      (select count(*)::integer from public.follows f1
        join public.follows f2 on f2.follower_id = f1.followee_id and f2.status = 'accepted'
        where f1.follower_id = auth.uid() and f1.status = 'accepted' and f2.followee_id = p.id) as mutuals,
      (select count(*)::integer from public.posts x
        where x.author_id = p.id and x.status = 'live' and x.kind <> 'story'
          and x.created_at > now() - interval '14 days') as recent
    from public.profiles p
    left join public.streaks s on s.user_id = p.id
    where p.id <> auth.uid() and p.deleted_at is null
      and not private.blocked_between(auth.uid(), p.id)
      and private.discoverable(auth.uid(), p.id)
      and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id)
  )
  select c.id, c.username, c.full_name, c.avatar_url, c.streak, c.top_topic, c.mutuals
  from cand c
  where c.recent > 0 or c.mutuals > 0
  order by
    c.mutuals * 3 + least(c.recent, 10) + least(coalesce(c.streak, 0), 30) / 3.0
      + case when c.top_topic = any(coalesce((select interests from public.profiles where id = auth.uid()), '{}')) then 5 else 0 end desc,
    c.username
  limit least(p_limit, 50)
$$;

-- ---------------------------------------------------------------- grants

revoke all on function
  public.set_interests(text[]), public.my_interests(), public.record_view(uuid, integer),
  public.for_you_feed(integer, integer), public.scrolls_ranked(integer, integer), public.suggested_people(integer),
  private.rank_score(uuid, timestamptz), private.rank_boost(uuid, uuid, text), private.in_interests(uuid, text)
from public, anon, authenticated;
grant execute on function
  private.rank_score(uuid, timestamptz), private.rank_boost(uuid, uuid, text), private.in_interests(uuid, text)
to authenticated, service_role;
grant execute on function
  public.set_interests(text[]), public.my_interests(), public.record_view(uuid, integer),
  public.for_you_feed(integer, integer), public.scrolls_ranked(integer, integer), public.suggested_people(integer)
to authenticated;
