-- Hashtags, mentions in captions, and indexed search.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- hashtags

create table public.post_tags (
  post_id uuid not null references public.posts (id) on delete cascade,
  tag text not null check (tag ~ '^[a-z0-9_가-힣]{1,30}$'),
  primary key (post_id, tag)
);
create index post_tags_tag_idx on public.post_tags (tag);
alter table public.post_tags enable row level security;
revoke all on public.post_tags from anon, authenticated;
grant select on public.post_tags to authenticated;
-- The posts policy decides whether the tag's post is visible.
create policy post_tags_select on public.post_tags for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

-- Captions can't be edited, so tags are read once, on insert. At most 10 per post.
create function private.tags_of(p_text text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select lower(m[1]) as t
    from regexp_matches(coalesce(p_text, ''), '#([A-Za-z0-9_가-힣]{1,30})', 'g') as m
    limit 10
  ) x
$$;

create function private.post_tags_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.post_tags (post_id, tag)
  select new.id, t from unnest(private.tags_of(new.caption)) t
  on conflict do nothing;
  return new;
end $$;
create trigger posts_tags after insert on public.posts
for each row execute function private.post_tags_insert();

-- Tags used by the most people this week, counted only on posts anyone could find:
-- public accounts, and no teen accounts, so a tag can't point adults at a teen.
create function public.trending_tags(p_limit integer default 12)
returns table (tag text, posts integer)
language sql stable security definer set search_path = '' as $$
  select t.tag, count(distinct p.author_id)::integer
  from public.post_tags t
  join public.posts p on p.id = t.post_id
  join public.profiles a on a.id = p.author_id
  where p.status = 'live' and p.kind <> 'story' and p.created_at > now() - interval '7 days'
    and not a.is_private and a.deleted_at is null and not private.is_minor(a.id)
  group by t.tag
  order by 2 desc, t.tag
  limit least(p_limit, 30)
$$;

-- RLS applies through post_cards and post_tags.
create function public.tag_posts(p_tag text, p_offset integer default 0, p_limit integer default 40)
returns setof public.post_cards
language sql stable set search_path = '' as $$
  select c.* from public.post_cards c
  where c.kind in ('post', 'scroll') and c.status = 'live'
    and private.discoverable(auth.uid(), c.author_id)
    and exists (select 1 from public.post_tags t where t.post_id = c.id and t.tag = lower(ltrim(p_tag, '#')))
  order by c.created_at desc
  offset greatest(p_offset, 0)
  limit least(p_limit, 60)
$$;

-- ---------------------------------------------------------------- mentions in captions

-- Comments already notify mentions. Captions do once the post goes live, since a post
-- still being checked must not reach anyone.
create function private.post_mentions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  mentioned uuid;
begin
  if new.status <> 'live' or old.status = 'live' or new.kind = 'story' then return new; end if;
  for mentioned in
    select p.id from public.profiles p
    where p.username::text in (
      select lower(m[1]) from regexp_matches(new.caption, '@([A-Za-z0-9._]{3,30})', 'g') as m limit 10
    )
  loop
    if private.can_view_content(mentioned, new.author_id) then
      perform private.notify(mentioned, new.author_id, 'mention', new.id, null);
    end if;
  end loop;
  return new;
end $$;
create trigger posts_mentions after update of status on public.posts
for each row execute function private.post_mentions();

-- ---------------------------------------------------------------- indexed search

create index profiles_username_trgm on public.profiles using gin ((username::text) extensions.gin_trgm_ops);
create index profiles_full_name_trgm on public.profiles using gin (full_name extensions.gin_trgm_ops);
create index posts_caption_trgm on public.posts using gin (caption extensions.gin_trgm_ops);

create function private.like_pattern(p_q text) returns text
language sql immutable set search_path = '' as $$
  select '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

-- Same contract as before. A query starting with # searches tags.
create or replace function public.explore(p_q text default '', p_topic text default null, p_limit integer default 40)
returns setof public.post_cards
language sql stable set search_path = '' as $$
  select c.* from public.post_cards c
  where c.kind in ('post', 'scroll') and c.status = 'live'
    and c.author_id <> auth.uid()
    and private.discoverable(auth.uid(), c.author_id)
    and (p_topic is null or c.topic = p_topic)
    and (
      coalesce(trim(p_q), '') = ''
      or (left(trim(p_q), 1) = '#' and exists (
        select 1 from public.post_tags t where t.post_id = c.id and t.tag = lower(ltrim(trim(p_q), '#'))))
      or (left(trim(p_q), 1) <> '#' and (
        c.caption ilike private.like_pattern(trim(p_q))
        or c.username ilike private.like_pattern(trim(p_q))
        or c.subtag ilike private.like_pattern(trim(p_q))
        or c.topic ilike private.like_pattern(trim(p_q))))
    )
  order by
    case when coalesce(trim(p_q), '') = '' and not private.is_minor(auth.uid())
      then private.rank_score(c.id, c.created_at) else 0 end desc,
    c.created_at desc
  limit least(p_limit, 60)
$$;

create or replace function public.search_users(p_q text, p_limit integer default 20)
returns table (id uuid, username text, full_name text, avatar_url text)
language sql stable set search_path = '' as $$
  select p.id, p.username::text, p.full_name, p.avatar_url
  from public.profiles p
  where p.id <> auth.uid()
    and private.discoverable(auth.uid(), p.id)
    and (p.username::text ilike private.like_pattern(ltrim(trim(p_q), '@')) or p.full_name ilike private.like_pattern(trim(p_q)))
  order by
    (lower(p.username::text) = lower(ltrim(trim(p_q), '@'))) desc,
    extensions.similarity(p.username::text, ltrim(trim(p_q), '@')) desc,
    p.username::text
  limit least(p_limit, 50)
$$;

revoke all on function
  public.trending_tags(integer), public.tag_posts(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.trending_tags(integer), public.tag_posts(text, integer, integer) to authenticated;
grant execute on function private.tags_of(text), private.like_pattern(text) to authenticated, service_role;
