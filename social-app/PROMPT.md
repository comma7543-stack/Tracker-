# Build prompt for Claude Code — "[App Name]" (proof-of-work social app)

Paste everything below the line into Claude Code, run from the folder that holds this file and the `design/` folder.

---

You are building a production mobile app from a finished clickable design prototype. Read this whole file first, then read every file in `design/` before writing code. The `.dc.html` files are the source of truth for layout, copy and behavior. Where this file and the prototype disagree, this file wins.

## 1. What the app is

A social app where people only post proof of real, productive work: training, studying, coding, cooking, investing. Every post, scroll and story must belong to one of four topics and is checked by AI before it goes live. Daily posting builds a streak. Tagline on the welcome screen: "Post the work."

- Name: not chosen. Use the literal placeholder `[App Name]` everywhere, kept in one constant (`APP_NAME`) so it can be swapped in one place.
- Logo: not designed. Use a placeholder box with the text "LOGO".
- Audience: 13+. Owner is a 15-year-old in Korea/California; a parent will hold the Apple/Google developer accounts and Supabase/billing accounts. Do not build anything that requires the owner to sign contracts.
- Platforms: iOS and Android.

## 2. Stack (required)

- Expo (React Native) with TypeScript, Expo Router for navigation.
- Supabase: Postgres, Auth, Storage, Realtime (DMs, notifications), Edge Functions (moderation).
- Row Level Security on every table. No table readable or writable without a policy.
- State: React Query (TanStack Query) for server data, Zustand for local UI state (theme, settings cache).
- Video: `expo-av` or `expo-video`. Images: `expo-image`. Media picking: `expo-image-picker`.
- i18n: `i18next` with English and Korean fully translated at launch; the other languages listed in §9 exist as selectable options with English fallback.
- Config through `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`); secrets (moderation API key) only in Edge Function secrets, never in the app bundle.

## 3. Design system

Font: system font stack (SF Pro on iOS, Roboto on Android). Icons: plain outline stroke icons (lucide-react-native), stroke 1.8, active tab stroke ~2.6–2.8 or filled. No emoji in UI. No glass effects. Must look professional, not childish.

