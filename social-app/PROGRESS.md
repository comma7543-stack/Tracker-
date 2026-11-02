# Progress

## How far this has been tested

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `npm test`: RLS, streaks, profanity, usernames, moderation logic, copy rules | All pass |
| iOS and Android Metro bundles | Build |
| Every screen rendered from a web bundle in jsdom with a fake backend: all themes, English and Korean | No errors. Found and fixed one crash (tab bar) |
| Run on a real phone or simulator | **Not done** |
| Against a real Supabase project | **Not done**: migrations ran only in PGlite with auth and storage stubbed |
| Edge Functions run | **Not done**: no Deno here. The decision logic is unit-tested, and the functions were type-checked apart from Deno and `npm:` imports |
| Real model call | **Not done**: prompt accuracy is unmeasured |
| Visual comparison with `design/` | **Not done**: no screenshots could be taken here, so spacing and colors are unreviewed |
| Video playback, Scrolls paging, photo upload, sign-in with Apple and Google, push permissions | **Not exercised**: these need a device |

First thing to do: follow the README, run it on a phone, and go through the checklist below by hand. `npm run demo` shows the screens with fake data and no setup, but tests nothing on the backend.

## Screens

Code is written for all of these. "Rendered" means seen by the jsdom walkthrough.

- [x] Welcome, phone or email, code, name and password, birthday, username, terms, account ready, log in, forgot password (rendered, except the onboarding steps that need a session)
- [x] Home: streak band, story roll, feed, Scrolls row (rendered)
- [x] Comments, share, create, suspended, streak, report sheets (rendered, except suspended)
- [x] Search (rendered idle; active grid not exercised)
- [x] Compose: all three modes (form rendered; checking and outcome screens not exercised)
- [x] Story viewer (rendered)
- [ ] Scrolls: needs real layout, so **never rendered with content**
- [x] Profile, other user's profile, post detail, edit profile (rendered, except post detail)
- [x] Notifications, inbox, thread (rendered)
- [x] Settings: all pages and search (rendered, except search)
- [x] Community Guidelines (rendered)

## Assumptions

Things the brief left open, or where it conflicted with itself or the prototype.

**Suspension.** The brief says posting is blocked "while user has ≥3 active strikes" and also that suspension "lasts 7 days from the 3rd strike", but strikes last 90 days. Built as: blocked when 3+ strikes are active and the newest is under 7 days old. After that posting resumes, and one more strike suspends again.

**Moderation mapping**
- The verdict schema has no "serious" flag, so "serious illegal" means `illegal` with confidence ≥ 0.9. Both that and `csam` remove the post, suspend indefinitely and queue a safety case. Only `csam` also bans the login.
- A caption that fails the text filter, or a file that isn't really an image or video, is rejected with no strike. The brief doesn't say; neither is a guideline violation.
- A model refusal is treated as a failure, not a rejection: the post stays hidden and retries, then waits for a person after 5 attempts.
- Model is `claude-haiku-5-5`, the owner's choice for cost. It has no server-side refusal fallback, so a post it declines stays hidden and waits for a person. Its accuracy on real posts, including the child-safety categories, is unmeasured. Set `MODERATION_MODEL` to change it; other models keep the fallback.
- Motivational quotes and consistency posts pass under any sub-topic, and there is a new Motivation topic for them. Memes and jokes are off topic, so no strike.

**Commitment questions**
- Asked once per device, before log in and sign up, so someone returning on a new phone answers again. Anyone already signed in never sees them.
- Answers stay on the device, because no account exists yet, and are shown in the streak sheet. Reinstalling loses them. Saving them to the account would mean storing teens' personal goals on the server.
- Nine screens: goal, hardest part, excuse, bad day, comparing, nobody watching, daily dare, the 1 to 10 dial, then the process message. Only the goal and the number are kept. "Who do you want to be?" was dropped in the rewrite. To remove a question, take it out of `STEPS` and `CHOICES` in `app/(auth)/commitment.tsx`.
- Every answer moves on. At 5 or below the dial dares people to go higher, but they can stay. The owner's line "you will achieve that goal no matter what" isn't in the text, because the app can't promise it.

**Reason days**
- 3 per calendar month, on top of earned freezes and spent before them. They protect today, or yesterday if it was missed, and don't add to the count. Nothing checks that a reason is true.
- Once someone posts today, yesterday can't be fixed: the post has already settled the streak. The button sits in the streak sheet for that reason.
- The reason is private to its owner. Others can see the dates, in `streaks.excused_dates`, so their display of the streak stays right.

