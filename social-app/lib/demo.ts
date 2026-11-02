// Demo mode (npm run demo): a fake Supabase held in memory, so every screen can be seen
// with no accounts. It stands in at the fetch level, so the app's own code runs unchanged.
// Nothing leaves the phone except requests for the placeholder photos and video.
// Changes last until the app reloads.
//
// ponytail: only what the app calls is answered: no joins, no RLS. Never a test of the real backend.

type Row = Record<string, any>;

const ME = '00000000-0000-4000-8000-000000000001';
const MINJUN = '00000000-0000-4000-8000-000000000002';
const JESS = '00000000-0000-4000-8000-000000000003';
const DAN = '00000000-0000-4000-8000-000000000004';
const SORA = '00000000-0000-4000-8000-000000000005';
const YUNA = '00000000-0000-4000-8000-000000000006';

const HOUR = 3600e3;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => dayKey(new Date(Date.now() - n * 24 * HOUR));

const topicFor: Record<string, string> = {
  Gym: 'Fitness', Running: 'Fitness', Reading: 'Learning', Studying: 'Learning', Coding: 'Work and tech', Building: 'Work and tech', Cooking: 'Money and health', Quotes: 'Motivation',
};

let nextId = 1;
const newId = () => `demo-${nextId++}`;

const person = (id: string, username: string, full_name: string, bio: string, goal = '', is_private = false): Row =>
  ({ id, username, full_name, bio, goal, goal_set_at: goal ? ago(72) : null, avatar_url: null, is_private, created_at: ago(900) });

const post = (id: string, author_id: string, kind: string, media_type: string, caption: string, subtag: string, likes: number, hours: number): Row => ({
  id, author_id, kind, media_type, caption, subtag, topic: topicFor[subtag], status: 'live', also_scroll: false,
  media_path: `${id}.${media_type === 'video' ? 'mp4' : 'jpg'}`, created_at: ago(hours),
  expires_at: kind === 'story' ? new Date(Date.now() + 20 * HOUR).toISOString() : null, seed_likes: likes,
});

const MY_CAPTIONS: [string, string][] = [
  ['Deadlifts, 3 sets of 5 at 120kg. New best.', 'Gym'],
  ['Finished chapter 6 and took notes.', 'Reading'],
  ['Shipped the login page for my side project.', 'Coding'],
  ['Pull day. Rows and chin-ups.', 'Gym'],
  ['Two hours of chemistry practice problems.', 'Studying'],
  ['8km easy run before school.', 'Running'],
  ['Squats, 5 sets of 5 at 90kg.', 'Gym'],
  ['Built a shelf for my desk.', 'Building'],
  ['Cooked dinner for the family. Bibimbap.', 'Cooking'],
];

