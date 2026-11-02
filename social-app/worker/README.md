# Video worker

Closes two launch blockers from `PROGRESS.md`: videos carrying GPS location, and
moderation judging frames the phone picked. It re-encodes every uploaded video on a
server, drops all metadata, takes its own frames, and only then lets moderation run.
It also deletes the files of stories a day after they expire.

Until this is running and switched on, the app works the old way.

## What it needs

- Node 20 or newer, and ffmpeg.
- Three secrets, from the Supabase dashboard **(parent)**:
  - `SUPABASE_URL`: Project Settings > API.
  - `SUPABASE_SERVICE_ROLE_KEY`: Project Settings > API. This key can do anything in the
    database. It goes only in the worker's host settings, never in the app or a chat.
  - `MODERATION_SWEEP_SECRET`: the same value you set for moderate-post.

## Run it

The simplest host is one that runs a Dockerfile, such as Fly.io or Render. Point it at
this folder and add the three secrets in its settings. One small machine is enough
for a start: each video takes a few seconds.

To try it on your own computer instead:

```bash
cd worker && npm install
```

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... MODERATION_SWEEP_SECRET=... npm start
```

## Switch it on

Only once it's running, in the Supabase SQL editor:

```sql
insert into private.app_config (key, value) values ('video_worker', 'on')
on conflict (key) do update set value = excluded.value;
```

From then on, new videos wait for the worker. If the worker stops, videos stay in
"checking" and go live once it's back. To switch it off again:

```sql
delete from private.app_config where key = 'video_worker';
```

Videos already waiting still need the worker after switching off. To release them:

```sql
update posts set media_ready = true where not media_ready;
```
