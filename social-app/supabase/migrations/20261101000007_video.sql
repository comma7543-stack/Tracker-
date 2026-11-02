-- Server-side video processing (worker/). When the worker is turned on, a new video
-- waits until the worker has re-encoded it (dropping GPS and all other metadata) and
-- pulled its own frames, so moderation never judges frames the phone chose.
--
-- Off by default, so videos keep working before the worker runs. Turn it on once the
-- worker is deployed:  insert into private.app_config values ('video_worker', 'on');

alter table public.posts add column media_ready boolean not null default true;
alter table public.posts add column worker_claimed_at timestamptz;

create function private.video_needs_worker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.media_ready := not (new.media_type = 'video' and coalesce(private.config('video_worker'), 'off') = 'on');
  return new;
end $$;
create trigger posts_media_ready before insert on public.posts
for each row execute function private.video_needs_worker();

-- No model call until the file is ready: moderate-post gets 'busy' and the post waits.
create or replace function public.claim_moderation_check(p_post uuid, p_daily_limit integer) returns text
language plpgsql security definer set search_path = '' as $$
declare
  used_now integer;
begin
  update public.posts set check_claimed_at = now()
  where id = p_post and status = 'checking' and media_ready
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

-- ---------------------------------------------------------------- worker calls (service role)

-- A claim lapses after 10 minutes, so a crashed worker's video is picked up again.
create function public.worker_claim_videos(p_limit integer default 3)
returns table (id uuid, author_id uuid, media_path text, goal_proof boolean)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select p.id from public.posts p
    where not p.media_ready and p.status = 'checking'
      and (p.worker_claimed_at is null or p.worker_claimed_at < now() - interval '10 minutes')
    order by p.created_at
    limit least(p_limit, 10)
    for update skip locked
  )
  update public.posts p set worker_claimed_at = now()
  from due where p.id = due.id
  returning p.id, p.author_id, p.media_path, p.goal_proof;
end $$;

-- ok: the file is replaced and frames are written. Not ok: it isn't a usable video
-- (unreadable, too long). That's rejected with no strike, like other invalid files.
create function public.worker_video_done(p_post uuid, p_ok boolean, p_info jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.posts set media_ready = true, moderation = moderation || jsonb_build_object('video', p_info)
    where id = p_post and not media_ready;
  else
    update public.posts set media_ready = true, status = 'rejected',
      moderation = moderation || jsonb_build_object('violation', null, 'reason', 'invalid_file', 'video', p_info)
    where id = p_post and status = 'checking';
  end if;
end $$;

-- Stories expired over a day ago whose files are still stored.
create function public.worker_expired_stories(p_limit integer default 50)
returns table (id uuid, media_path text, media_type text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.media_path, p.media_type from public.posts p
  where p.kind = 'story' and p.expires_at < now() - interval '1 day'
    and not coalesce((p.moderation ->> 'files_deleted')::boolean, false)
  order by p.expires_at
  limit least(p_limit, 200)
$$;

create function public.worker_mark_files_deleted(p_posts uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.posts set moderation = moderation || '{"files_deleted": true}' where id = any(p_posts)
$$;

revoke all on function
  public.worker_claim_videos(integer), public.worker_video_done(uuid, boolean, jsonb),
  public.worker_expired_stories(integer), public.worker_mark_files_deleted(uuid[])
from public, anon, authenticated;
grant execute on function
  public.worker_claim_videos(integer), public.worker_video_done(uuid, boolean, jsonb),
  public.worker_expired_stories(integer), public.worker_mark_files_deleted(uuid[])
to service_role;