const initialState = () => ({
  profiles: [
    person(ME, 'alex.lifts', 'Alex Kim', 'Building things and lifting heavy.', 'Deadlift 200kg'),
    person(MINJUN, 'minjun.lifts', 'Minjun Park', 'Powerlifting. 14 weeks into 5/3/1.', 'Squat 180kg by summer'),
    person(JESS, 'jess.cooks', 'Jess Lee', 'Meal prep every Sunday.', 'Open my own restaurant'),
    person(DAN, 'dan.reads', 'Dan Cho', '20 pages a day.', 'Read 50 books this year'),
    person(SORA, 'sora.runs', 'Sora Han', 'Training for my first half marathon.', 'Run a half marathon'),
    person(YUNA, 'yuna.studies', 'Yuna Choi', 'Private study log.', 'Get into med school', true),
  ] as Row[],
  settings: [{
    user_id: ME,
    prefs: { autoFreeze: true, streakRemind: false, pauseAll: false, nLikes: true, nFollows: true, nDms: true, isPrivate: false, showLists: true, hideOffensive: true, dataSaver: false, autoplayWifi: false, reduceMotion: false },
    choices: { reminderTime: '9 PM', timeLimit: 'Off', dmWho: 'People you follow', commentWho: 'Everyone', streakWho: 'Everyone', theme: 'white', lang: '' },
  }] as Row[],
  // Not posted today yet, so the streak band asks for today's proof.
  streaks: [
    { user_id: ME, current: 9, best: 14, last_post_date: daysAgo(1), freezes_available: 1 },
    { user_id: MINJUN, current: 105, best: 105, last_post_date: daysAgo(0), freezes_available: 2 },
    { user_id: JESS, current: 6, best: 21, last_post_date: daysAgo(0), freezes_available: 0 },
    { user_id: DAN, current: 30, best: 30, last_post_date: daysAgo(0), freezes_available: 1 },
    // A missed day with a freeze left, so the demo shows the blue flame.
    { user_id: SORA, current: 12, best: 12, last_post_date: daysAgo(2), freezes_available: 2 },
    { user_id: YUNA, current: 2, best: 8, last_post_date: daysAgo(1), freezes_available: 0 },
  ] as Row[],
  posts: [
    post('p1', MINJUN, 'post', 'photo', 'Leg day. Squats 5x5 at 100kg, then walking lunges.', 'Gym', 23, 2),
    post('p2', JESS, 'post', 'photo', 'Meal prep for the week. Chicken, rice, broccoli. Five boxes done.', 'Cooking', 41, 4),
    post('p3', DAN, 'post', 'video', 'Day 30 of reading 20 pages before bed.', 'Reading', 58, 6),
    post('p4', SORA, 'post', 'photo', 'Long run done. 14km in the rain.', 'Running', 17, 9),
    post('p5', YUNA, 'post', 'photo', 'Small steps every day beat big plans you never start.', 'Quotes', 9, 12),
    post('s1', SORA, 'scroll', 'video', '5km tempo run. Negative splits.', 'Running', 12, 1),
    post('s2', JESS, 'scroll', 'video', 'High-protein pancakes in five minutes.', 'Cooking', 30, 3),
    post('s3', MINJUN, 'scroll', 'video', 'Bench form check. 80kg for 8.', 'Gym', 44, 5),
    post('st1', MINJUN, 'story', 'photo', 'Leg day. 100kg for 5.', 'Gym', 0, 2),
    post('st3', MINJUN, 'story', 'photo', 'Lunges done. Legs are gone.', 'Gym', 0, 1),
    post('st2', JESS, 'story', 'photo', 'Sunday prep is done.', 'Cooking', 0, 5),
    ...MY_CAPTIONS.map(([caption, subtag], i) => post(`mine${i}`, ME, 'post', 'photo', caption, subtag, 8 + i * 3, 24 * (i + 1))),
  ] as Row[],
  likes: [{ user_id: ME, post_id: 'p2' }] as Row[],
  saves: [{ user_id: ME, post_id: 'p3' }] as Row[],
  story_views: [{ story_id: 'st2', viewer_id: ME }] as Row[],
  comments: [
    { id: 'c1', post_id: 'p1', author_id: SORA, parent_id: null, body: 'Clean depth on those squats.', created_at: ago(1), seed_likes: 4 },
    { id: 'c2', post_id: 'p1', author_id: JESS, parent_id: null, body: 'What program are you running?', created_at: ago(0.7), seed_likes: 1 },
    { id: 'c3', post_id: 'p1', author_id: MINJUN, parent_id: 'c2', body: '@jess.cooks 5/3/1. Week 2 right now.', created_at: ago(0.5), seed_likes: 2 },
    { id: 'c4', post_id: 'mine0', author_id: DAN, parent_id: null, body: 'Day 1 is the hardest. Keep going.', created_at: ago(20), seed_likes: 0 },
  ] as Row[],
  comment_likes: [{ user_id: ME, comment_id: 'c2' }] as Row[],
  goal_certificates: [{ id: 'cert1', user_id: DAN, goal: 'Read 30 books', post_id: 'p3', streak: 30, finished_at: ago(240) }] as Row[],
  follows: [
    { follower_id: ME, followee_id: MINJUN, status: 'accepted' },
    { follower_id: SORA, followee_id: MINJUN, status: 'accepted' },
    { follower_id: JESS, followee_id: MINJUN, status: 'accepted' },
    { follower_id: MINJUN, followee_id: DAN, status: 'accepted' },
    { follower_id: ME, followee_id: JESS, status: 'accepted' },
    { follower_id: ME, followee_id: DAN, status: 'accepted' },
    { follower_id: MINJUN, followee_id: ME, status: 'accepted' },
    { follower_id: JESS, followee_id: ME, status: 'accepted' },
    { follower_id: SORA, followee_id: ME, status: 'accepted' },
    { follower_id: YUNA, followee_id: ME, status: 'pending' },
  ] as Row[],
  blocks: [] as Row[],
  reports: [] as Row[],
  notifications: [
    { id: 'n1', user_id: ME, type: 'follow', actor_id: SORA, post_id: null, comment_id: null, read_at: null, created_at: ago(1) },
    { id: 'n2', user_id: ME, type: 'like', actor_id: JESS, post_id: 'mine0', comment_id: null, read_at: null, created_at: ago(3) },
    { id: 'n3', user_id: ME, type: 'follow_request', actor_id: YUNA, post_id: null, comment_id: null, read_at: ago(5), created_at: ago(30) },
    { id: 'n4', user_id: ME, type: 'comment', actor_id: DAN, post_id: 'mine0', comment_id: 'c4', read_at: ago(5), created_at: ago(20) },
  ] as Row[],
  conversation_members: [
    { conversation_id: 'conv1', user_id: ME }, { conversation_id: 'conv1', user_id: MINJUN },
    { conversation_id: 'conv2', user_id: ME }, { conversation_id: 'conv2', user_id: SORA },
  ] as Row[],
  messages: [
    { id: 'm0', conversation_id: 'conv1', sender_id: MINJUN, body: '', photo_path: 'conv1/gym.jpg', photo_removed_at: null, created_at: ago(2), read_at: ago(1.9) },
    { id: 'm1', conversation_id: 'conv1', sender_id: MINJUN, body: 'Saw your post. Solid.', created_at: ago(1), read_at: null },
    { id: 'm2', conversation_id: 'conv1', sender_id: ME, body: 'Thanks. Day 9.', created_at: ago(0.5), read_at: ago(0.4) },
    { id: 'm3', conversation_id: 'conv1', sender_id: MINJUN, body: 'Leg day tomorrow? 6am', created_at: ago(0.3), read_at: null },
    { id: 'm4', conversation_id: 'conv2', sender_id: ME, body: 'See you at the track', created_at: ago(48), read_at: ago(47) },
  ] as Row[],
  status: { strikes: 1, suspended: false, reviews_requested: 0 },
  postsUsed: 0,
  reasonDaysUsed: 0,
});

