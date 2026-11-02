-- Push notifications through Expo's push service.
--
-- Triggers write to push_outbox inside the same transaction as the notification or
-- message, so nothing is sent for a row that rolled back. The send-push function
-- drains the outbox; a trigger pokes it through pg_net right away when it's set up,
-- and a once-a-minute job catches anything missed (supabase/sql/setup_services.sql).

create table public.push_tokens (
  token text primary key check (char_length(token) between 10 and 200),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

create table public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz
);
create index push_outbox_due_idx on public.push_outbox (id) where sent_at is null;
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated;

-- A phone's token moves to whoever signs in on it last.
create function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid()
$$;

-- ---------------------------------------------------------------- text

-- Push text is built here because the app isn't running when it arrives. English
-- and Korean, matching the in-app wording.
create function private.push_text(p_user uuid, p_key text, p_name text, p_extra text default '') returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce(nullif(private.choice(p_user, 'lang'), ''), 'en') = 'ko' then
    case p_key
      when 'like' then p_name || '님이 내 인증을 좋아해요.'
      when 'comment' then p_name || '님의 댓글: ' || p_extra
      when 'mention' then p_name || '님이 나를 언급했어요: ' || p_extra
      when 'follow' then p_name || '님이 나를 응원하기 시작했어요.'
      when 'follow_request' then p_name || '님이 나를 응원하고 싶어 해요.'
      when 'message' then p_name || ': ' || p_extra
      when 'photo' then p_name || '님이 사진을 보냈어요.'
      else p_extra
    end
  else
    case p_key
      when 'like' then p_name || ' liked your proof.'
      when 'comment' then p_name || ' commented: ' || p_extra
      when 'mention' then p_name || ' mentioned you: ' || p_extra
      when 'follow' then p_name || ' started supporting you.'
      when 'follow_request' then p_name || ' asked to support you.'
      when 'message' then p_name || ': ' || p_extra
      when 'photo' then p_name || ' sent a photo.'
      else p_extra
    end
  end
$$;

-- ---------------------------------------------------------------- enqueue

-- Best effort: if pg_net or the URL isn't set up, the minute job sends it instead.
create function private.kick_push() returns void
language plpgsql security definer set search_path = '' as $$
declare
  url text := private.config('push_url');
begin
  if url is null or to_regproc('net.http_post') is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(private.config('push_secret'), ''));
exception when others then
  return;
end $$;

-- Skips people with no phone registered, so the outbox only holds sendable rows.
create function private.enqueue_push(p_user uuid, p_body text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.push_tokens where user_id = p_user) then return; end if;
  insert into public.push_outbox (user_id, body, data) values (p_user, left(p_body, 180), p_data);
  perform private.kick_push();
end $$;

-- notify() already applied the person's settings, so every row here is wanted.
create function private.push_for_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor text := (select username::text from public.profiles where id = new.actor_id);
  extra text := coalesce(left((select body from public.comments where id = new.comment_id), 100), '');
begin
  if new.type = 'mention' and extra = '' then
    extra := coalesce(left((select caption from public.posts where id = new.post_id), 100), '');
  end if;
  perform private.enqueue_push(
    new.user_id,
    private.push_text(new.user_id, new.type, actor, extra),
    jsonb_build_object('type', new.type, 'post_id', new.post_id, 'comment_id', new.comment_id, 'actor_id', new.actor_id)
  );
  return new;
end $$;
create trigger notifications_push after insert on public.notifications
for each row execute function private.push_for_notification();

-- Messages have no notification row, so their settings are checked here.
create function private.push_for_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  recipient uuid := private.other_member(new.conversation_id, new.sender_id);
  sender text := (select username::text from public.profiles where id = new.sender_id);
begin
  if recipient is null or private.blocked_between(recipient, new.sender_id)
    or coalesce(private.pref(recipient, 'pauseAll'), false)
    or not coalesce(private.pref(recipient, 'nDms'), true) then
    return new;
  end if;
  perform private.enqueue_push(
    recipient,
    case when new.body = '' then private.push_text(recipient, 'photo', sender)
      else private.push_text(recipient, 'message', sender, left(new.body, 100)) end,
    jsonb_build_object('type', 'message', 'conversation_id', new.conversation_id)
  );
  return new;
end $$;
create trigger messages_push after insert on public.messages
for each row execute function private.push_for_message();

-- ---------------------------------------------------------------- send-push calls these

-- Hands out up to p_limit unsent rows with their tokens. A claim lapses after a
-- minute, so a crashed send is retried; after 5 tries a row is dropped.
create function public.claim_push_batch(p_limit integer default 200)
returns table (outbox_id bigint, token text, body text, data jsonb, badge integer)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select o.id from public.push_outbox o
    where o.sent_at is null and o.attempts < 5
      and (o.claimed_at is null or o.claimed_at < now() - interval '1 minute')
    order by o.id
    limit least(p_limit, 500)
    for update skip locked
  ), claimed as (
    update public.push_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from due where o.id = due.id
    returning o.id, o.user_id, o.body, o.data
  )
  select c.id, t.token, c.body, c.data,
    (select count(*)::integer from public.notifications n where n.user_id = c.user_id and n.read_at is null)
  from claimed c join public.push_tokens t on t.user_id = c.user_id;
end $$;

create function public.finish_push_batch(p_sent bigint[], p_dead_tokens text[]) returns void
language sql security definer set search_path = '' as $$
  update public.push_outbox set sent_at = now() where id = any(p_sent);
  delete from public.push_tokens where token = any(p_dead_tokens);
  -- Sent rows are only kept a week.
  delete from public.push_outbox where sent_at < now() - interval '7 days';
$$;

revoke all on function
  public.register_push_token(text, text), public.unregister_push_token(text),
  public.claim_push_batch(integer), public.finish_push_batch(bigint[], text[]),
  private.kick_push(), private.enqueue_push(uuid, text, jsonb), private.push_text(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.register_push_token(text, text), public.unregister_push_token(text) to authenticated;
grant execute on function public.claim_push_batch(integer), public.finish_push_batch(bigint[], text[]) to service_role;
