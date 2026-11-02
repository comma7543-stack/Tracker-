-- Row Level Security, grants, storage and realtime.
--
-- Supabase's default privileges grant every role everything on new objects, so
-- start from nothing and grant back only what the app uses. Column grants are how
-- dob and moderation stay unreadable and post status stays unwritable. That means
-- the app must name columns: select('*') on profiles or posts is a permission error.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles
grant select (id, username, full_name, bio, avatar_url, is_private, created_at)
  on public.profiles to authenticated;
grant update (username, full_name, bio, goal, avatar_url) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (private.can_see_profile(auth.uid(), id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- settings
grant select, update (prefs, choices) on public.settings to authenticated;
create policy settings_select on public.settings for select to authenticated using (user_id = auth.uid());
create policy settings_update on public.settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- follows
grant select, delete on public.follows to authenticated;
grant insert (follower_id, followee_id) on public.follows to authenticated;
grant update (status) on public.follows to authenticated;
create policy follows_select on public.follows for select to authenticated using (
  -- Other people's lists go through profile_people, which respects the show-lists switch.
  follower_id = auth.uid() or followee_id = auth.uid()
);
create policy follows_insert on public.follows for insert to authenticated with check (
  follower_id = auth.uid() and not private.blocked_between(follower_id, followee_id)
);
create policy follows_update on public.follows for update to authenticated
  using (followee_id = auth.uid()) with check (followee_id = auth.uid() and status = 'accepted');
create policy follows_delete on public.follows for delete to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- blocks
grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;
create policy blocks_select on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy blocks_delete on public.blocks for delete to authenticated using (blocker_id = auth.uid());

-- goal_certificates. Only apply_moderation writes them.
grant select on public.goal_certificates to authenticated;
create policy goal_certificates_select on public.goal_certificates for select to authenticated
  using (private.can_see_profile(auth.uid(), user_id) and private.can_view_content(auth.uid(), user_id));

-- posts. No update grant: status comes from moderate-post, and a caption edit
-- would skip the check.
grant select (id, author_id, kind, media_path, media_type, caption, topic, subtag, status, also_scroll, created_at, expires_at)
  on public.posts to authenticated;
grant insert (id, author_id, kind, media_path, media_type, caption, topic, subtag, also_scroll, goal_proof)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;
create policy posts_select on public.posts for select to authenticated using (
  author_id = auth.uid()
  or (status = 'live' and (expires_at is null or expires_at > now()) and private.can_view_content(auth.uid(), author_id))
);
create policy posts_insert on public.posts for insert to authenticated with check (
  author_id = auth.uid()
  and split_part(media_path, '/', 1) = auth.uid()::text
  and position('..' in media_path) = 0
  and not private.is_suspended(auth.uid())
);
create policy posts_delete on public.posts for delete to authenticated
  using (author_id = auth.uid() and status <> 'removed');

-- likes
grant select, delete on public.likes to authenticated;
grant insert (user_id, post_id) on public.likes to authenticated;
create policy likes_select on public.likes for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id) and private.can_see_profile(auth.uid(), user_id));
create policy likes_insert on public.likes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and p.status = 'live')
);
create policy likes_delete on public.likes for delete to authenticated using (user_id = auth.uid());

-- comments
grant delete on public.comments to authenticated;
-- No original_body: see the tables migration.
grant select (id, post_id, author_id, parent_id, body, created_at, edited_at) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant insert (id, post_id, author_id, parent_id, body) on public.comments to authenticated;
create policy comments_select on public.comments for select to authenticated using (
  exists (select 1 from public.posts p where p.id = post_id) and private.can_see_profile(auth.uid(), author_id)
);
create policy comments_insert on public.comments for insert to authenticated with check (
  author_id = auth.uid() and private.can_comment(auth.uid(), post_id)
);
create policy comments_update on public.comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.comments for delete to authenticated using (
  author_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

-- comment_likes
grant select, delete on public.comment_likes to authenticated;
grant insert (user_id, comment_id) on public.comment_likes to authenticated;
create policy comment_likes_select on public.comment_likes for select to authenticated
  using (exists (select 1 from public.comments c where c.id = comment_id));
create policy comment_likes_insert on public.comment_likes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.comments c where c.id = comment_id)
);
create policy comment_likes_delete on public.comment_likes for delete to authenticated using (user_id = auth.uid());

-- saves
grant select, delete on public.saves to authenticated;
grant insert (user_id, post_id) on public.saves to authenticated;
create policy saves_select on public.saves for select to authenticated using (user_id = auth.uid());
create policy saves_insert on public.saves for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
);
create policy saves_delete on public.saves for delete to authenticated using (user_id = auth.uid());