const POST_LIMIT = 5;
const REASON_DAYS = 3;

let db = initialState();

// ---------------------------------------------------------------- views

const blockedIds = () => db.blocks.map((b) => b.blocked_id);
const profile = (id: string) => db.profiles.find((p) => p.id === id);
const streakOf = (id: string) => db.streaks.find((s) => s.user_id === id);

const postCards = (): Row[] => db.posts.filter((p) => profile(p.author_id)).map((p) => {
  const author = profile(p.author_id) as Row;
  const streak = streakOf(p.author_id);
  return {
    ...p,
    username: author.username, full_name: author.full_name, avatar_url: author.avatar_url,
    streak_current: streak?.current ?? null, streak_last_post_date: streak?.last_post_date ?? null, streak_excused_dates: streak?.excused_dates ?? [], streak_freezes: streak?.freezes_available ?? null,
    like_count: (p.seed_likes ?? 0) + db.likes.filter((l) => l.post_id === p.id).length,
    comment_count: db.comments.filter((c) => c.post_id === p.id).length,
    liked_by_me: db.likes.some((l) => l.post_id === p.id),
    saved_by_me: db.saves.some((s) => s.post_id === p.id),
  };
});

const commentCards = () => db.comments.map((c) => {
  const author = profile(c.author_id) as Row;
  return {
    ...c, username: author.username, avatar_url: author.avatar_url,
    like_count: (c.seed_likes ?? 0) + db.comment_likes.filter((l) => l.comment_id === c.id).length,
    liked_by_me: db.comment_likes.some((l) => l.comment_id === c.id),
  };
});

const followStatus = (follower: string, followee: string) =>
  db.follows.find((f) => f.follower_id === follower && f.followee_id === followee)?.status ?? null;