**Finishing goals**
- A goal can be fixed for 24 hours, then it locks until a video proves it. This was the owner's decision over allowing a way out, so someone can be stuck with a goal that's wrong or has become unhealthy, including a teen. Only an adult with database access can remove one: see README "Stuck goals". A parent should know this.
- The switch "This proves my goal" sends one video to the AI, 3 tries a day. A proof story gets the full AI check and can earn a strike, unlike normal stories. This costs money, and is the one exception to stories having no AI.
- Proof is decided from up to 10 frames of the video. The AI isn't shown the caption, so a caption can't prove anything, and only the word filter checks captions on proof posts. Test real videos with `npm run try-proof` before launch: accuracy is unknown until then.
- The AI only sees frames the phone extracted from the video, and can't tell who is in it. A downloaded clip of a finish line could earn a certificate. Treat certificates as encouragement, not proof. Accuracy has never been tested with the real model.
- A proof video deleted or expired later leaves the certificate in place, without its link.

**Goals on profiles**
- Signing out for any reason clears the goal, number and settings saved on the phone, so the next person can't publish someone else's goal. The intro questions show again after that. Settings save one key at a time for the same reason.
- The goal typed in the intro goes on the profile at sign-up, and the intro says so. The dedication number stays on the device. Goals can be changed or cleared in Edit profile.
- A private account's goal only shows to approved supporters, enforced in the database by `profile_goal`. Streaks now default to Everyone, so they show on public profiles; private accounts still hide them.
- The goal word checks run in the app only, like the bio's. Someone calling the API directly could skip them.
- "Supporter" is wording only. The database, code and stored settings still say `follows` and `Followers`.

