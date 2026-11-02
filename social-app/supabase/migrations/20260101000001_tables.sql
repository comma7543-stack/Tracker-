-- Tables. Row Level Security and grants are in ..._rls.sql; rules enforced by
-- triggers and RPCs are in ..._functions.sql.

create extension if not exists citext with schema extensions;

-- Not exposed by PostgREST: helpers here can't be called as RPCs.
create schema if not exists private;

create function private.topic_of(p_subtag text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_subtag in ('Gym', 'Running', 'Sports', 'Yoga') then 'Fitness'
    when p_subtag in ('Reading', 'Studying', 'Languages', 'Writing') then 'Learning'
    when p_subtag in ('Coding', 'AI and Claude', 'Design', 'Building') then 'Work and tech'
    when p_subtag in ('Trading', 'Investing', 'Cooking', 'Healthy eating') then 'Money and health'
    when p_subtag in ('Quotes', 'Consistency') then 'Motivation'
  end
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null unique,
  full_name text not null,
  bio text not null default '',
  goal text not null default '',
  -- Starts the 24 hours a goal can still be fixed. Not granted to users.
  goal_set_at timestamptz,
  avatar_url text,
  dob date not null,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  deleted_at timestamptz,
  -- Admin/safety suspension, separate from the strike rule. 'infinity' = indefinite.
  suspended_until timestamptz,
  constraint username_format check (
    username::text ~ '^[a-z0-9._]{3,30}$'
    and left(username::text, 1) <> '.'
    and right(username::text, 1) <> '.'
  ),
  constraint full_name_length check (char_length(full_name) between 1 and 60),
  constraint bio_length check (char_length(bio) <= 150),
  constraint goal_length check (char_length(goal) <= 100)
);

create table public.settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  prefs jsonb not null,
  choices jsonb not null
);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id, status);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('post', 'story', 'scroll')),
  media_path text not null,
  media_type text not null check (media_type in ('photo', 'video')),
  caption text not null default '' check (char_length(caption) <= 200),
  topic text not null,
  subtag text not null,
  status text not null default 'checking'
    check (status in ('checking', 'live', 'off_topic', 'rejected', 'under_review', 'removed')),
  moderation jsonb not null default '{}',
  also_scroll boolean not null default false,
  -- The author says this video proves their goal. proof_goal is that goal, copied by a trigger.
  goal_proof boolean not null default false,
  proof_goal text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint topic_matches_subtag check (topic = private.topic_of(subtag)),
  constraint scroll_is_video check (kind <> 'scroll' or media_type = 'video'),
  constraint proof_is_video check (not goal_proof or media_type = 'video'),
  constraint also_scroll_is_video_post check (not also_scroll or (kind = 'post' and media_type = 'video'))
);
create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_live_idx on public.posts (kind, created_at desc) where status = 'live';
create index posts_checking_idx on public.posts (created_at) where status = 'checking';

create table public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index likes_post_idx on public.likes (post_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- What it first said, for reports: otherwise an edit could erase what was reported. Not readable by users.
  original_body text
);
create index comments_post_idx on public.comments (post_id, created_at);

create table public.goal_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  goal text not null,
  post_id uuid references public.posts (id) on delete set null,
  streak integer not null default 0,
  finished_at timestamptz not null default now()
);
create index goal_certificates_user_idx on public.goal_certificates (user_id, finished_at desc);

create table public.comment_likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);
create index comment_likes_comment_idx on public.comment_likes (comment_id);

create table public.saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table public.story_views (
  story_id uuid not null references public.posts (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- "<lower uuid>:<higher uuid>", keeps one DM thread per pair.
  dm_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  photo_path text,
  -- Set the moment the recipient reports the photo. It's hidden for both people from then on.
  photo_removed_at timestamptz,
  constraint message_has_content check (char_length(body) >= 1 or photo_path is not null)
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'follow', 'follow_request', 'mention')),
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.streaks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  current integer not null default 0,
  best integer not null default 0,
  last_post_date date,
  freezes_available integer not null default 0 check (freezes_available between 0 and 2),
  timezone text not null default 'UTC',
  -- Days protected by a reason. Dates only: the reasons themselves stay in streak_reasons.
  excused_dates date[] not null default '{}'
);

-- Why someone couldn't post. Only the owner can read these.
create table public.streak_reasons (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  reason text not null check (reason in ('sick', 'family', 'travel', 'noPhone', 'other')),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table public.strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- A strike outlives its post: discarding a rejected post must not clear it.
  post_id uuid references public.posts (id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  voided boolean not null default false
);
create index strikes_user_idx on public.strikes (user_id);

create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  reviewer_id uuid references auth.users (id) on delete set null
);
create unique index appeals_one_open_idx on public.appeals (post_id) where status = 'open';

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  -- 'problem' is the Help > Report a problem form; it has no target.
  target_type text not null check (target_type in ('user', 'post', 'comment', 'message', 'problem')),
  target_id uuid,
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed'))
);

-- Mandatory-reporting queue (see moderate-post). Service role only, and no
-- foreign keys: these records must survive account deletion.
create table public.safety_escalations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  post_id uuid not null,
  category text not null,
  moderation jsonb not null,
  quarantine_path text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