const notificationCards = () => db.notifications.map((n) => {
  const actor = profile(n.actor_id) as Row;
  return {
    ...n, actor_username: actor.username, actor_avatar_url: actor.avatar_url,
    comment_body: db.comments.find((c) => c.id === n.comment_id)?.body ?? null,
    my_follow_status: followStatus(ME, n.actor_id), their_follow_status: followStatus(n.actor_id, ME),
  };
});

const VIEWS: Record<string, () => Row[]> = { post_cards: postCards, comment_cards: commentCards, notification_cards: notificationCards };

const isVisible = (p: Row) => p.status === 'live' && !blockedIds().includes(p.author_id);
const newestFirst = (a: Row, b: Row) => b.created_at.localeCompare(a.created_at);

const page = (rows: Row[], before: string | null, limit: number) =>
  rows.filter((r) => !before || r.created_at < before).sort(newestFirst).slice(0, limit);

function inbox() {
  const mine = db.conversation_members.filter((m) => m.user_id === ME);
  return mine.map(({ conversation_id }) => {
    const other = profile(db.conversation_members.find((m) => m.conversation_id === conversation_id && m.user_id !== ME)?.user_id) as Row;
    const messages = db.messages.filter((m) => m.conversation_id === conversation_id).sort(newestFirst);
    return {
      conversation_id, other_id: other.id, other_username: other.username, other_avatar_url: other.avatar_url,
      last_body: messages[0]?.body ?? '', last_sender_id: messages[0]?.sender_id ?? ME, last_at: messages[0]?.created_at ?? ago(0),
      unread: messages.filter((m) => m.sender_id !== ME && !m.read_at).length,
    };
  }).sort((a, b) => b.last_at.localeCompare(a.last_at));
}

function storyRoll() {
  const following = db.follows.filter((f) => f.follower_id === ME && f.status === 'accepted').map((f) => f.followee_id);
  return [ME, ...following, SORA].filter((id, i, all) => all.indexOf(id) === i && !blockedIds().includes(id)).map((id) => {
    const author = profile(id) as Row;
    const stories = db.posts.filter((p) => p.author_id === id && p.kind === 'story' && p.status === 'live');
    return {
      user_id: id, username: author.username, avatar_url: author.avatar_url,
      posted_today: streakOf(id)?.last_post_date === daysAgo(0), has_story: stories.length > 0,
      all_seen: stories.every((s) => db.story_views.some((v) => v.story_id === s.id)),
    };
  });
}

function startConversation(other: string) {
  const mine = db.conversation_members.filter((m) => m.user_id === ME).map((m) => m.conversation_id);
  const found = db.conversation_members.find((m) => m.user_id === other && mine.includes(m.conversation_id));
  if (found) return found.conversation_id;
  const id = newId();
  db.conversation_members.push({ conversation_id: id, user_id: ME }, { conversation_id: id, user_id: other });
  return id;
}

// Dan hides his lists, so the demo shows what that looks like.
const listsVisible = (id: string) =>
  id === ME ? true : id !== DAN && (!profile(id)?.is_private || followStatus(ME, id) === 'accepted');

