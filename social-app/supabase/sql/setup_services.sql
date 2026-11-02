-- Run once in the Supabase SQL editor after deploying functions, next to
-- schedule_moderation_retry.sql. Not a migration because it holds your project URL
-- and secret. Enable pg_cron and pg_net first (Database > Extensions).
-- Replace every YOUR-... placeholder. YOUR-PUSH-SECRET is the PUSH_SECRET you set with
-- `npx supabase secrets set`.

-- 1. Push notifications. The database pokes send-push the moment something is queued.
insert into private.app_config (key, value) values
  ('push_url', 'https://YOUR-PROJECT.supabase.co/functions/v1/send-push'),
  ('push_secret', 'YOUR-PUSH-SECRET')
on conflict (key) do update set value = excluded.value;

-- 2. Anything the poke missed goes out within a minute.
select cron.schedule(
  'push-sweep',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from private.app_config where key = 'push_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', (select value from private.app_config where key = 'push_secret')),
    body := '{}'::jsonb
  );
  $$
);

-- 3. Only after the video worker is deployed and running (worker/README.md).
-- Until then, leave this commented out: with it on, videos wait for the worker.
-- insert into private.app_config (key, value) values ('video_worker', 'on')
-- on conflict (key) do update set value = excluded.value;

-- 4. Make yourself (or a parent) an admin, so reports reach your phone and the
-- review screen appears in Settings. Use your username.
-- insert into admins (user_id) select id from profiles where username = 'YOUR-USERNAME';