-- story_views
grant select on public.story_views to authenticated;
grant insert (story_id, viewer_id) on public.story_views to authenticated;
create policy story_views_select on public.story_views for select to authenticated using (
  viewer_id = auth.uid() or exists (select 1 from public.posts p where p.id = story_id and p.author_id = auth.uid())
);
create policy story_views_insert on public.story_views for insert to authenticated with check (
  viewer_id = auth.uid() and exists (select 1 from public.posts p where p.id = story_id and p.kind = 'story')
);

-- conversations and messages. Created through start_conversation only.
grant select on public.conversations, public.conversation_members to authenticated;
create policy conversations_select on public.conversations for select to authenticated
  using (private.is_member(id, auth.uid()));
create policy members_select on public.conversation_members for select to authenticated
  using (private.is_member(conversation_id, auth.uid()));

grant select on public.messages to authenticated;
grant insert (id, conversation_id, sender_id, body, photo_path) on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
create policy messages_select on public.messages for select to authenticated using (
  private.is_member(conversation_id, auth.uid())
  and not private.blocked_between(auth.uid(), private.other_member(conversation_id, auth.uid()))
);
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and private.is_member(conversation_id, auth.uid())
  and private.can_message(auth.uid(), private.other_member(conversation_id, auth.uid()))
);
create policy messages_update on public.messages for update to authenticated
  using (private.is_member(conversation_id, auth.uid()) and sender_id <> auth.uid())
  with check (private.is_member(conversation_id, auth.uid()) and sender_id <> auth.uid());

-- notifications. Written by triggers only.
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- streaks. Written by triggers only.
grant select on public.streaks to authenticated;
create policy streaks_select on public.streaks for select to authenticated
  using (private.can_see_streak(auth.uid(), user_id));

-- strikes and appeals. Read-only for the user.
grant select on public.strikes, public.appeals to authenticated;
create policy strikes_select on public.strikes for select to authenticated using (user_id = auth.uid());
create policy appeals_select on public.appeals for select to authenticated using (user_id = auth.uid());

-- reports
grant select on public.reports to authenticated;
grant insert (reporter_id, target_type, target_id, reason) on public.reports to authenticated;
create policy reports_select on public.reports for select to authenticated using (reporter_id = auth.uid());
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid());

-- safety_escalations: RLS on, no policies, no grants. Service role only.

-- streak_reasons. Written by use_reason_day only, and private to their owner.
grant select on public.streak_reasons to authenticated;
create policy streak_reasons_select on public.streak_reasons for select to authenticated using (user_id = auth.uid());

-- Views and RPCs the app calls. Views run with the caller's rights, so RLS applies.
grant select on public.post_cards, public.comment_cards, public.notification_cards to authenticated;
grant execute on function
  public.complete_signup(text, text, date, text, text, text),
  public.username_available(text),
  public.set_timezone(text),
  public.can_send_photos(uuid),
  public.report_photo(uuid),
  public.reason_days_left(),
  public.use_reason_day(date, text),
  public.request_review(uuid),
  public.account_status(),
  public.blocked_accounts(),
  public.home_feed(timestamptz, integer),
  public.scrolls_feed(timestamptz, integer),
  public.explore(text, text, integer),
  public.search_users(text, integer),
  public.story_roll(),
  public.profile_stats(uuid),
  public.profile_goal(uuid),
  public.goal_status(),
  public.set_pref(text, boolean),
  public.set_choice(text, text),
  public.profile_people(uuid, text),
  public.start_conversation(uuid),
  public.inbox(),
  public.mark_conversation_read(uuid)
to authenticated;
grant execute on function
  public.apply_moderation(uuid, jsonb),
  public.admin_resolve_appeal(uuid, boolean, uuid)
to service_role;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('media', 'media', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('message-photos', 'message-photos', false, 10485760, array['image/jpeg']),
  -- Holds content pulled for mandatory reporting. No policies: service role only.
  ('quarantine', 'quarantine', false, null, null);

create policy media_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy media_delete on storage.objects for delete to authenticated using (
  bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
);
-- Video poster frames live at "<media_path>.frames/<n>.jpg" and follow their post.
create policy media_select on storage.objects for select to authenticated using (
  bucket_id = 'media' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.posts p where p.media_path = split_part(name, '.frames/', 1))
  )
);
create policy message_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'message-photos' and private.can_upload_photo((storage.foldername(name))[1])
);
create policy message_photos_select on storage.objects for select to authenticated using (
  bucket_id = 'message-photos' and private.can_view_photo(name)
);
create policy avatars_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy avatars_update on storage.objects for update to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy avatars_delete on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.messages, public.notifications;