const RPC: Record<string, (a: Row) => unknown> = {
  home_feed: (a) => {
    const seen = db.follows.filter((f) => f.follower_id === ME && f.status === 'accepted').map((f) => f.followee_id).concat(ME);
    return page(postCards().filter((p) => isVisible(p) && p.kind === 'post' && seen.includes(p.author_id)), a.p_before, a.p_limit);
  },
  scrolls_feed: (a) => page(postCards().filter((p) => isVisible(p) && (p.kind === 'scroll' || p.also_scroll)), a.p_before, a.p_limit),
  explore: (a) => {
    const q = (a.p_q ?? '').toLowerCase();
    return page(postCards().filter((p) => isVisible(p) && p.kind !== 'story' && p.author_id !== ME
      && (!a.p_topic || p.topic === a.p_topic)
      && (!q || p.caption.toLowerCase().includes(q) || p.subtag.toLowerCase().includes(q))), null, a.p_limit);
  },
  search_users: (a) => {
    const q = (a.p_q ?? '').toLowerCase();
    return db.profiles.filter((p) => p.id !== ME && !blockedIds().includes(p.id) && (p.username.includes(q) || p.full_name.toLowerCase().includes(q))).slice(0, a.p_limit);
  },
  story_roll: storyRoll,
  profile_stats: (a) => [{
    followers: db.follows.filter((f) => f.followee_id === a.p_user && f.status === 'accepted').length,
    following: db.follows.filter((f) => f.follower_id === a.p_user && f.status === 'accepted').length,
    posts: db.posts.filter((p) => p.author_id === a.p_user && p.kind === 'post' && p.status === 'live').length,
    lists_visible: listsVisible(a.p_user),
  }],
  profile_people: (a) => {
    if (!listsVisible(a.p_user)) return [];
    const supporters = a.p_list === 'supporters';
    return db.follows
      .filter((f) => f.status === 'accepted' && (supporters ? f.followee_id : f.follower_id) === a.p_user)
      .map((f) => profile(supporters ? f.follower_id : f.followee_id))
      .filter((p) => p && !blockedIds().includes(p.id))
      .map((p) => ({ id: p!.id, username: p!.username, full_name: p!.full_name, avatar_url: p!.avatar_url, my_status: followStatus(ME, p!.id) }));
  },
  profile_goal: (a) => {
    const p = profile(a.p_user);
    return !p?.goal || (p.is_private && a.p_user !== ME && followStatus(ME, a.p_user) !== 'accepted') ? null : p.goal;
  },
  set_pref: (a) => {
    const row = db.settings.find((s) => s.user_id === ME);
    if (row) row.prefs = { ...row.prefs, [a.p_key]: a.p_value };
    return null;
  },
  set_choice: (a) => {
    const row = db.settings.find((s) => s.user_id === ME);
    if (row) row.choices = { ...row.choices, [a.p_key]: a.p_value };
    return null;
  },
  goal_status: () => [{ goal: profile(ME)?.goal ?? '', set_at: profile(ME)?.goal_set_at ?? null }],
  account_status: () => [db.status],
  posting_limits: () => [{ posts_used: db.postsUsed, posts_limit: POST_LIMIT }],
  can_send_photos: (a) => {
    const other = db.conversation_members.find((m) => m.conversation_id === a.p_conversation && m.user_id !== ME)?.user_id;
    return followStatus(ME, other) === 'accepted' && followStatus(other, ME) === 'accepted';
  },
  report_photo: (a) => {
    const message = db.messages.find((m) => m.id === a.p_message);
    if (message) message.photo_removed_at ??= ago(0);
    return null;
  },
  reason_days_left: () => REASON_DAYS - db.reasonDaysUsed,
  use_reason_day: (a) => {
    const streak = streakOf(ME) as Row;
    if ((streak.excused_dates ?? []).includes(a.p_day)) return null;
    if (db.reasonDaysUsed >= REASON_DAYS) throw new Error('reason_limit');
    db.reasonDaysUsed += 1;
    streak.excused_dates = [...(streak.excused_dates ?? []), a.p_day];
    return null;
  },
  inbox,
  blocked_accounts: () => db.profiles.filter((p) => blockedIds().includes(p.id)),
  username_available: (a) => !db.profiles.some((p) => p.username === a.p_username),
  start_conversation: (a) => startConversation(a.p_other),
  mark_conversation_read: (a) => {
    db.messages.filter((m) => m.conversation_id === a.p_conversation && m.sender_id !== ME).forEach((m) => { m.read_at ??= ago(0); });
    return null;
  },
  request_review: () => {
    db.status.reviews_requested += 1;
    return null;
  },
  complete_signup: (a) => {
    db.profiles = [...db.profiles.filter((p) => p.id !== ME), { ...person(ME, a.p_username, a.p_full_name, '', (a.p_goal ?? '').trim()), goal_set_at: a.p_goal ? ago(0) : null }];
    return null;
  },
  set_timezone: () => null,
};

// ---------------------------------------------------------------- moderation

