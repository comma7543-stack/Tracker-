-- Demo data for LOCAL testing only (supabase db reset). Every account's password
-- is "password123". There are no real media files, so posts show a placeholder.
-- Never run this against production.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (values
  ('10000000-0000-4000-8000-000000000001', 'minjun@example.com'),
  ('10000000-0000-4000-8000-000000000002', 'jess@example.com'),
  ('10000000-0000-4000-8000-000000000003', 'dan@example.com'),
  ('10000000-0000-4000-8000-000000000004', 'sora@example.com')
) as t (id, email);

insert into public.profiles (id, username, full_name, bio, dob, terms_version, terms_accepted_at) values
  ('10000000-0000-4000-8000-000000000001', 'minjun.lifts', 'Minjun', 'Leg day is every day.', '1998-02-01', 'seed', now()),
  ('10000000-0000-4000-8000-000000000002', 'jess.cooks', 'Jess', 'Meal prep Sundays.', '1996-06-11', 'seed', now()),
  ('10000000-0000-4000-8000-000000000003', 'dan.reads', 'Dan', '20 pages before bed.', '1994-09-21', 'seed', now()),
  ('10000000-0000-4000-8000-000000000004', 'sora.runs', 'Sora', '5am club.', '1999-12-30', 'seed', now());

update public.settings set choices = choices || '{"dmWho":"Everyone","streakWho":"Everyone"}';

insert into public.follows (follower_id, followee_id) values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001');

insert into public.posts (author_id, kind, media_path, media_type, caption, topic, subtag, status) values
  ('10000000-0000-4000-8000-000000000001', 'post', '10000000-0000-4000-8000-000000000001/seed-1.jpg', 'photo', 'Leg day. Squats 5x5 at 100kg, then walking lunges.', 'Fitness', 'Gym', 'live'),
  ('10000000-0000-4000-8000-000000000002', 'post', '10000000-0000-4000-8000-000000000002/seed-2.jpg', 'photo', 'Meal prep for the week. Chicken, rice, broccoli. Five boxes done.', 'Money and health', 'Cooking', 'live'),
  ('10000000-0000-4000-8000-000000000003', 'post', '10000000-0000-4000-8000-000000000003/seed-3.jpg', 'photo', 'Day 30 of reading 20 pages before bed.', 'Learning', 'Reading', 'live'),
  ('10000000-0000-4000-8000-000000000004', 'scroll', '10000000-0000-4000-8000-000000000004/seed-4.mp4', 'video', '5km tempo run. Negative splits.', 'Fitness', 'Running', 'live'),
  ('10000000-0000-4000-8000-000000000001', 'story', '10000000-0000-4000-8000-000000000001/seed-5.jpg', 'photo', 'Refuel. Chicken and rice.', 'Money and health', 'Cooking', 'live');
