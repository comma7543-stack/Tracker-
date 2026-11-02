// Every call to Supabase. Column lists are explicit on purpose: profiles and posts
// have column-level grants, so select('*') on them is a permission error.
import * as Crypto from 'expo-crypto';
import { TERMS_VERSION } from './config';
import { myId } from './store';
import { supabase } from './supabase';
import type { PersonRow,
  AccountStatus, CommentCard, GoalCertificate, InboxRow, MediaType, Message, ModerationOutcome, NotificationCard, PostCard, PostingLimits, PostKind, Profile, ReportTarget, Streak, StoryRollRow,
} from './types';
import { topicOf } from './topics';

const PROFILE_COLS = 'id, username, full_name, bio, avatar_url, is_private, created_at';

type Res<T> = { data: T | null; error: { message: string } | null };
const must = <T>(res: Res<T>): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
};

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------------------------------------------------------------- profiles

export const getMyProfile = async () =>
  must(await supabase.from('profiles').select(PROFILE_COLS).eq('id', myId()).maybeSingle()) as Profile | null;

export const getProfile = async (id: string) =>
  must(await supabase.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle()) as Profile | null;

export const completeSignup = async (fullName: string, username: string, dob: string, goal: string) =>
  must(await supabase.rpc('complete_signup', {
    p_full_name: fullName, p_username: username, p_dob: dob, p_terms_version: TERMS_VERSION, p_timezone: timezone(), p_goal: goal,
  }));

export const usernameAvailable = async (username: string) =>
  must(await supabase.rpc('username_available', { p_username: username })) as boolean;

export const updateProfile = async (patch: Partial<Pick<Profile, 'full_name' | 'username' | 'bio' | 'avatar_url'>> & { goal?: string }) =>
  must(await supabase.from('profiles').update(patch).eq('id', myId()));

/** Null when there's no goal, or the viewer isn't allowed to see it. */
export const profileGoal = async (id: string) =>
  must(await supabase.rpc('profile_goal', { p_user: id })) as string | null;

export const goalStatus = async () => {
  const rows = must(await supabase.rpc('goal_status')) as { goal: string; set_at: string | null }[];
  return rows[0] ?? null;
};

const CERTIFICATE_COLS = 'id, user_id, goal, post_id, streak, finished_at';

export const certificatesOf = async (userId: string) =>
  must(await supabase.from('goal_certificates').select(CERTIFICATE_COLS).eq('user_id', userId).order('finished_at', { ascending: false })) as GoalCertificate[];

export const getCertificate = async (id: string) =>
  must(await supabase.from('goal_certificates').select(CERTIFICATE_COLS).eq('id', id).maybeSingle()) as GoalCertificate | null;

export const profilePeople = async (id: string, list: 'supporters' | 'supporting') =>
  must(await supabase.rpc('profile_people', { p_user: id, p_list: list })) as PersonRow[];

export const profileStats = async (id: string) => {
  const rows = must(await supabase.rpc('profile_stats', { p_user: id })) as { followers: number; following: number; posts: number; lists_visible: boolean }[];
  return rows[0] ?? { followers: 0, following: 0, posts: 0, lists_visible: false };
};

export const getStreak = async (id: string) =>
  must(await supabase.from('streaks').select('user_id, current, best, last_post_date, freezes_available, excused_dates').eq('user_id', id).maybeSingle()) as Streak | null;

export const spendReasonDay = async (day: string, reason: string) =>
  must(await supabase.rpc('use_reason_day', { p_day: day, p_reason: reason }));

export const reasonDaysLeft = async () => must(await supabase.rpc('reason_days_left')) as number;

export const syncTimezone = () => supabase.rpc('set_timezone', { p_timezone: timezone() });

export const accountStatus = async () => {
  const rows = must(await supabase.rpc('account_status')) as AccountStatus[];
  return rows[0];
};

// ---------------------------------------------------------------- settings

export const getSettings = async () =>
  must(await supabase.from('settings').select('prefs, choices').eq('user_id', myId()).maybeSingle()) as { prefs: Record<string, boolean>; choices: Record<string, string> } | null;

export const savePref = async (key: string, value: boolean) =>
  must(await supabase.rpc('set_pref', { p_key: key, p_value: value }));

export const saveChoice = async (key: string, value: string) =>
  must(await supabase.rpc('set_choice', { p_key: key, p_value: value }));

// ---------------------------------------------------------------- feeds

export const homeFeed = async (before?: string) =>
  must(await supabase.rpc('home_feed', { p_before: before ?? null, p_limit: 20 })) as PostCard[];