/** There's no AI here to watch the video, so the proof screen asks what it would say. Captions never count. */
function judgeProof(row: Row, proven?: boolean) {
  const me = profile(ME);
  if (!row.goal_proof || !me?.goal) return {};
  if (!proven) {
    return { goal_finished: false, goal_reason: 'The video shows practice, but not the goal finished.' };
  }
  const id = newId();
  db.goal_certificates.push({ id, user_id: ME, goal: me.goal, post_id: row.id, streak: streakOf(ME)?.current ?? 0, finished_at: ago(0) });
  me.goal = '';
  me.goal_set_at = null;
  return { goal_finished: true, certificate_id: id };
}

/** Words in a caption pick the outcome, so each result screen can be seen. */
function moderate(id: string, proven?: boolean) {
  const row = db.posts.find((p) => p.id === id);
  if (!row) return { status: 'checking' };
  if (row.kind === 'story') return { status: (row.status = 'live'), ...judgeProof(row, proven) };
  const caption = String(row.caption).toLowerCase();
  if (caption.includes('off topic')) return { status: (row.status = 'off_topic') };
  if (caption.includes('slow')) return { status: 'checking' };
  if (caption.includes('suspend')) {
    db.status.strikes = 3;
    db.status.suspended = true;
    return { status: (row.status = 'rejected'), strikes: 3, suspended: true };
  }
  if (caption.includes('reject')) {
    db.status.strikes += 1;
    return { status: (row.status = 'rejected'), strikes: db.status.strikes, suspended: false };
  }
  row.status = 'live';
  const streak = streakOf(ME) as Row;
  if (row.kind !== 'story' && streak.last_post_date !== daysAgo(0)) {
    streak.current += 1;
    streak.best = Math.max(streak.best, streak.current);
    streak.last_post_date = daysAgo(0);
  }
  return { status: 'live', ...judgeProof(row, proven) };
}

// ---------------------------------------------------------------- the PostgREST subset the app uses

function matches(row: Row, column: string, condition: string) {
  const [, op, value] = condition.match(/^(\w+)\.(.*)$/s) ?? [];
  const actual = row[column];
  switch (op) {
    case 'eq': return String(actual) === value;
    case 'gt': return String(actual) > value;
    case 'gte': return String(actual) >= value;
    case 'is': return value === 'null' ? actual == null : String(actual) === value;
    case 'in': return value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/"/g, '')).includes(String(actual));
    default: return true;
  }
}

const NOT_FILTERS = ['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'];

function filtered(rows: Row[], params: URLSearchParams) {
  let out = rows;
  params.forEach((condition, column) => {
    if (NOT_FILTERS.includes(column)) return;
    if (column === 'or') {
      const parts = condition.replace(/^\(|\)$/g, '').split(',').map((p) => p.match(/^(\w+)\.(.*)$/s) as RegExpMatchArray);
      out = out.filter((r) => parts.some(([, col, rest]) => matches(r, col, rest)));
    } else {
      out = out.filter((r) => matches(r, column, condition));
    }
  });
  return out;
}

function read(table: string, params: URLSearchParams) {
  const source = VIEWS[table]?.() ?? (db as unknown as Record<string, Row[]>)[table] ?? [];
  let out = filtered(source, params);
  const order = params.get('order');
  if (order) {
    const [column, direction] = order.split('.');
    out = [...out].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (direction === 'desc' ? -1 : 1));
  }
  const limit = params.get('limit');
  return limit ? out.slice(0, Number(limit)) : out;
}

function insert(table: string, body: Row, ignoreDuplicates: boolean) {
  const rows = (db as unknown as Record<string, Row[]>)[table];
  if (!rows) return;
  if (ignoreDuplicates && rows.some((r) => Object.keys(body).every((k) => r[k] === body[k]))) return;
  const row: Row = { id: newId(), created_at: ago(0), ...body };
  if (table === 'posts') {
    row.status = 'checking';
    row.expires_at = row.kind === 'story' ? new Date(Date.now() + 24 * HOUR).toISOString() : null;
  }
  if (table === 'follows') row.status = profile(row.followee_id)?.is_private ? 'pending' : 'accepted';
  if (table === 'messages') row.read_at = null;
  if (table === 'comments') row.parent_id ??= null;
  rows.push(row);
}

