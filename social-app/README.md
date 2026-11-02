# [App Name]

A social app where people only post proof of real work. Built with Expo (React Native) and Supabase.

This guide assumes you've never done this before. Do the steps in order. Accounts marked **(parent)** must be created and owned by a parent or guardian.

## See it first, with fake data

No accounts or setup needed beyond step 1:

```bash
npm run demo
```

Scan the QR code. The app first asks the commitment questions, then shows the welcome screen, where any login works. After that it opens signed in as a demo user, with fake people and posts held in memory. Log out in Settings to see the questions again. Likes, comments, messages and new posts work until the app reloads. Photos and the video are random placeholders downloaded from the internet. Any login or 6-digit code works, and signing up shows the onboarding screens.

To see each moderation result, put one of these in a caption: `off topic`, `reject`, `suspend` or `slow`. The demo has no AI to judge goal proof, so after you post a video with "This proves my goal" on, it asks what the AI would say. The demo doesn't judge your photo, so a real meme would pass here. The daily limits work; reload the app to reset them.

This doesn't test the real database, sign-in or moderation. For those, follow the steps below and use `npx expo start`.

## 1. Install the tools

Install [Node.js](https://nodejs.org) (the LTS version), then in this folder run:

```bash
npm install
```

Install the Expo Go app on your phone from the App Store or Google Play.

## 2. Create the Supabase project (parent)

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Save the database password somewhere safe.
2. In this folder, connect to it. Find the project ref in the dashboard URL.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
```

3. Create all the tables, rules and storage buckets:

```bash
npx supabase db push
```

## 3. Connect the app

Copy `.env.example` to `.env`, then fill both values in from dashboard > Project Settings > API.

Only those two values go in `.env`. Anything in it ships inside the app, where anyone could read it.

## 4. Turn on sign-in

In the dashboard under Authentication:

- **Email:** under Email Templates, edit "Confirm signup" and "Magic Link" so the message includes `{{ .Token }}`. This makes Supabase send a 6-digit code rather than a link.
- **Phone:** under Providers > Phone, connect an SMS provider such as Twilio. Every text costs money. You can test with email only until this is set up.
- **Apple and Google:** under Providers. Both need developer accounts **(parent)**.
- **Redirect URLs:** add `appname://auth-callback` and `exp://**`.

## 5. Set up moderation

Posts stay hidden until this works, so nothing goes live without it. You need an API key from [console.anthropic.com](https://console.anthropic.com) **(parent)**.

Make up a long random password for the retry job, then run this with your values filled in:

```bash
npx supabase secrets set ANTHROPIC_API_KEY=YOUR-KEY MODERATION_SWEEP_SECRET=YOUR-RANDOM-PASSWORD
```

Deploy the functions:

```bash
npx supabase functions deploy
```

In the dashboard, enable the `pg_cron` and `pg_net` extensions (Database > Extensions). Then open `supabase/sql/schedule_moderation_retry.sql`, fill in your values, and run it in the SQL editor. This retries any post that's still being checked after 2 minutes.

Optional settings:

- `MODERATION_MODEL` changes the Claude model. The default is `claude-haiku-5-5`, the low-cost one. `claude-opus-5-5` is more capable but costs far more. Test accuracy on real posts before launch.
- `MODERATION_DAILY_CHECKS` is the most AI checks per day across all users. The default is 1000. Past it, new posts stay hidden and get checked the next day. To raise it, with no redeploy:

```bash
npx supabase secrets set MODERATION_DAILY_CHECKS=2000
```

To set a spending limit that holds even if something here goes wrong, also set a monthly limit at [console.anthropic.com](https://console.anthropic.com) **(parent)**.

Each person gets 5 posts and scrolls combined per day, resetting at their midnight. Blocked and deleted posts still count, since their checks were paid for. To change the number, edit `private.daily_post_limit` in a new migration.

Stories have no limit and no AI check. They only go through the word filter and a file type check, so they cost nothing. Read "Before launch" in `PROGRESS.md` first.
- `MODERATION_PROVIDER` picks a provider added in `supabase/functions/_shared/providers.ts`.

## 6. Run it

```bash
npx expo start
```

Scan the QR code with your phone's camera (iPhone) or Expo Go (Android).

Password-reset links open `appname://`, which Expo Go can't receive. Test those in a real build (step 7).

To test against a local database with demo users instead, install Docker and run `npx supabase start`, then `npx supabase db reset`. The demo accounts in `supabase/seed.sql` all use the password `password123`. Never run the seed on production.

## 7. Build for the stores (parent)

You need an Apple Developer account and a Google Play Console account. Replace `com.example.appname` in `app.json` first. It can't be changed after the first release.

```bash
npm install -g eas-cli
```

```bash
eas build:configure
```

```bash
eas build --platform all
```

Set the two `EXPO_PUBLIC_` values in your EAS project, because `.env` isn't uploaded.

## Testing goal proof on a real video

This sends a video to the real AI with the same rules the app uses and prints its decision. It needs ffmpeg and an API key **(parent)**. Each run costs a small amount. Type the key into your own terminal, never into a chat.

```bash
cd scripts && npm install && cd ..
```

```bash
export ANTHROPIC_API_KEY=YOUR-KEY
```

```bash
npm run try-proof -- path/to/video.mp4 "Run a marathon"
```

## Running the checks

```bash
npm run typecheck
```

```bash
npm test
```

The tests run the real migrations in PGlite (Postgres in WebAssembly), so they need neither Docker nor a Supabase project.

## Running the app day to day

All of this happens in the Supabase SQL editor.

**Reviewing appeals.** The app promises an answer within 24 hours. See what's waiting:

```sql
select * from admin_open_appeals;
```

Then overturn (the post goes live and the strike is voided) or uphold:

```sql
select admin_resolve_appeal('APPEAL-ID', true);
```

```sql
select admin_resolve_appeal('APPEAL-ID', false);
```

**Reports:**

```sql
select * from reports where status = 'open' order by created_at;
```

A report with the reason `photo` is a message photo that has already been hidden. Its file stays locked in the `message-photos` bucket for you to review. To see which one, look up the report's `target_id` in `messages`.

Stories aren't checked before they go live, so check reports at least daily: a story disappears after 24 hours. To take one down, use its post id from the report:

```sql
update posts set status = 'removed' where id = 'POST-ID';
```

**Stuck goals.** A goal locks 24 hours after it's set, and only a video the AI accepts clears it. This is the only way to remove one for someone stuck, for example one that's become unhealthy:

```sql
update profiles set goal = '' where id = 'USER-ID';
```

**Edited comments.** A report sees the comment as it is now. To see what it first said:

```sql
select body, original_body from comments where id = 'COMMENT-ID';
```

**Stuck posts.** After 5 failed checks a post stops retrying and stays hidden, usually because the model declined to judge it. A person needs to look at these:

```sql
select id, author_id, media_path, moderation from posts where status = 'checking' and (moderation->>'attempts')::int >= 5;
```

**Safety cases.** These need an adult right away. See "Before launch" in `PROGRESS.md`.

```sql
select * from safety_escalations where handled_at is null;
```

## Changing things

- **App name:** `APP_NAME` in `lib/config.ts`, and `name` in `app.json`.
- **Terms and privacy links, support email:** `lib/config.ts`.
- **New table:** Supabase grants every role full access to new tables by default. Every new migration needs `enable row level security` and an explicit `revoke` plus `grant`, as in `20260101000003_rls.sql`.
- **Profanity filter:** `lib/profanity.ts` and `supabase/functions/_shared/profanity.ts` must stay identical. A test checks this.