export const scrollsFeed = async (before?: string) =>
  must(await supabase.rpc('scrolls_feed', { p_before: before ?? null, p_limit: 10 })) as PostCard[];

export const explore = async (q: string, topic: string | null) =>
  must(await supabase.rpc('explore', { p_q: q, p_topic: topic, p_limit: 40 })) as PostCard[];

export const searchUsers = async (q: string) =>
  must(await supabase.rpc('search_users', { p_q: q, p_limit: 10 })) as Pick<Profile, 'id' | 'username' | 'full_name' | 'avatar_url'>[];

export const storyRoll = async () => must(await supabase.rpc('story_roll')) as StoryRollRow[];

export const getPost = async (id: string) =>
  must(await supabase.from('post_cards').select('*').eq('id', id).maybeSingle()) as PostCard | null;

export const userPosts = async (id: string, kind: PostKind) => {
  let q = supabase.from('post_cards').select('*').eq('author_id', id).eq('status', 'live');
  q = kind === 'scroll' ? q.or('kind.eq.scroll,also_scroll.eq.true') : q.eq('kind', kind);
  return must(await q.order('created_at', { ascending: false }).limit(60)) as PostCard[];
};

export const savedPosts = async () =>
  must(await supabase.from('post_cards').select('*').eq('saved_by_me', true).order('created_at', { ascending: false }).limit(60)) as PostCard[];

export const activeStories = async (userId: string) =>
  must(await supabase.from('post_cards').select('*').eq('author_id', userId).eq('kind', 'story').eq('status', 'live')
    .gt('expires_at', new Date().toISOString()).order('created_at')) as PostCard[];

export const markStorySeen = (storyId: string) =>
  supabase.from('story_views').upsert({ story_id: storyId, viewer_id: myId() }, { ignoreDuplicates: true });

/** Local dates (YYYY-MM-DD) in this range on which I had a live post. */
export const postedDates = async (fromIso: string) => {
  const rows = must(await supabase.from('posts').select('created_at').eq('author_id', myId()).eq('status', 'live').neq('kind', 'story').gte('created_at', fromIso)) as { created_at: string }[];
  return rows.map((r) => r.created_at);
};

// ---------------------------------------------------------------- post actions

export const setLiked = async (postId: string, on: boolean) => {
  if (on) must(await supabase.from('likes').upsert({ user_id: myId(), post_id: postId }, { ignoreDuplicates: true }));
  else must(await supabase.from('likes').delete().eq('user_id', myId()).eq('post_id', postId));
};

export const setSaved = async (postId: string, on: boolean) => {
  if (on) must(await supabase.from('saves').upsert({ user_id: myId(), post_id: postId }, { ignoreDuplicates: true }));
  else must(await supabase.from('saves').delete().eq('user_id', myId()).eq('post_id', postId));
};

export const report = async (target: ReportTarget, reason: string) =>
  must(await supabase.from('reports').insert({ reporter_id: myId(), target_type: target.type, target_id: target.id, reason }));

// ---------------------------------------------------------------- posting and moderation

export const createPost = async (p: {
  kind: PostKind; mediaPath: string; mediaType: MediaType; caption: string; subtag: string; alsoScroll: boolean; goalProof?: boolean;
}) => {
  const id = Crypto.randomUUID();
  must(await supabase.from('posts').insert({
    id, author_id: myId(), kind: p.kind, media_path: p.mediaPath, media_type: p.mediaType, caption: p.caption,
    subtag: p.subtag, topic: topicOf(p.subtag), also_scroll: p.alsoScroll, goal_proof: !!p.goalProof,
  }));
  return id;
};

/** How much of today's limits I've used. The database enforces them; this is for the screen. */
export const postingLimits = async () => {
  const rows = must(await supabase.rpc('posting_limits')) as PostingLimits[];
  return rows[0];
};

/** Fail closed: anything but a clear answer reads as still checking; the post stays hidden. */
export async function runModeration(postId: string, demoProven?: boolean): Promise<ModerationOutcome> {
  const { data, error } = await supabase.functions.invoke('moderate-post', { body: { post_id: postId, demo_proven: demoProven } });
  if (error || !data?.status) return { status: 'checking' };
  return data as ModerationOutcome;
}

export const requestReview = async (postId: string) => must(await supabase.rpc('request_review', { p_post: postId }));

export const deletePostRow = async (postId: string) => must(await supabase.from('posts').delete().eq('id', postId));

// ---------------------------------------------------------------- comments

export const getComments = async (postId: string) =>
  must(await supabase.from('comment_cards').select('*').eq('post_id', postId).order('created_at')) as CommentCard[];