// ---------------------------------------------------------------- transport

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function userBody() {
  return { id: ME, aud: 'authenticated', role: 'authenticated', email: 'demo@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: ago(900) };
}

function sessionBody() {
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return {
    access_token: `${part({ alg: 'none' })}.${part({ sub: ME, exp, role: 'authenticated' })}.demo`,
    refresh_token: 'demo', token_type: 'bearer', expires_in: 30 * 24 * 3600, expires_at: exp,
    user: userBody(),
  };
}

let codeIsForReset = false;

function auth(path: string, body: Row) {
  if (path.startsWith('/auth/v1/otp')) {
    codeIsForReset = body.create_user === false;
    return json({});
  }
  if (path.startsWith('/auth/v1/verify')) {
    // A sign-up code: drop the profile so the onboarding screens appear, until complete_signup.
    if (!codeIsForReset) db.profiles = db.profiles.filter((p) => p.id !== ME);
    return json(sessionBody());
  }
  if (path.startsWith('/auth/v1/token')) {
    if (!profile(ME)) db = initialState();
    return json(sessionBody());
  }
  if (path.startsWith('/auth/v1/user')) return json(userBody());
  if (path.startsWith('/auth/v1/logout')) return new Response(null, { status: 204 });
  return json({});
}

function functions(name: string, body: Row) {
  if (name === 'moderate-post') return json(moderate(body.post_id, body.demo_proven));
  if (name === 'login-with-username') {
    if (!profile(ME)) db = initialState();
    return json(sessionBody());
  }
  if (name === 'delete-account') db = initialState();
  return json({});
}

export const demoFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {};
  const path = url.pathname;

  if (path.startsWith('/auth/')) return auth(path, body);
  if (path.startsWith('/functions/v1/')) return functions(path.split('/')[3], body);
  if (path.startsWith('/storage/')) return json([]);

  const rpc = path.match(/^\/rest\/v1\/rpc\/(\w+)/);
  if (rpc) {
    try {
      return json(RPC[rpc[1]]?.(body) ?? null);
    } catch (e) {
      return json({ message: (e as Error).message }, 400);
    }
  }

  const table = path.match(/^\/rest\/v1\/(\w+)/)?.[1] ?? '';
  const tables = db as unknown as Record<string, Row[]>;
  if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-0/${read(table, url.searchParams).length}` } });
  if (method === 'GET') return json(read(table, url.searchParams));

  if (method === 'POST') {
    if (table === 'posts' && body.kind !== 'story') {
      if (db.postsUsed >= POST_LIMIT) return json({ message: 'daily_limit_reached' }, 400);
      db.postsUsed += 1;
    }
    const prefer = new Headers(init?.headers).get('Prefer') ?? '';
    insert(table, body, prefer.includes('ignore-duplicates'));
  } else if (method === 'PATCH') {
    const rows = filtered(tables[table] ?? [], url.searchParams);
    if (table === 'profiles' && 'goal' in body) {
      const me = rows[0];
      if (me?.goal && me.goal !== body.goal && Date.now() - Date.parse(me.goal_set_at) > 24 * HOUR) return json({ message: 'goal_locked' }, 400);
      if (me && !me.goal) body.goal_set_at = ago(0);
    }
    if (table === 'comments') body.edited_at = ago(0);
    rows.forEach((r) => Object.assign(r, body));
  } else if (method === 'DELETE' && tables[table]) {
    const gone = filtered(tables[table], url.searchParams);
    tables[table] = tables[table].filter((r) => !gone.includes(r));
  }
  return new Response(null, { status: 204 });
};

// ---------------------------------------------------------------- media

const VIDEO_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

/** Placeholder files for seeded posts; a post made in the demo shows the file picked on the phone. */
export function demoMediaUrl(path: string) {
  // A photo sent in a demo chat is stored as "<conversation>/<file on this phone>".
  const local = path.indexOf('/file:');
  if (local >= 0) return path.slice(local + 1);
  if (path.includes('://') && !path.includes('.frames/')) return path;
  if (/\.(mp4|mov)$/.test(path)) return VIDEO_URL;
  return `https://picsum.photos/seed/${path.replace(/\W/g, '')}/900/1200`;
}
