-- An in-app review queue for the adults who moderate, and push alerts when
-- something lands in it. Make someone an admin from the SQL editor:
--   insert into admins (user_id) select id from profiles where username = 'their.name';

create table public.admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create function private.is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = p_user)
$$;

create function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin(auth.uid()) then raise exception 'forbidden'; end if;
end $$;

create function public.am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin(auth.uid())
$$;

-- Admins can open any post's file and any reported message photo, to judge reports
-- and appeals. Quarantine stays service role only: those files are never shown in the app.
create policy media_admin_select on storage.objects for select to authenticated using (
  bucket_id in ('media', 'message-photos') and private.is_admin(auth.uid())
);

-- ---------------------------------------------------------------- queue

-- Open reports with what they point at, oldest first.
create function public.admin_reports()
returns table (
  report_id uuid, created_at timestamptz, reason text, target_type text, target_id uuid,
  reporter text, subject_id uuid, subject text, subject_is_minor boolean,
  post_id uuid, kind text, media_path text, media_type text, caption text, body text, photo_path text,
  open_on_target integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query
  select r.id, r.created_at, r.reason, r.target_type, r.target_id,
    rp.username::text,
    subj.id, subj.username::text, private.is_minor(subj.id),
    coalesce(p.id, c.post_id), p.kind, p.media_path, p.media_type, p.caption,
    coalesce(c.body, m.body, u.bio), m.photo_path,
    (select count(*)::integer from public.reports r2 where r2.status = 'open' and r2.target_id = r.target_id)
  from public.reports r
  join public.profiles rp on rp.id = r.reporter_id
  left join public.posts p on r.target_type = 'post' and p.id = r.target_id
  left join public.comments c on r.target_type = 'comment' and c.id = r.target_id
  left join public.messages m on r.target_type = 'message' and m.id = r.target_id
  left join public.profiles u on r.target_type = 'user' and u.id = r.target_id
  left join public.profiles subj on subj.id = coalesce(p.author_id, c.author_id, m.sender_id, u.id)
  where r.status = 'open'
  order by r.created_at
  limit 100;
end $$;

create function public.admin_appeals()
returns table (appeal_id uuid, created_at timestamptz, post_id uuid, username text, kind text,
  media_path text, media_type text, caption text, subtag text, status text, verdict jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query
  select a.id, a.created_at, p.id, u.username::text, p.kind, p.media_path, p.media_type, p.caption, p.subtag, p.status,
    -- Only the verdict fields: attempts and errors are noise here.
    jsonb_build_object('on_topic', p.moderation -> 'on_topic', 'violation', p.moderation -> 'violation', 'reason', p.moderation -> 'reason')
  from public.appeals a
  join public.posts p on p.id = a.post_id
  join public.profiles u on u.id = a.user_id
  where a.status = 'open'
  order by a.created_at
  limit 100;
end $$;

-- Counts only. Safety cases are never shown in the app: see README "Safety cases".
create function public.admin_counts()
returns table (open_reports integer, open_appeals integer, open_safety integer, stuck_posts integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select
    (select count(*)::integer from public.reports where status = 'open'),
    (select count(*)::integer from public.appeals where status = 'open'),
    (select count(*)::integer from public.safety_escalations where handled_at is null),
    (select count(*)::integer from public.posts where status = 'checking' and coalesce((moderation ->> 'attempts')::int, 0) >= 5);
end $$;

-- dismiss: nothing wrong. remove: take the content down. suspend: take it down and
-- pause the author's posting for 7 days. Every open report on the same target closes.
create function public.admin_resolve_report(p_report uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  author uuid;
begin
  perform private.require_admin();
  if p_action not in ('dismiss', 'remove', 'suspend') then raise exception 'invalid_action'; end if;
  select * into r from public.reports where id = p_report and status = 'open';
  if not found then raise exception 'report_not_open'; end if;

  if p_action <> 'dismiss' then
    case r.target_type
      when 'post' then
        update public.posts set status = 'removed' where id = r.target_id returning author_id into author;
      when 'comment' then
        delete from public.comments where id = r.target_id returning author_id into author;
      when 'message' then
        update public.messages set photo_removed_at = coalesce(photo_removed_at, now()), body = case when body = '' then body else '[removed]' end
        where id = r.target_id returning sender_id into author;
      when 'user' then
        author := r.target_id;
      else
        null;
    end case;
    if p_action = 'suspend' and author is not null then
      update public.profiles set suspended_until = greatest(coalesce(suspended_until, now()), now() + interval '7 days')
      where id = author;
    end if;
  end if;

  update public.reports set status = case when p_action = 'dismiss' then 'dismissed' else 'reviewed' end
  where status = 'open' and (id = p_report or (r.target_id is not null and target_id = r.target_id and target_type = r.target_type));
end $$;

-- The SQL editor version stays for scripts; this one records which admin decided.
create function public.admin_decide_appeal(p_appeal uuid, p_overturn boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform public.admin_resolve_appeal(p_appeal, p_overturn, auth.uid());
end $$;

-- ---------------------------------------------------------------- alerts

-- Bypasses the admin's own notification settings: reports need someone.
create function private.alert_admins(p_body text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a uuid;
begin
  for a in select user_id from public.admins loop
    if exists (select 1 from public.push_tokens where user_id = a) then
      insert into public.push_outbox (user_id, body, data) values (a, p_body, p_data);
    end if;
  end loop;
  perform private.kick_push();
end $$;

create function private.alert_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  is_story boolean := new.target_type = 'post'
    and exists (select 1 from public.posts where id = new.target_id and kind = 'story');
begin
  perform private.alert_admins(
    case when is_story then 'Story reported. Stories are not checked first, so review it soon: '
      else 'New report (' || new.target_type || '): ' end || left(new.reason, 80),
    jsonb_build_object('type', 'admin', 'report_id', new.id)
  );
  return new;
end $$;
create trigger reports_alert after insert on public.reports
for each row execute function private.alert_report();

create function private.alert_appeal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.alert_admins('New review request. The app promises an answer within 24 hours.', jsonb_build_object('type', 'admin'));
  return new;
end $$;
create trigger appeals_alert after insert on public.appeals
for each row execute function private.alert_appeal();

create function private.alert_safety() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.alert_admins('Safety case opened. An adult must handle it today: see README "Safety cases".', jsonb_build_object('type', 'admin'));
  return new;
end $$;
create trigger safety_alert after insert on public.safety_escalations
for each row execute function private.alert_safety();

revoke all on function
  public.am_i_admin(), public.admin_reports(), public.admin_appeals(), public.admin_counts(),
  public.admin_resolve_report(uuid, text), public.admin_decide_appeal(uuid, boolean),
  private.alert_admins(text, jsonb)
from public, anon, authenticated;
grant execute on function private.is_admin(uuid), private.require_admin() to authenticated, service_role;
grant execute on function
  public.am_i_admin(), public.admin_reports(), public.admin_appeals(), public.admin_counts(),
  public.admin_resolve_report(uuid, text), public.admin_decide_appeal(uuid, boolean)
to authenticated;