export const addComment = async (postId: string, body: string, parentId: string | null) =>
  must(await supabase.from('comments').insert({ post_id: postId, author_id: myId(), body, parent_id: parentId }));

export const editComment = async (id: string, body: string) => must(await supabase.from('comments').update({ body }).eq('id', id));

export const deleteComment = async (id: string) => must(await supabase.from('comments').delete().eq('id', id));

export const setCommentLiked = async (id: string, on: boolean) => {
  if (on) must(await supabase.from('comment_likes').upsert({ user_id: myId(), comment_id: id }, { ignoreDuplicates: true }));
  else must(await supabase.from('comment_likes').delete().eq('user_id', myId()).eq('comment_id', id));
};

// ---------------------------------------------------------------- follows and blocks

export const followStatus = async (id: string) => {
  const row = must(await supabase.from('follows').select('status').eq('follower_id', myId()).eq('followee_id', id).maybeSingle()) as { status: 'pending' | 'accepted' } | null;
  return row?.status ?? null;
};

export const follow = async (id: string) => must(await supabase.from('follows').insert({ follower_id: myId(), followee_id: id }));
export const unfollow = async (id: string) => must(await supabase.from('follows').delete().eq('follower_id', myId()).eq('followee_id', id));
export const acceptFollower = async (id: string) => must(await supabase.from('follows').update({ status: 'accepted' }).eq('follower_id', id).eq('followee_id', myId()));
export const removeFollower = async (id: string) => must(await supabase.from('follows').delete().eq('follower_id', id).eq('followee_id', myId()));

export const followingList = async () => {
  const rows = must(await supabase.from('follows').select('followee_id').eq('follower_id', myId()).eq('status', 'accepted').limit(20)) as { followee_id: string }[];
  if (rows.length === 0) return [];
  return must(await supabase.from('profiles').select(PROFILE_COLS).in('id', rows.map((r) => r.followee_id))) as Profile[];
};

export const block = async (id: string) => must(await supabase.from('blocks').insert({ blocker_id: myId(), blocked_id: id }));
export const unblock = async (id: string) => must(await supabase.from('blocks').delete().eq('blocker_id', myId()).eq('blocked_id', id));
export const blockedList = async () =>
  must(await supabase.rpc('blocked_accounts')) as Pick<Profile, 'id' | 'username' | 'avatar_url'>[];

// ---------------------------------------------------------------- notifications

export const getNotifications = async () =>
  must(await supabase.from('notification_cards').select('*').order('created_at', { ascending: false }).limit(100)) as NotificationCard[];

export const unreadNotificationCount = async () => {
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return count ?? 0;
};

export const markNotificationsRead = () =>
  supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', myId()).is('read_at', null);

export const deleteNotification = (id: string) => supabase.from('notifications').delete().eq('id', id);

// ---------------------------------------------------------------- messages

export const inbox = async () => must(await supabase.rpc('inbox')) as InboxRow[];

export const startConversation = async (other: string) =>
  must(await supabase.rpc('start_conversation', { p_other: other })) as string;

export const getMessages = async (conversationId: string) =>
  must(await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at').limit(500)) as Message[];

export const sendMessage = async (conversationId: string, body: string, photoPath?: string) =>
  must(await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: myId(), body, ...(photoPath ? { photo_path: photoPath } : {}) }));

export const canSendPhotos = async (conversationId: string) =>
  must(await supabase.rpc('can_send_photos', { p_conversation: conversationId })) as boolean;

export const reportPhoto = async (messageId: string) => must(await supabase.rpc('report_photo', { p_message: messageId }));

export const markRead = (conversationId: string) => supabase.rpc('mark_conversation_read', { p_conversation: conversationId });

export const conversationOther = async (conversationId: string) => {
  const rows = must(await supabase.from('conversation_members').select('user_id').eq('conversation_id', conversationId)) as { user_id: string }[];
  return rows.find((r) => r.user_id !== myId())?.user_id ?? null;
};

// ---------------------------------------------------------------- account

export const logInWithUsername = async (username: string, password: string) => {
  const { data, error } = await supabase.functions.invoke('login-with-username', { body: { username, password } });
  if (error || !data?.access_token) throw new Error('invalid_login');
  must(await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token }));
};

export const requestResetForUsername = (username: string) =>
  supabase.functions.invoke('request-reset', { body: { username } });

export const deleteAccount = async () => {
  const { error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) throw new Error(error.message);
  await supabase.auth.signOut({ scope: 'local' });
};
