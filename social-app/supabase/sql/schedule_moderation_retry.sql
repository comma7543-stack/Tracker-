-- Run once in the Supabase SQL editor after deploying functions. Not a migration
-- because it needs your project URL and secret. Enable pg_cron and pg_net first
-- (Database > Extensions). Replace both placeholders.
--
-- Every minute, retries posts still in 'checking' after 2 minutes, which covers
-- model outages and apps closed mid-check.

select cron.schedule(
  'moderation-retry',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/moderate-post',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sweep-secret', 'YOUR-MODERATION-SWEEP-SECRET'),
    body := '{"sweep": true}'::jsonb
  );
  $$
);
