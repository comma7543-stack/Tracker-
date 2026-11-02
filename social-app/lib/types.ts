export type PostKind = 'post' | 'story' | 'scroll';
export type MediaType = 'photo' | 'video';
export type PostStatus = 'checking' | 'live' | 'off_topic' | 'rejected' | 'under_review' | 'removed';

export type Profile = {
  id: string; username: string; full_name: string; bio: string; avatar_url: string | null; is_private: boolean; created_at: string;
};

export type GoalCertificate = { id: string; user_id: string; goal: string; post_id: string | null; streak: number; finished_at: string };

export type PersonRow = {
  id: string; username: string; full_name: string; avatar_url: string | null; my_status: 'pending' | 'accepted' | null;
};

export type PostCard = {
  id: string; author_id: string; kind: PostKind; media_path: string; media_type: MediaType; caption: string;
  topic: string; subtag: string; status: PostStatus; also_scroll: boolean; created_at: string; expires_at: string | null;
  username: string; full_name: string; avatar_url: string | null;
  streak_current: number | null; streak_last_post_date: string | null; streak_excused_dates: string[] | null; streak_freezes: number | null;
  like_count: number; comment_count: number; liked_by_me: boolean; saved_by_me: boolean;
};

export type CommentCard = {
  id: string; post_id: string; author_id: string; parent_id: string | null; body: string; created_at: string; edited_at: string | null;
  username: string; avatar_url: string | null; like_count: number; liked_by_me: boolean;
};

export type NotificationCard = {
  id: string; type: 'like' | 'comment' | 'follow' | 'follow_request' | 'mention'; post_id: string | null;
  comment_id: string | null; read_at: string | null; created_at: string; actor_id: string;
  actor_username: string; actor_avatar_url: string | null; comment_body: string | null;
  my_follow_status: 'pending' | 'accepted' | null; their_follow_status: 'pending' | 'accepted' | null;
};

export type InboxRow = {
  conversation_id: string; other_id: string; other_username: string; other_avatar_url: string | null;
  last_body: string; last_sender_id: string; last_at: string; unread: number;
};

export type Message = {
  id: string; conversation_id: string; sender_id: string; body: string; created_at: string; read_at: string | null;
  photo_path: string | null; photo_removed_at: string | null;
};

export type StoryRollRow = {
  user_id: string; username: string; avatar_url: string | null; posted_today: boolean; has_story: boolean; all_seen: boolean;
};

export type Streak = { user_id: string; current: number; best: number; last_post_date: string | null; freezes_available: number; excused_dates: string[] };

export type AccountStatus = { strikes: number; suspended: boolean; reviews_requested: number };

export type ReportTarget = { type: 'user' | 'post' | 'comment' | 'message' | 'problem'; id: string | null };

export type PostingLimits = { posts_used: number; posts_limit: number };

export type ModerationOutcome = { status: PostStatus; strikes?: number | null; suspended?: boolean; goal_finished?: boolean; certificate_id?: string | null; goal_reason?: string | null };
