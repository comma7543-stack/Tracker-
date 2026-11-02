import { router } from 'expo-router';
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, View } from 'react-native';
import { deletePostRow, setLiked, setSaved } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useRefreshAll } from '../lib/hooks';
import { deleteMedia } from '../lib/media';
import { myId, toast, useUI } from '../lib/store';
import { effectiveStreak, isFrozen, localDate } from '../lib/streak';
import { boxGlow, flamePalette, useTheme } from '../lib/theme';
import { StreakFlame } from './StreakFlame';
import type { PostCard as Post } from '../lib/types';
import { MediaThumb, VideoPlayerView } from './Media';
import { Avatar, Card, IconButton, T } from './ui';

/** Liked state and count, updated right away and rolled back if the save fails. */
export function useLike(post: Post) {
  const [liked, setLocal] = useState(post.liked_by_me);
  const [count, setCount] = useState(post.like_count);
  const { t } = useTranslation();
  const toggle = () => {
    const next = !liked;
    setLocal(next);
    setCount((c) => c + (next ? 1 : -1));
    setLiked(post.id, next).catch(() => {
      setLocal(!next);
      setCount((c) => c + (next ? -1 : 1));
      toast(t('common.tryAgain'));
    });
  };
  return { liked, count, toggle };
}

export function PostCard({ post, playVideo = false }: { post: Post; playVideo?: boolean }) {
  const c = useTheme();
  const { t } = useTranslation();
  const open = useUI((s) => s.open);
  const refresh = useRefreshAll();
  const { liked, count, toggle } = useLike(post);
  const [saved, setSavedLocal] = useState(post.saved_by_me);
  // The author's auto-freeze setting is private, so assume the default: on.
  const streakData = { current: post.streak_current ?? 0, last_post_date: post.streak_last_post_date, excused_dates: post.streak_excused_dates, freezes_available: post.streak_freezes ?? 0 };
  const streak = post.streak_current === null ? 0 : effectiveStreak(streakData, localDate(), true);
  const frozen = isFrozen(streakData, localDate(), true);

  const toggleSave = () => {
    const next = !saved;
    setSavedLocal(next);
    toast(next ? t('post.saved') : t('post.unsaved'));
    setSaved(post.id, next).catch(() => { setSavedLocal(!next); toast(t('common.tryAgain')); });
  };

  const more = () => {
    if (post.author_id === myId()) {
      Alert.alert(t('post.deleteTitle'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePostRow(post.id);
              await deleteMedia(post.media_path);
              refresh();
            } catch {
              toast(t('common.tryAgain'));
            }
          },
        },
      ]);
    } else {
      open({ type: 'report', target: { type: 'post', id: post.id } });
    }
  };

  return (
    <Card style={{ marginHorizontal: 12, marginBottom: 14, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 4, paddingVertical: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={post.username} onPress={() => router.push(`/user/${post.author_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <Avatar name={post.username} url={post.avatar_url} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T s={14} w="600" numberOfLines={1}>{post.username}</T>
            <T s={12} c={c.muted} numberOfLines={1}>{t(`topic.${post.topic}`)} · {timeAgo(post.created_at, t)}</T>
          </View>
        </Pressable>
        {streak > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: flamePalette(streak, frozen).outer }}>
            <StreakFlame count={streak} frozen={frozen} size={15} />
            <T s={12} w="600" c={flamePalette(streak, frozen).outer}>{t('post.streak', { count: streak })}</T>
          </View>
        ) : null}
        <IconButton label={post.author_id === myId() ? t('post.deleteTitle') : t('report.title')} onPress={more}><MoreHorizontal size={20} color={c.fg} strokeWidth={1.8} /></IconButton>
      </View>

      {post.media_type === 'video' && playVideo ? (
        <VideoPlayerView path={post.media_path} style={{ marginHorizontal: 12, borderRadius: 12, aspectRatio: 4 / 3, overflow: 'hidden', backgroundColor: c.media }} />
      ) : (
        <Pressable accessibilityRole="imagebutton" accessibilityLabel={post.caption || t('post.open')} onPress={() => router.push(`/post/${post.id}`)}>
          <MediaThumb post={post} style={{ marginHorizontal: 12, borderRadius: 12, aspectRatio: 4 / 3 }} />
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={liked ? t('post.unlike') : t('post.like')}
          accessibilityState={{ selected: liked }}
          onPress={toggle}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 8 }, liked ? boxGlow(c) : null]}
        >
          <Heart size={22} color={c.fg} fill={liked ? c.fg : 'none'} strokeWidth={liked ? 2.6 : 1.8} />
          <T s={13} w="600">{count}</T>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('comments.title')} onPress={() => open({ type: 'comments', postId: post.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 8 }}>
          <MessageCircle size={22} color={c.fg} strokeWidth={1.8} />
          <T s={13} w="600">{post.comment_count}</T>
        </Pressable>
        <IconButton label={t('share.title')} onPress={() => open({ type: 'share', postId: post.id, ownerId: post.author_id })}><Send size={22} color={c.fg} strokeWidth={1.8} /></IconButton>
        <View style={{ flex: 1 }} />
        <IconButton label={saved ? t('post.removeSaved') : t('post.save')} onPress={toggleSave}><Bookmark size={22} color={c.fg} fill={saved ? c.fg : 'none'} strokeWidth={1.8} /></IconButton>
      </View>

      {post.caption ? <T s={15} style={{ marginHorizontal: 16, lineHeight: 21 }}>{post.caption}</T> : null}
    </Card>
  );
}
