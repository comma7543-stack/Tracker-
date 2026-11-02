-- Rules enforced in the database: helpers, triggers, views and RPCs.

-- ---------------------------------------------------------------- helpers

create function private.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  )
$$;

create function private.follows_accepted(p_follower uuid, p_followee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.follows
    where follower_id = p_follower and followee_id = p_followee and status = 'accepted'
  )
$$;

-- Can the viewer see this user's profile row at all?
create function private.can_see_profile(p_viewer uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_viewer = p_owner or exists (
    select 1 from public.profiles p
    where p.id = p_owner and p.deleted_at is null and not private.blocked_between(p_viewer, p_owner)
  )
$$;

-- Can the viewer see this user's content? Adds the private-account rule.
create function private.can_view_content(p_viewer uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_viewer = p_owner or exists (
    select 1 from public.profiles p
    where p.id = p_owner
      and p.deleted_at is null
      and not private.blocked_between(p_viewer, p_owner)
      and (not p.is_private or private.follows_accepted(p_viewer, p_owner))
  )
$$;

create function private.choice(p_user uuid, p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select choices ->> p_key from public.settings where user_id = p_user
$$;

create function private.pref(p_user uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (prefs ->> p_key)::boolean from public.settings where user_id = p_user
$$;

create function private.is_minor(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select dob > current_date - interval '18 years' from public.profiles where id = p_user), false)
$$;

-- Discovery rule: a 13-17 year old never appears in recommendations or search
-- for an adult they don't follow.
create function private.discoverable(p_viewer uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_viewer = p_author
    or not private.is_minor(p_author)
    or private.is_minor(p_viewer)
    or private.follows_accepted(p_author, p_viewer)
$$;

-- Suspended when 3+ strikes are active and the latest is under 7 days old, or
-- when an admin/safety suspension is in force. Once the 7 days pass with strikes
-- still active, posting resumes and one more strike suspends again.
create function private.is_suspended(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = p_user and (deleted_at is not null or suspended_until > now())
  ) or coalesce((
    select count(*) >= 3 and max(created_at) + interval '7 days' > now()
    from public.strikes
    where user_id = p_user and not voided and expires_at > now()
  ), false)
$$;

create function private.can_see_streak(p_viewer uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_viewer = p_owner or (
    private.can_view_content(p_viewer, p_owner)
    and case private.choice(p_owner, 'streakWho')
      when 'Everyone' then true
      when 'Followers' then private.follows_accepted(p_viewer, p_owner)
      else false
    end
  )
$$;

create function private.can_see_lists(p_viewer uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_viewer = p_owner or (
    private.can_see_profile(p_viewer, p_owner)
    and private.can_view_content(p_viewer, p_owner)
    and coalesce((select (prefs ->> 'showLists')::boolean from public.settings where user_id = p_owner), false)
  )
$$;

create function private.can_comment(p_user uuid, p_post uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post and p.status = 'live'
      and (p.expires_at is null or p.expires_at > now())
      and private.can_view_content(p_user, p.author_id)
      and (
        p.author_id = p_user
        or case private.choice(p.author_id, 'commentWho')
          when 'Everyone' then true
          when 'People you follow' then private.follows_accepted(p.author_id, p_user)
          else false
        end
      )
  )
$$;

create function private.can_message(p_sender uuid, p_recipient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_sender <> p_recipient
    and not private.blocked_between(p_sender, p_recipient)
    and exists (select 1 from public.profiles where id = p_recipient and deleted_at is null)
    and case private.choice(p_recipient, 'dmWho')
      when 'Everyone' then true
      when 'People you follow' then private.follows_accepted(p_recipient, p_sender)
      else false
    end
$$;

create function private.is_member(p_conversation uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and user_id = p_user
  )
$$;

create function private.other_member(p_conversation uuid, p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.conversation_members
  where conversation_id = p_conversation and user_id <> p_user
  limit 1
$$;

-- ---------------------------------------------------------------- settings and signup

create function private.default_settings_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.settings (user_id, prefs, choices) values (
    new.id,
    jsonb_build_object(
      'autoFreeze', true, 'streakRemind', true, 'pauseAll', false, 'nLikes', true,
      'nFollows', true, 'nDms', true, 'isPrivate', new.is_private, 'hideOffensive', true,
      'dataSaver', false, 'autoplayWifi', false, 'reduceMotion', false,
      -- Who a teen's friends are stays hidden unless they choose to show it.
      'showLists', new.dob <= current_date - interval '18 years'
    ),
    jsonb_build_object(
      'reminderTime', '9 PM', 'timeLimit', 'Off', 'dmWho', 'People you follow',
      'commentWho', 'Everyone', 'streakWho', 'Everyone', 'theme', 'white', 'lang', 'en'
    )
  );
  insert into public.streaks (user_id) values (new.id);
  return new;
end $$;
create trigger profiles_defaults after insert on public.profiles
for each row execute function private.default_settings_row();

-- settings.prefs.isPrivate is what the app edits; profiles.is_private is what RLS reads.
create function private.sync_private() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  now_private boolean := coalesce((new.prefs ->> 'isPrivate')::boolean, false);
begin
  if now_private is distinct from coalesce((old.prefs ->> 'isPrivate')::boolean, false) then
    update public.profiles set is_private = now_private where id = new.user_id;
    if not now_private then
      update public.follows set status = 'accepted' where followee_id = new.user_id and status = 'pending';
    end if;
  end if;
  return new;
end $$;
create trigger settings_sync_private after update of prefs on public.settings
for each row execute function private.sync_private();

create function private.valid_timezone(p_tz text) returns text
language sql stable set search_path = '' as $$
  select coalesce((select name from pg_catalog.pg_timezone_names where name = p_tz limit 1), 'UTC')
$$;

-- Last step of onboarding. The age and username rules live here, not just in the app.
create function public.complete_signup(
  p_full_name text, p_username text, p_dob date, p_terms_version text, p_timezone text, p_goal text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_dob > current_date - interval '13 years' then raise exception 'under_13'; end if;
  if p_dob < current_date - interval '120 years' then raise exception 'invalid_birthday'; end if;
  begin
    insert into public.profiles (id, username, full_name, goal, dob, is_private, terms_version, terms_accepted_at)
    values (
      uid, lower(p_username), p_full_name, left(trim(p_goal), 100), p_dob,
      -- Users 13-17 default to private.
      p_dob > current_date - interval '18 years',
      p_terms_version, now()
    );
  exception when unique_violation then
    raise exception 'username_taken';
  end;
  update public.streaks set timezone = private.valid_timezone(p_timezone) where user_id = uid;
end $$;

create function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where username::text = lower(p_username))
$$;

create function public.set_timezone(p_timezone text) returns void
language sql security definer set search_path = '' as $$
  update public.streaks set timezone = private.valid_timezone(p_timezone) where user_id = auth.uid()
$$;

-- A goal can be fixed for 24 hours, then only proving it can clear it. Not security definer:
-- current_user tells a person's own edit from apply_moderation, which runs as the owner.
create function private.goal_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.goal <> '' then new.goal_set_at := now(); end if;
    return new;
  end if;
  if new.goal is distinct from old.goal then
    if current_user = 'authenticated' and old.goal <> '' and old.goal_set_at < now() - interval '24 hours' then
      raise exception 'goal_locked';
    end if;
    if old.goal = '' then new.goal_set_at := now(); end if;
  end if;
  return new;
end $$;
create trigger profiles_goal_rules before insert or update of goal on public.profiles
for each row execute function private.goal_rules();

create function public.goal_status() returns table (goal text, set_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select goal, goal_set_at from public.profiles where id = auth.uid()
$$;

-- Keeps what a comment first said, however many times it's edited.
create function private.comment_edited() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
    new.original_body := coalesce(old.original_body, old.body);
  end if;
  return new;
end $$;
create trigger comments_edited before update on public.comments
for each row execute function private.comment_edited();

-- One key at a time, so a phone with an old copy of the settings can't overwrite the rest.
create function public.set_pref(p_key text, p_value boolean) returns void
language sql set search_path = '' as $$
  update public.settings set prefs = prefs || jsonb_build_object(p_key, p_value) where user_id = auth.uid()
$$;

create function public.set_choice(p_key text, p_value text) returns void
language sql set search_path = '' as $$
  update public.settings set choices = choices || jsonb_build_object(p_key, p_value) where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------- follows and blocks

create function private.follow_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.status := case
    when (select is_private from public.profiles where id = new.followee_id) then 'pending'
    else 'accepted'
  end;
  return new;
end $$;
create trigger follows_status before insert on public.follows
for each row execute function private.follow_before_insert();

create function private.block_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id)
     or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;
create trigger blocks_unfollow after insert on public.blocks
for each row execute function private.block_after_insert();

-- RLS hides a blocked profile from the blocker too, so the list needs its own door.
create function public.blocked_accounts()
returns table (id uuid, username text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username::text, p.avatar_url
  from public.blocks b join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by p.username::text
$$;

-- ---------------------------------------------------------------- notifications

create function private.notify(p_user uuid, p_actor uuid, p_type text, p_post uuid, p_comment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pref_key text := case when p_type in ('follow', 'follow_request') then 'nFollows' else 'nLikes' end;
begin
  if p_user = p_actor or private.blocked_between(p_user, p_actor) then return; end if;
  -- Follow requests always show: they need an answer.
  if p_type <> 'follow_request' and (
    coalesce(private.pref(p_user, 'pauseAll'), false) or not coalesce(private.pref(p_user, pref_key), true)
  ) then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
  values (p_user, p_actor, p_type, p_post, p_comment);
end $$;

create function private.notify_follow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(
    new.followee_id, new.follower_id,
    case new.status when 'pending' then 'follow_request' else 'follow' end, null, null
  );
  return new;
end $$;
create trigger follows_notify after insert on public.follows
for each row execute function private.notify_follow();

create function private.notify_like() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify((select author_id from public.posts where id = new.post_id), new.user_id, 'like', new.post_id, null);
  return new;
end $$;
create trigger likes_notify after insert on public.likes
for each row execute function private.notify_like();

create function private.unnotify_like() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications where type = 'like' and actor_id = old.user_id and post_id = old.post_id;
  return old;
end $$;
create trigger likes_unnotify after delete on public.likes
for each row execute function private.unnotify_like();

-- ---------------------------------------------------------------- comments

create function private.comment_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent public.comments;
begin
  if new.parent_id is not null then
    select * into parent from public.comments where id = new.parent_id;
    -- One level of replies: a reply must point at a top-level comment on this post.
    if parent.id is null or parent.post_id <> new.post_id or parent.parent_id is not null then
      raise exception 'invalid_parent_comment';
    end if;
  end if;
  return new;
end $$;
create trigger comments_parent before insert on public.comments
for each row execute function private.comment_before_insert();

create function private.comment_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := (select author_id from public.posts where id = new.post_id);
  parent_author uuid := (select author_id from public.comments where id = new.parent_id);
  mentioned uuid;
begin
  perform private.notify(owner_id, new.author_id, 'comment', new.post_id, new.id);
  if parent_author is not null and parent_author <> owner_id then
    perform private.notify(parent_author, new.author_id, 'comment', new.post_id, new.id);
  end if;
  for mentioned in
    select p.id from public.profiles p
    where p.username::text in (
      select lower(m[1]) from regexp_matches(new.body, '@([A-Za-z0-9._]{3,30})', 'g') as m
    )
  loop
    if mentioned <> owner_id and mentioned is distinct from parent_author then
      perform private.notify(mentioned, new.author_id, 'mention', new.post_id, new.id);
    end if;
  end loop;
  return new;
end $$;
create trigger comments_notify after insert on public.comments
for each row execute function private.comment_after_insert();

-- ---------------------------------------------------------------- posts and streaks

create function private.post_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.topic := private.topic_of(new.subtag);
  if new.kind = 'story' and new.expires_at is null then
    new.expires_at := new.created_at + interval '24 hours';
  end if;
  return new;
end $$;
create trigger posts_derive before insert on public.posts
for each row execute function private.post_before_insert();

-- Same day: no change. Next day: +1. Missed days: spend freezes if autoFreeze is
-- on and there are enough for the whole gap, otherwise reset to 1. Uses the
-- post's created_at, so a check that finishes after midnight counts for the day
-- it was shared.
create function private.bump_streak(p_user uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.streaks;
  post_date date;
  missed integer;
begin
  select * into s from public.streaks where user_id = p_user for update;
  if not found then return; end if;
  post_date := (p_at at time zone s.timezone)::date;
  if s.last_post_date is not null and post_date <= s.last_post_date then return; end if;

  if s.last_post_date is null then
    s.current := 1;
  else
    -- A reason day doesn't add to the count, but it isn't a missed day either.
    missed := post_date - s.last_post_date - 1
      - (select count(*)::integer from unnest(s.excused_dates) d where d > s.last_post_date and d < post_date);
    if missed = 0 then
      s.current := s.current + 1;
    elsif coalesce(private.pref(p_user, 'autoFreeze'), true) and s.freezes_available >= missed then
      s.freezes_available := s.freezes_available - missed;
      s.current := s.current + 1;
    else
      s.current := 1;
    end if;
  end if;

  if s.current % 7 = 0 then
    s.freezes_available := least(s.freezes_available + 1, 2);
  end if;

  update public.streaks set
    current = s.current,
    best = greatest(s.best, s.current),
    last_post_date = post_date,
    freezes_available = s.freezes_available
  where user_id = p_user;
end $$;

create function private.post_went_live() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Stories skip the AI, so one showing a meme mustn't keep a streak of proof alive.
  if new.kind <> 'story' then
    perform private.bump_streak(new.author_id, new.created_at);
  end if;
  return new;
end $$;
create trigger posts_live_streak after update of status on public.posts
for each row when (new.status = 'live' and old.status <> 'live')
execute function private.post_went_live();

-- ---------------------------------------------------------------- photos in messages

-- Adults who follow each other only. These photos get no AI check, and a report only
-- helps after someone has seen the photo, so accounts under 18 can't send or receive them.
create function private.can_send_photo(p_sender uuid, p_recipient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    private.can_message(p_sender, p_recipient)
    and not private.is_minor(p_sender)
    and not private.is_minor(p_recipient)
    and private.follows_accepted(p_sender, p_recipient)
    and private.follows_accepted(p_recipient, p_sender),
    false)
$$;

create function public.can_send_photos(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member(p_conversation, auth.uid())
    and private.can_send_photo(auth.uid(), private.other_member(p_conversation, auth.uid()))
$$;

-- Decides uploads to the photo bucket, whose first folder is the conversation id.
create function private.can_upload_photo(p_folder text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.can_send_photo(auth.uid(), private.other_member(m.conversation_id, auth.uid()))
    from public.conversation_members m
    where m.conversation_id::text = p_folder and m.user_id = auth.uid()
  ), false)
$$;

create function private.can_view_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.messages m
    where m.photo_path = p_path and m.photo_removed_at is null and private.is_member(m.conversation_id, auth.uid())
  )
$$;

create function private.message_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.photo_path is not null and (
    split_part(new.photo_path, '/', 1) <> new.conversation_id::text
    or position('..' in new.photo_path) > 0
    or not private.can_send_photo(new.sender_id, private.other_member(new.conversation_id, new.sender_id))
  ) then
    raise exception 'photo_not_allowed';
  end if;
  return new;
end $$;
create trigger messages_photo_rules before insert on public.messages
for each row execute function private.message_before_insert();

-- The recipient reports, and it's gone at once for both people. The file stays locked in
-- storage, so a person can still review the report. Reporting twice changes nothing.
create function public.report_photo(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
begin
  select * into m from public.messages where id = p_message for update;
  if not found or m.photo_path is null or m.sender_id = auth.uid() or not private.is_member(m.conversation_id, auth.uid()) then
    raise exception 'not_allowed';
  end if;
  if m.photo_removed_at is not null then return; end if;
  update public.messages set photo_removed_at = now() where id = p_message;
  insert into public.reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'message', p_message, 'photo');
end $$;

-- ---------------------------------------------------------------- reason days

-- Per calendar month, on top of earned freezes.
create function private.reason_days_per_month() returns integer
language sql immutable set search_path = '' as $$
  select 3
$$;

create function public.reason_days_left() returns integer
language sql stable security definer set search_path = '' as $$
  select private.reason_days_per_month() - count(*)::integer
  from public.streak_reasons r
  join public.streaks s on s.user_id = r.user_id
  where r.user_id = auth.uid()
    and date_trunc('month', r.day) = date_trunc('month', now() at time zone s.timezone)
$$;

-- Protects today, or yesterday if it was missed. Using it again on the same day costs nothing.
create function public.use_reason_day(p_day date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.streaks;
  today date;
begin
  select * into s from public.streaks where user_id = uid for update;
  if not found or s.last_post_date is null then raise exception 'no_streak'; end if;
  today := (now() at time zone s.timezone)::date;
  if p_day is null or p_day not in (today, today - 1) then raise exception 'bad_day'; end if;
  if s.last_post_date >= p_day then raise exception 'already_posted'; end if;
  if p_day = any (s.excused_dates) then return; end if;
  if (select count(*) from public.streak_reasons r
      where r.user_id = uid and date_trunc('month', r.day) = date_trunc('month', p_day::timestamp)) >= private.reason_days_per_month() then
    raise exception 'reason_limit';
  end if;
  insert into public.streak_reasons (user_id, day, reason) values (uid, p_day, p_reason);
  update public.streaks set excused_dates = excused_dates || p_day where user_id = uid;
end $$;

-- ---------------------------------------------------------------- moderation (service role)

-- Applies a verdict from moderate-post. Idempotent: only a post still in
-- 'checking' changes, so a retried call can never add a second strike.
create function public.apply_moderation(p_post uuid, p_verdict jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  post public.posts;
  violation text := p_verdict ->> 'violation';
  confidence numeric := coalesce((p_verdict ->> 'confidence')::numeric, 0);
  severe boolean;
  next_status text;
  strike_count integer := null;
  certificate uuid := null;
begin
  select * into post from public.posts where id = p_post for update;
  if not found then raise exception 'post_not_found'; end if;
  if post.status <> 'checking' then
    return jsonb_build_object('status', post.status, 'applied', false);
  end if;

  severe := coalesce(violation = 'csam' or (violation = 'illegal' and confidence >= 0.9), false);

  if severe then
    next_status := 'removed';
  elsif violation is not null then
    next_status := 'rejected';
  elsif not coalesce((p_verdict ->> 'on_topic')::boolean, false) then
    next_status := 'off_topic';
  else
    next_status := 'live';
  end if;

  update public.posts set status = next_status, moderation = p_verdict where id = p_post;

  -- text_filter and invalid_file aren't guideline violations, so no strike.
  if violation is not null and violation not in ('text_filter', 'invalid_file') then
    insert into public.strikes (user_id, post_id, reason) values (post.author_id, p_post, violation);
    select count(*) into strike_count from public.strikes
    where user_id = post.author_id and not voided and expires_at > now();
  end if;

  if severe then
    update public.profiles set suspended_until = 'infinity' where id = post.author_id;
    insert into public.safety_escalations (user_id, post_id, category, moderation)
    values (post.author_id, p_post, violation, p_verdict);
  end if;

  -- Only if the goal is still the one the video was judged against.
  if next_status = 'live' and post.goal_proof and coalesce((p_verdict ->> 'goal_achieved')::boolean, false) and confidence >= 0.8 then
    update public.profiles set goal = '' where id = post.author_id and goal = post.proof_goal;
    if found then
      insert into public.goal_certificates (user_id, goal, post_id, streak)
      values (
        post.author_id, post.proof_goal, p_post,
        coalesce((select s.current from public.streaks s where s.user_id = post.author_id), 0)
      )
      returning id into certificate;
    end if;
  end if;

  return jsonb_build_object(
    'status', next_status, 'applied', true, 'strikes', strike_count,
    'severe', severe, 'suspended', private.is_suspended(post.author_id),
    'goal_finished', certificate is not null, 'certificate_id', certificate, 'goal_reason', p_verdict ->> 'goal_reason'
  );
end $$;

-- ---------------------------------------------------------------- appeals

create function public.request_review(p_post uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  update public.posts set status = 'under_review'
  where id = p_post and author_id = uid and status in ('off_topic', 'rejected');
  if not found then raise exception 'not_reviewable'; end if;
  insert into public.appeals (user_id, post_id) values (uid, p_post);
end $$;

-- Run from the Supabase SQL editor; see README "Reviewing appeals".
create function public.admin_resolve_appeal(p_appeal uuid, p_overturn boolean, p_reviewer uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  appeal public.appeals;
begin
  update public.appeals
  set status = case when p_overturn then 'overturned' else 'upheld' end,
      resolved_at = now(), reviewer_id = p_reviewer
  where id = p_appeal and status = 'open'
  returning * into appeal;
  if not found then raise exception 'appeal_not_open'; end if;

  if p_overturn then
    update public.strikes set voided = true where post_id = appeal.post_id;
    update public.posts set status = 'live' where id = appeal.post_id;
  else
    update public.posts set status = case
      when exists (select 1 from public.strikes where post_id = appeal.post_id) then 'rejected'
      else 'off_topic'
    end
    where id = appeal.post_id;
  end if;
end $$;

create view public.admin_open_appeals as
  select a.id as appeal_id, a.created_at, a.post_id, p.media_path, p.caption, p.subtag, p.moderation,
    u.username::text as username
  from public.appeals a
  join public.posts p on p.id = a.post_id
  join public.profiles u on u.id = a.user_id
  where a.status = 'open'
  order by a.created_at;

create function public.account_status() returns table (
  strikes integer, suspended boolean, reviews_requested integer
)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer from public.strikes s
      where s.user_id = auth.uid() and not s.voided and s.expires_at > now()),
    private.is_suspended(auth.uid()),
    (select count(*)::integer from public.appeals a where a.user_id = auth.uid())
$$;

-- ---------------------------------------------------------------- read views (RLS applies)

create view public.post_cards with (security_invoker = true) as
  select p.id, p.author_id, p.kind, p.media_path, p.media_type, p.caption, p.topic, p.subtag,
    p.status, p.also_scroll, p.created_at, p.expires_at,
    a.username::text as username, a.full_name, a.avatar_url,
    s.current as streak_current, s.last_post_date as streak_last_post_date, s.excused_dates as streak_excused_dates, s.freezes_available as streak_freezes,
    (select count(*)::integer from public.likes l where l.post_id = p.id) as like_count,
    (select count(*)::integer from public.comments c where c.post_id = p.id) as comment_count,
    exists (select 1 from public.likes l where l.post_id = p.id and l.user_id = auth.uid()) as liked_by_me,
    exists (select 1 from public.saves v where v.post_id = p.id and v.user_id = auth.uid()) as saved_by_me
  from public.posts p
  join public.profiles a on a.id = p.author_id
  left join public.streaks s on s.user_id = p.author_id;

create view public.comment_cards with (security_invoker = true) as
  select c.id, c.post_id, c.author_id, c.parent_id, c.body, c.created_at, c.edited_at,
    a.username::text as username, a.avatar_url,
    (select count(*)::integer from public.comment_likes l where l.comment_id = c.id) as like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()) as liked_by_me
  from public.comments c
  join public.profiles a on a.id = c.author_id;

create view public.notification_cards with (security_invoker = true) as
  select n.id, n.type, n.post_id, n.comment_id, n.read_at, n.created_at, n.actor_id,
    a.username::text as actor_username, a.avatar_url as actor_avatar_url,
    c.body as comment_body,
    (select f.status from public.follows f where f.follower_id = auth.uid() and f.followee_id = n.actor_id) as my_follow_status,
    (select f.status from public.follows f where f.follower_id = n.actor_id and f.followee_id = auth.uid()) as their_follow_status
  from public.notifications n
  join public.profiles a on a.id = n.actor_id
  left join public.comments c on c.id = n.comment_id;

-- ---------------------------------------------------------------- feeds (RLS applies)

create function public.home_feed(p_before timestamptz default null, p_limit integer default 20)
returns setof public.post_cards
language sql stable set search_path = '' as $$
  select c.* from public.post_cards c
  where c.kind = 'post' and c.status = 'live'
    and (p_before is null or c.created_at < p_before)
    and (c.author_id = auth.uid() or private.follows_accepted(auth.uid(), c.author_id))
  order by c.created_at desc
  limit least(p_limit, 50)
$$;

-- ponytail: newest-first with no ranking; add a score when the catalog outgrows recency.
create function public.scrolls_feed(p_before timestamptz default null, p_limit integer default 10)
returns setof public.post_cards
language sql stable set search_path = '' as $$
  select c.* from public.post_cards c
  where (c.kind = 'scroll' or c.also_scroll) and c.status = 'live'
    and (p_before is null or c.created_at < p_before)
    and private.discoverable(auth.uid(), c.author_id)
  order by c.created_at desc
  limit least(p_limit, 30)
$$;

-- ponytail: substring scan over visible posts; add a trigram index when this gets slow.
create function public.explore(p_q text default '', p_topic text default null, p_limit integer default 40)
returns setof public.post_cards
language sql stable set search_path = '' as $$
  select c.* from public.post_cards c
  where c.kind in ('post', 'scroll') and c.status = 'live'
    and c.author_id <> auth.uid()
    and private.discoverable(auth.uid(), c.author_id)
    and (p_topic is null or c.topic = p_topic)
    and (
      coalesce(p_q, '') = ''
      or position(lower(p_q) in lower(c.caption || ' ' || c.username || ' ' || c.topic || ' ' || c.subtag)) > 0
    )
  order by c.created_at desc
  limit least(p_limit, 60)
$$;

create function public.search_users(p_q text, p_limit integer default 20)
returns table (id uuid, username text, full_name text, avatar_url text)
language sql stable set search_path = '' as $$
  select p.id, p.username::text, p.full_name, p.avatar_url
  from public.profiles p
  where p.id <> auth.uid()
    and private.discoverable(auth.uid(), p.id)
    and position(lower(p_q) in lower(p.username::text || ' ' || p.full_name)) > 0
  order by p.username::text
  limit least(p_limit, 50)
$$;

-- You plus everyone you follow, for the story roll on Home.
create function public.story_roll()
returns table (user_id uuid, username text, avatar_url text, posted_today boolean, has_story boolean, all_seen boolean)
language sql stable set search_path = '' as $$
  with day_start as (
    select (date_trunc('day', now() at time zone s.timezone) at time zone s.timezone) as ts
    from public.streaks s where s.user_id = auth.uid()
  )
  select p.id, p.username::text, p.avatar_url,
    exists (
      select 1 from public.posts x
      where x.author_id = p.id and x.status = 'live' and x.created_at >= (select ts from day_start)
    ),
    exists (
      select 1 from public.posts x
      where x.author_id = p.id and x.kind = 'story' and x.status = 'live' and x.expires_at > now()
    ),
    not exists (
      select 1 from public.posts x
      where x.author_id = p.id and x.kind = 'story' and x.status = 'live' and x.expires_at > now()
        and not exists (select 1 from public.story_views v where v.story_id = x.id and v.viewer_id = auth.uid())
    )
  from public.profiles p
  where p.id = auth.uid() or private.follows_accepted(auth.uid(), p.id)
  order by (p.id = auth.uid()) desc, p.username::text
$$;

create function public.profile_stats(p_user uuid)
returns table (followers integer, following integer, posts integer, lists_visible boolean)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer from public.follows where followee_id = p_user and status = 'accepted'),
    (select count(*)::integer from public.follows where follower_id = p_user and status = 'accepted'),
    (select count(*)::integer from public.posts where author_id = p_user and kind = 'post' and status = 'live'),
    private.can_see_lists(auth.uid(), p_user)
  where private.can_see_profile(auth.uid(), p_user)
$$;

-- The rows behind the two counts. ponytail: newest 200 only, add paging when lists get long.
create function public.profile_people(p_user uuid, p_list text)
returns table (id uuid, username text, full_name text, avatar_url text, my_status text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username::text, p.full_name, p.avatar_url,
    (select m.status from public.follows m where m.follower_id = auth.uid() and m.followee_id = p.id)
  from public.follows f
  join public.profiles p on p.id = case when p_list = 'supporters' then f.follower_id else f.followee_id end
  where f.status = 'accepted'
    and p_user = case when p_list = 'supporters' then f.followee_id else f.follower_id end
    and private.can_see_lists(auth.uid(), p_user)
    and private.can_see_profile(auth.uid(), p.id)
    -- A list must not become a way for adults to find teens.
    and private.discoverable(auth.uid(), p.id)
  order by f.created_at desc
  limit 200
$$;

-- A function, not a column grant, because a column can't follow the private-account rule:
-- anyone who sees a private profile's name could read its goal too.
create function public.profile_goal(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(goal, '') from public.profiles
  where id = p_user and private.can_see_profile(auth.uid(), id) and private.can_view_content(auth.uid(), id)
$$;

-- ---------------------------------------------------------------- messages

create function public.start_conversation(p_other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  key text := least(uid::text, p_other::text) || ':' || greatest(uid::text, p_other::text);
  conversation uuid;
begin
  if uid is null or uid = p_other then raise exception 'invalid_conversation'; end if;
  if private.blocked_between(uid, p_other) then raise exception 'cannot_message'; end if;
  select id into conversation from public.conversations where dm_key = key;
  if conversation is not null then return conversation; end if;
  if not private.can_message(uid, p_other) then raise exception 'cannot_message'; end if;
  insert into public.conversations (dm_key) values (key)
  on conflict (dm_key) do update set dm_key = excluded.dm_key
  returning id into conversation;
  insert into public.conversation_members (conversation_id, user_id)
  values (conversation, uid), (conversation, p_other)
  on conflict do nothing;
  return conversation;
end $$;

create function public.inbox()
returns table (
  conversation_id uuid, other_id uuid, other_username text, other_avatar_url text,
  last_body text, last_sender_id uuid, last_at timestamptz, unread integer
)
language sql stable set search_path = '' as $$
  select m.conversation_id, o.user_id, p.username::text, p.avatar_url,
    last.body, last.sender_id, last.created_at,
    (select count(*)::integer from public.messages u
      where u.conversation_id = m.conversation_id and u.sender_id <> auth.uid() and u.read_at is null)
  from public.conversation_members m
  join public.conversation_members o on o.conversation_id = m.conversation_id and o.user_id <> m.user_id
  join public.profiles p on p.id = o.user_id
  join lateral (
    select body, sender_id, created_at from public.messages x
    where x.conversation_id = m.conversation_id order by x.created_at desc limit 1
  ) last on true
  where m.user_id = auth.uid()
  order by last.created_at desc
$$;

create function public.mark_conversation_read(p_conversation uuid) returns void
language sql set search_path = '' as $$
  update public.messages set read_at = now()
  where conversation_id = p_conversation and sender_id <> auth.uid() and read_at is null
$$;