Shape and spacing:
- Primary buttons: pill (radius 999), height 46 in auth, 44 in app, 15px semibold.
- Inputs: height 52, radius 12, 1px border, 16px text, 14px horizontal padding.
- Screen side padding 20 (auth) / 16 (app). Touch targets ≥ 44.
- Disabled button: gray fill (#C7C7C7), not tappable.
- Bottom sheets: radius 16 top corners, grab handle 36×4.

### Themes (user picks in Settings → App → Theme; default **All white**)

Implement as a token object per theme; every component reads tokens only — no hardcoded colors.

| Token | All white (`white`) | Neon (`neon`) | Colorful (`color`) |
|---|---|---|---|
| bg | #FFFFFF | #000000 | #F4F1FF |
| surface | #FAFAFA | #121212 | #FFFFFF |
| surface2 | #EFEFEF | #1F1F1F | #E9E4FF |
| line | #DBDBDB | #2E2E2E | #D3CCF2 |
| fg | #000000 | #F5F5F5 | #14112B |
| muted | #737373 | #A3A3A3 | #5A5670 |
| faint | #C7C7C7 | #4A4A4A | #A9A3C9 |
| accent | #000000 | #FFFFFF | #FF2E88 |
| onAccent | #FFFFFF | #000000 | #14112B |
| accentHover/pressed | #262626 | #E0E0E0 | #FF5AA0 |
| danger | #B3261E | #FF7070 | #C4142B |
| brand / ring | #000000 | #FFFFFF | #2952FF |
| card border | 1px #DBDBDB | 1px rgba(255,255,255,.16) | 2px #14112B |
| glow | none | white glow on streak number, flame, active badges, unseen story rings | none |

- Neon also uses subtle dark gradients for page and cards (top radial #3a3a3a → #121212 → #000).
- Colorful: active tab icon is #2952FF; story rings rotate #2952FF / #FF2E88 / #9BD412.
- **Scrolls and the story viewer are always dark (#111 background, white text) in every theme.**
- "Reduce motion" setting disables all animations.

## 4. Topics (fixed list, used for posting, filtering and moderation)

| Topic | Sub-tags |
|---|---|
| Fitness | Gym, Running, Sports, Yoga |
| Learning | Reading, Studying, Languages, Writing |
| Work and tech | Coding, AI and Claude, Design, Building |
| Money and health | Trading, Investing, Cooking, Healthy eating |

Every post, scroll and story requires exactly one sub-tag (the topic is derived from it). Store both.

## 5. Screens and flows

### 5.1 Auth (files: Main, SignUp, Verify, NamePassword, Birthday, Username, Terms, Done, Login, Forgot)

Order: Welcome → Phone or email → 6-digit code → Name + password → Birthday → Username → Terms → Account ready → Home.

- **Welcome**: logo, `[App Name]`, "Post the work.", buttons: Get started, Continue with Apple, Continue with Google, "Already have an account? Log in". Apple/Google go straight to Birthday (they skip phone/name/password).
- **Phone or email**: phone by default, toggle "Use email instead". Phone valid when ≥7 digits, email by regex. Copy: "We use it to keep your account secure. It stays private and never shows on your profile."
- **Verify**: 6 boxes, numeric, `one-time-code` autofill, "Resend code" with "New code sent." confirmation. Use Supabase phone OTP / email OTP for real.
- **Name + password**: full name (profanity-filtered, error "Names can't include offensive words."), password ≥8 chars with Show/Hide and live note ("N more characters needed." / "Password looks good.").
- **Birthday**: native date picker, max = today. Shows age in the label. Under 13 → block with "You need to be at least 13 to sign up." Store DOB; never show it on profile. Users 13–17 get stricter defaults (see §8).
- **Username**: lowercase a–z, 0–9, `.` and `_`, 3–30 chars, can't start or end with `.`, profanity-filtered, live availability check against the DB, suggestion chip.
- **Terms**: summary box of allowed topics, banned content, strike rule, 13+ statement; "I agree" records acceptance timestamp + terms version.
- **Account ready**: "Welcome to [App Name]" → Continue to Home.
- **Log in**: username/email/phone + password, Forgot password, Apple, Google, "New here? Create an account".
- **Forgot password**: send reset link/code.

### 5.2 Main app shell (file: Home.dc.html — one big file containing every in-app screen)

Bottom tab bar, 5 items: **Home**, **Search**, **Create** (accent pill button in the center), **Scrolls**, **Profile**.
Top bar on Home: app name left; Notifications (dot when unread) and Messages on the right.

**Home**
- Streak band at top: date label, today's status ("Posted today" / "Left to post today" + countdown hh mm to local midnight), streak count with flame.
- Story roll: horizontal chips for "You" + people you follow. Marks: ✓ posted today, · not yet. Seen vs unseen ring style. Counter "X of Y done". Tapping someone who hasn't posted shows a toast "<name> hasn't posted proof yet today".
- Feed: posts from people you follow. Post card: avatar, username, topic · time, streak count, photo/video, caption, actions: **Like (heart)**, Comment, Share, Save. Use "Like" everywhere — never "Respect".
- A horizontal row of Scrolls previews inside the feed.
- **No feed lock.** The old "unlock feed after posting" mechanic was removed. The prototype still has a dead `locked` flag (always false) — do not implement it.

**Comments (bottom sheet)**: threaded one level of replies, like on comments with counts, "Reply" sets reply target with a cancel chip, profanity filter on input, Post button disabled while empty or offensive.

**Search / Explore**: search bar (users, captions, topics), topic filter chips (All + 4 topics), 2-column grid "Recommended for you" / "Results for "<q>"", empty state.

**Create sheet**: three options — Post, Story, Scroll. If suspended (3 strikes) show the "Posting suspended" sheet instead.

**Compose screen**
1. Choose photo or video (Scroll = video only).
2. Caption / overlay text (profanity-filtered).
3. Required topic picker: topic group chips → sub-tag chips. Share disabled until picked.
4. Post only: toggle "Also share to Scrolls" (only when media is video).
5. Share → state **Checking** (spinner) → one of:
   - **Approved** → publish, toast "Posted" / "Posted to feed and Scrolls" / "Shared to Scrolls".
   - **Off-topic** → "This doesn't look like <topic>". Options: change topic, request review, discard. **No strike.**
   - **Banned** → post blocked, **+1 strike**, line "This is strike N of 3. At 3 strikes, posting is suspended for 7 days." Options: request review, read Community Guidelines, discard.
   - **Review requested** → "A person on our team will look at it within 24 hours. If the check got it wrong, your post goes up and any strike is removed."
   - The prototype has a demo switch (ok / off-topic / banned) to fake the outcome. **Do not ship that switch.** Replace with the real moderation call (§7).

**Story viewer**: full-screen dark, progress bars (5s per frame, pause on hold), tap left/right to go back/forward, reply input at bottom, close.

**Scrolls**: full-screen vertical swipe video feed with snap paging, always dark. Right rail: Like (heart + count), Comment, Share. Bottom: username, Follow button, caption, topic tag. Tap to pause, mute toggle. Autoplay respects "Autoplay on Wi-Fi only" and data saver settings.

**Profile**: avatar, name, username, bio, follower/following counts, current streak and best streak, grid of posts, tab for scrolls, Edit profile, Settings gear. Other users' profiles: Follow/Following, Message, More (Report, Block).

**Streak detail (sheet)**: big flame + number (glow in Neon), message ("Done for today. Post tomorrow to reach day N+1." / "Xh Ym left to keep it alive." / "Post today to start your streak."), Mon–Sun week calendar with posted days filled, badges 3 days / 1 week / 30 days / 100 days (earned = filled, next = outlined, locked = dim), progress bar to next badge "N / goal · K days to go", best streak, freezes available.

**Notifications panel**: likes, comments, follows (with inline Follow back), mentions; unread highlight; tapping a comment notification opens that post's comments.

**Messages**: inbox with search, unread bold, last-message preview ("You: ..."), thread view with send box, profanity filter, realtime updates. Respect "Who can message you".

**Edit profile**: name, username, bio — all profanity-filtered and validated the same as sign-up.

**Toasts**: small pill above the tab bar for confirmations.

### 5.3 Settings (sheet, searchable — typing filters every setting across all pages)

- **Your streak**: Streak reminders (on/off + time 6 PM / 9 PM / 11 PM; only sent on days not yet posted), Streak freeze (earn 1 per 7-day run, hold max 2, toggle "Use a freeze automatically"), Who sees your streak (Everyone / Followers / Only me).
- **Notifications**: Pause all, Likes and comments, New followers, Messages.
- **Privacy and safety**: Private account (only approved followers see posts, scrolls, streak), Who can message you (Everyone / People you follow / No one), Who can comment (Everyone / People you follow / Off) + Hide offensive comments, Blocked accounts list.
- **App**: Theme (All white / Neon / Colorful), Language, Daily time limit (Off / 15 min / 30 min / 1 hour / 2 hours → reminder when reached), Reduce motion.
- **Account**: Account status (strikes N of 3, posting allowed/suspended, reviews requested; "Strikes come from posts that break the guidelines. Each one expires after 90 days. Off-topic posts are removed but never give a strike."), Edit profile, Change password, Help and legal (Community Guidelines, Report a problem, Terms of Use, Privacy Policy, Version), Log out, Delete account (confirm screen: "This permanently deletes your profile, posts, scrolls, stories, messages and streak. It can't be undone.").
- Remove the prototype's "Reset strikes (prototype only)" button.

Defaults: autoFreeze on, streakRemind on at 9 PM, all notifications on, isPrivate off, hideOffensive on, captions on, high quality on, dataSaver off, autoplayWifi off, reduceMotion off, dmWho "People you follow", commentWho "Everyone", streakWho "Followers", theme "white", language from device (fallback en).

### 5.4 Community Guidelines page (copy is in the prototype — reuse it)

- What you can post: the 4 topics. "Every post, scroll and story needs one of these topics and has to actually show it."
- Never allowed: nudity or sexual content (incl. suggestive poses/outfits/captions); anything illegal (drugs, weapons, theft, crimes); violence or self-harm; hate and bullying; scams and fake proof (guaranteed-profit trading, paid promos, faked results); alcohol, vaping or gambling.
- What happens: off-topic → removed, no strike. Breaks a rule → 1 strike; 3 strikes in 90 days → 7-day posting suspension. Zero tolerance: sexual content involving minors or serious illegal content → account removed immediately and reported to authorities.
- Review requests answered by a human within 24 hours.

## 6. Data model (Supabase / Postgres)

Write SQL migrations in `supabase/migrations/`. Minimum tables:

- `profiles` (id = auth.users.id, username unique citext, full_name, bio, avatar_url, dob, is_private, created_at, terms_version, terms_accepted_at, deleted_at)
- `settings` (user_id PK, prefs jsonb, choices jsonb) — or explicit columns matching §5.3
- `follows` (follower_id, followee_id, status: pending/accepted, created_at) — pending used for private accounts
- `blocks` (blocker_id, blocked_id)
- `posts` (id, author_id, kind: post/story/scroll, media_path, media_type photo/video, caption, topic, subtag, status: checking/live/off_topic/rejected/under_review/removed, moderation jsonb, also_scroll bool, created_at, expires_at for stories = +24h)
- `likes` (user_id, post_id), `comments` (id, post_id, author_id, parent_id nullable, body, created_at), `comment_likes`
- `saves` (user_id, post_id)
- `story_views` (story_id, viewer_id)
- `conversations`, `conversation_members`, `messages` (sender_id, body, created_at, read_at)
- `notifications` (user_id, actor_id, type, post_id, comment_id, read_at)
- `streaks` (user_id PK, current, best, last_post_date (user's local date), freezes_available 0–2, timezone)
- `strikes` (id, user_id, post_id, reason, created_at, expires_at = +90d, voided bool)
- `appeals` (id, user_id, post_id, status: open/upheld/overturned, created_at, resolved_at, reviewer_id)
- `reports` (reporter_id, target_type user/post/comment/message, target_id, reason, created_at, status)

Rules enforced in the DB (RLS, triggers or RPCs — not only in the app):
- Blocked users can't see each other's profile, posts, stories, comments, or message each other (both directions).
- Private accounts: content visible only to accepted followers.
- Only `status = 'live'` posts are visible to anyone except the author.
- Posting rejected server-side while user has ≥3 active (non-expired, non-voided) strikes; suspension lasts 7 days from the 3rd strike.
- Comments and DMs respect "Who can comment" / "Who can message you".
- Streak updates happen in a trigger/function when a post goes `live`, using the user's timezone: same day → no change; next day → +1; missed day(s) → consume freezes if autoFreeze and available, else reset to 1. Award +1 freeze at every 7-day multiple, cap 2. Update `best`.
- Delete account: hard-delete or anonymize all user content and storage files, sign out everywhere.

Storage buckets: `media` (posts/scrolls/stories, private, served via signed URLs), `avatars`. Validate file type and size server-side. Strip EXIF location from photos before upload.

## 7. Moderation (server-side, required)

Client-side checks are only for instant feedback. The real decision is server-side.

- Edge Function `moderate-post`: on upload, set post `status='checking'`, then:
  1. Run the text filter (§7.1) on caption.
  2. Send the image (or 3–5 extracted video frames) + caption + chosen topic/sub-tag to a vision model (Claude API recommended; key stored as Edge Function secret).
  3. Model returns strict JSON: `{ "on_topic": bool, "violation": null | "sexual" | "illegal" | "violence_self_harm" | "hate_bullying" | "scam_fake" | "alcohol_vape_gambling" | "csam", "confidence": 0-1, "reason": string }`.
  4. Map: violation → `rejected` + strike; not on-topic → `off_topic`, no strike; else → `live`.
  5. `csam` or serious illegal → immediately remove, suspend account, flag for mandatory reporting (in the US, NCMEC CyberTipline). Do not store the content beyond what reporting law requires. Document this as a TODO for the owner's parent/lawyer to finalize.
- Appeals: `appeals` row + admin view (simple protected web page or Supabase table view is fine for v1). Overturn → post goes live, strike voided.
- Report button on every post, comment, profile and message → `reports` table.
- Fail closed: if the model call errors or times out, keep the post in `checking` and retry; never auto-publish.

### 7.1 Profanity filter

Port the exact `isBad()` function from `design/NamePassword.dc.html` into a shared module (`/lib/profanity.ts`) and also into the Edge Function. It covers English and Korean, leetspeak (0→o, 1/!/|→i, 3→e, 4/@→a, 5/$→s, 7/+→t, 8→b, 9→g), repeated letters, s p a c e d letters, and an allow-list (shiitake, Scunthorpe, cocktail, assassin, classic, etc.). Use it on: names, usernames, bios, captions, comments, DMs, story replies. Do not remove or shorten the word lists.

## 8. Safety and store requirements

- Apple/Google UGC rules: report, block, hide offensive content, published guidelines, account deletion in-app, contact for support. All required — build them.
- Users 13–17: default to private account, DMs from "People you follow", streak visible to Followers, no location data anywhere, never shown to adults they don't follow in recommendations.
- No ads, no in-app purchases in v1.
- Privacy policy and terms are placeholder links (`[Terms of Use link]` etc.) until written.

## 9. Languages

English (en), 한국어 (ko), 日本語 (ja), 中文简体 (zh), 中文繁體 (zh-TW), Español (es), Français (fr), Deutsch (de), Português (pt), Tiếng Việt (vi), ภาษาไทย (th), Bahasa Indonesia (id), Filipino (tl), Русский (ru), العربية (ar, RTL), हिन्दी (hi). Ship en + ko complete; others fall back to en.

## 10. Copy rules

- Use "Like" with a heart icon. Never "Respect".
- Use "Scrolls" for the short-video feed. Never "Reels".
- Don't copy Instagram's wording, icons, layout of the create button, or profile header. Keep the existing original copy from the prototype.
- No emoji anywhere in the UI.

## 11. Folder layout

```
app/                (expo-router routes: (auth)/..., (tabs)/home, search, scrolls, profile, modals)
components/
lib/                (supabase client, profanity.ts, streak helpers, theme tokens, i18n)
locales/en.json, ko.json, ...
supabase/migrations/
supabase/functions/moderate-post/
supabase/seed.sql   (a few demo users and posts for local testing)
README.md           (setup steps written for a beginner: Supabase project, env vars, running in Expo Go, building with EAS)
```

## 12. How to work

1. Read `design/` fully. Make a short plan and a checklist of screens; keep the checklist updated in `PROGRESS.md`.
2. Build in this order: schema + RLS → auth flow → app shell + theme system → Home feed + posting + moderation → streaks → comments/likes → Scrolls → stories → profile → search → notifications → DMs → settings → safety features → i18n.
3. Write tests for: RLS policies (block, private, suspension), streak function (same day, next day, missed day with/without freeze, freeze cap), profanity filter (positive + allow-list cases), username validation.
4. Typecheck (`tsc --noEmit`) and run the test suite before saying a step is done.
5. Never delete lines or comments from existing files unless the change requires it — explain any removal.
6. When you guess at something not specified here, say so in `PROGRESS.md` under "Assumptions".

## 13. Known gaps (not decided yet — use placeholders, don't invent)

- App name, logo, app icon.
- Terms of Use, Privacy Policy text.
- Moderation model choice and cost budget (default to Claude API; make provider swappable).
- Monetization (none in v1).
- Earlier Expo + Supabase codebase exists from a prior session but is out of date with this design; if it's in the folder, reuse the safe parts (schema, auth) and rebuild UI to match `design/`.