**Supporter lists**
- One switch shows or hides both lists. Adults start shown and under-18s start hidden. Counts always show, and hiding your lists doesn't take you off other people's visible lists.
- Other people's rows in `follows` can no longer be read directly: `profile_people` is the only way, and it checks the switch.
- People hidden from the viewer (blocked, or a teen an adult stranger can't discover) are left out, so a list can be shorter than its count.
- Removing a supporter tells nobody. Lists show the newest 200 people, with no paging yet.

**Streak flame**
- The flame changes at each badge: ember under 3 days, orange at 3, gold at 7, hot pink at 30, violet at 100, with more flicker and sparks as it grows. Blue means a freeze or reason day is holding the streak, until the next post.
- Someone's freezes left show to anyone who can see their streak, on their profile. Their auto-freeze setting is private, so other people's streaks are drawn as if it's on; someone with it off could look frozen for a day, then drop to 0 at their next post.

**Photos in messages**
- Only between two adults who follow each other, with no AI check, by the owner's decision. Accounts under 18 can't send or receive them, because a report only helps after a photo has been seen. A real launch to teens needs a check before this opens to them.
- The recipient can report a photo, which hides it for both people at once and files a report. There's no appeal or undo, and the file stays locked in storage. A link already loaded on the recipient's phone keeps working for up to an hour.
- Files of reported photos are never cleaned up yet, and nobody is alerted about reports. A parent should know both.

**Limits**
- Stories have no limit and no AI check, by the owner's decision: only the word filter and a file type check, both on the server. They don't count toward streaks, because otherwise a meme story could keep a streak alive.
- 5 posts and scrolls combined per person per day, by their local date. A post that goes to both feed and Scrolls counts once. Blocked and deleted posts still count. "Change topic" uses another slot, because it means another check.
- 1000 model calls a day across all users, by UTC date. Retries count, since each one is a call. Caption filter hits and invalid files cost nothing and don't count.
- One post can buy at most one model call per 3 minutes, so sending the same post repeatedly can't drain the ceiling.
- Changing time zone can reach another calendar day, for a couple of extra days' worth of posts at most.

**Streaks**
- A post counts for the local day it was shared, not the day the check finished.
- A gap larger than the freezes held resets the streak and spends none. Frozen days don't add to the count.
- An overturned appeal can raise the streak if it's the newest day, but can't fill an old gap.

**Who counts as "follow"**
- DMs and comments set to "People you follow" mean people the recipient or post owner follows, per the setting's wording.
- "Never shown to adults they don't follow": a 13-17 year old's account and posts are left out of Scrolls, Search and user search for any adult the teen doesn't follow. Teens can still appear to other teens.

**Sign-in**
- Apple and Google use Supabase's browser sign-in, because native Apple sign-in doesn't work in Expo Go.
- Phone numbers must include a country code (Supabase requires E.164), so the label says so.
- Logging in goes straight to Home. The prototype goes to "Account ready", which only makes sense after signing up.
- Reset by username can't reach a phone-only account, because the app must not learn the number. Those users have to type their number.

**Screens**
- Story roll uses the prototype's circles with a mark badge rather than the small chips in its unused code. The brief's "chips" plus "ring style" fit circles.
- The Scrolls rail has Share (brief) plus Report (required on every post), not the prototype's three-dot menu.
- Profile uses a settings button and a streak card that opens the streak sheet.
- "Autoplay on Wi-Fi only" and "Data saver" are in Settings > App. The brief uses them but its settings list omits them.
- Added: follow request Accept and Decline in Notifications (private accounts need it), a "still checking" screen, `problem` as a report type, and `suspended_until` and `safety_escalations` in the schema.
- Video limit 90 seconds and 50 MB (Supabase's free-tier file limit).
- App `userInterfaceStyle` is fixed to light; themes are chosen in Settings, not by the device.
- `prefs.nRespect` from the prototype is `nLikes` here.

**Profanity filter** is ported exactly as asked, including its known misses: `f0ck` isn't caught, and `assess` is wrongly blocked, which could annoy someone captioning study work. `tests/profanity.test.ts` records the second.

## Known gaps

**Close before launch**

1. **Video moderation can be fooled.** Frames are extracted on the phone, so a modified app could upload clean frames with a bad video. Edge Functions can't run ffmpeg. Add a server-side worker that extracts frames from the stored video.
2. **Video location data isn't stripped.** Photos are re-encoded, which removes EXIF. Videos upload as-is and can carry GPS metadata, which breaks "no location data anywhere" for 13-17 year olds. The same worker can fix this.
3. **Profanity is checked in the app only** for names, usernames, bios, comments, DMs and story replies. A modified app can skip it. Captions are also checked on the server. Adding an Edge Function or trigger would close this.
4. **No rate limits** on comments, DMs, reports or `login-with-username`. That function also hides the caller's IP from Supabase's auth limits, so password guessing isn't throttled per user. Posting is limited; see Limits above.
5. **One person with many accounts can use up the 1000 daily checks,** which makes everyone's posts wait until the next day. The bill stays capped, but sign-ups aren't limited.

**Missing but non-blocking**

- No push notifications. In-app notifications work, and the "Messages" toggle has no effect yet. Streak reminders are local and do work.
- Expired stories disappear but their files stay in storage. Add a cleanup job.
- The admin view is the Supabase SQL editor.
- Only `en` and `ko` are translated; the Korean is mine and should be read by a native speaker. Arabic switches the layout to RTL after a restart, untested.
- No app icon, logo or real legal text (known gaps in the brief).

## Systems added (November 2026)

Built after the first version, to cover what most social apps have and this one lacked. Everything below is in code and tested, with the same limits as above: **never run on a phone, against a real Supabase project, or with real Expo push.**

| System | What it does | Tested by |
|---|---|---|
| For you feed | Ranked posts from people you don't support yet. Home has a Supporting / For you switch, and starts on For you when you support nobody | `tests/db/discovery.test.ts` |
| Ranking | Likes, comments (double) and watch time, divided by age. 2x for picked topics, 0.2x for already seen. Also used by Scrolls and Explore | same |
| Suggested people | Shared supporters first, then active people in your topics. On Home, Search, Discover and during sign-up | same |
| Topics at sign-up | Two new steps after Terms: pick topics, then support a few people. Both can be skipped | demo only |
| Push notifications | Likes, comments, mentions, supporters and messages, in English or Korean, following each person's settings. Tapping one opens the right screen | `tests/db/systems.test.ts`, `tests/push.test.ts` |
| Admin queue and alerts | Settings > Account > Review queue for admins: reports with their content, review requests, counts. Admins get a push for each report, review and safety case | `tests/db/systems.test.ts` |
| Analytics and crash reports | Stored in your own database. Daily actives, retention, sign-up funnel, top crashes, as SQL views. A crashed screen shows a retry screen and is reported | same |
| Sharing | Share posts and profiles to other apps, invite friends, a streak card image for other apps' stories | not testable here |
| Hashtags and mentions | `#tags` and `@names` in captions and comments are tappable. Trending tags in Search, a page per tag. Mentions in captions notify once the post is live | `tests/db/systems.test.ts`, `tests/richtext.test.ts` |
| Faster search | Trigram indexes; `%` and `_` in a search are plain characters | same |
| Rate limits | Comments, messages, likes, supports, saves, blocks, reports, comment edits, sign-in, password reset | same |
| Video worker | Re-encodes videos on a server with all metadata dropped, takes its own frames, then lets moderation run. Deletes expired story files | `tests/worker.test.ts` runs it on a real clip with GPS tags, which are gone afterwards |

**Known gaps, updated.** Of the five "close before launch" items above:

1. Video moderation can be fooled: **closed once the worker runs and `video_worker` is on.** Until then it's still open.
2. Video location data: **same: closed once the worker is on.**
3. Profanity checked in the app only: **still open.**
4. No rate limits: **closed**, including sign-in by username.
5. One person with many accounts can use up the daily checks: **still open.** Rate limits slow a single account, not many.

Also closed: push notifications (the Messages toggle now works), expired story files (the worker deletes them), the admin view (an in-app queue, plus the SQL editor for safety cases).

**New assumptions**

- Teens get no engagement ranking anywhere: For you, Scrolls and Explore are newest first for 13-17 year olds, narrowed only by the topics they picked. California's SB 976 and similar laws restrict feeds ranked from data about minors without parental consent. This is my reading, not legal advice: ask the lawyer.
- Trending tags count only public adult accounts, so a tag can't lead adults to a teen.
- Suggested people for teens can include adults; teens are never suggested to adults they don't support. A parent may want teens shown only other teens.
- For you leaves out people you already support, and posts older than 30 days.
- Watch time is recorded for a post on screen for at least 0.8 seconds, keeping the longest view per person. It's used for ranking only.
- Analytics never stores content, names, IPs or device ids, and is first-party. It still has to be in the privacy policy.
- Push text is built in the database in English or Korean; other languages get English. A message push shows the first 100 characters on the lock screen.
- Admin "Pause 7 days" sets `suspended_until`, separate from strikes. Removing a reported message replaces its text with "[removed]".
- Streak reminders already asked for notification permission at launch, so the in-context prompt on Home only shows if they didn't.
- Shared links use `appname://` until there's a website. People without the app can't open them.
- `@` inside an email address in a caption (`me@gmail.com`) becomes a mention link to a profile that doesn't exist. Harmless, and left as is.

**Still not built:** carousels (several photos per post), a web version of shared posts, account verification, blocking sign-ups from one person with many accounts, and server-side word checks for names, bios, comments and messages.

## Before launch: for a parent and a lawyer

This isn't legal advice. These are the questions to take to someone qualified.

- **Goals that suggest someone is struggling.** Self-harm and eating goals get a kind message instead of the dare, and the goal isn't kept. A parent must approve that wording and replace `HELP_LINE` in `lib/config.ts` with real helplines for each country before launch. Ask a professional to review it. The check is a phrase list in `lib/goalCheck.ts`: it misses other wording, and nobody is alerted, so it isn't a safety system on its own.

- **Stories go live with no image check.** This was the owner's decision, to save cost, and a parent should confirm it. Nudity, violence or child abuse images posted as a story are visible to followers, including 13-17 year olds, until someone reports them and a person removes them. Nobody is alerted about reports, and the child safety steps below only run on checked posts, so they never run on stories. Ask whether this is acceptable for an app with minors, and who checks reports. Turning the check back on means removing the story branch in `supabase/functions/_shared/moderation.ts`.

- **Child safety reporting.** US providers must report apparent CSAM to the NCMEC CyberTipline and preserve it for a set period, and Korea has its own rules. Right now the app only removes the post, moves the file to a locked `quarantine` bucket, bans the account and adds a row to `safety_escalations`. **Nothing is reported automatically and no one is alerted.** Someone must own this queue before real users arrive. Decide how long files are kept: the brief says not beyond what the law requires.
- **Don't rely on an AI model alone for this.** Ask about hash-matching services (such as PhotoDNA), which run before any other processing. Also confirm the model provider's terms for sending suspected illegal content.
- **Korea, under 14.** The brief allows sign-up at 13. Korea's privacy law generally requires guardian consent to process data from children under 14, and there is no consent step. Decide whether to add one or raise the minimum age there.
- **California and other US minor-protection laws**, including rules on feeds and design for under-18s. A daily streak with reminders aimed at teens is the kind of feature these look at.
- **Privacy policy** must say that photos, frames and captions, including those of minors, go to a third-party AI provider for moderation.
- **Who answers appeals within 24 hours?** The app promises a person will. A 15-year-old shouldn't be the one reviewing flagged content involving minors.
