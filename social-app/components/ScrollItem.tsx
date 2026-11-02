import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Flag, Heart, MessageCircle, Send, Volume2, VolumeX } from 'lucide-react-native';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { follow, followStatus, unfollow } from '../lib/api';
import { myId, toast, useUI } from '../lib/store';
import { DARK, textGlow, useTheme } from '../lib/theme';
import type { PostCard } from '../lib/types';
import { VideoPlayerView } from './Media';
import { useLike } from './PostCard';
import { Avatar, IconButton, T } from './ui';

function RailButton({ label, children, count, onPress, selected }: { label: string; children: ReactNode; count?: number; onPress: () => void; selected?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected }} onPress={onPress} style={{ width: 52, minHeight: 52, alignItems: 'center', gap: 4 }}>
      {children}
      {count !== undefined ? <T s={12} w="600" c={DARK.fg}>{count}</T> : null}
    </Pressable>
  );
}

export function ScrollItem({ post, height, active, muted, autoplay, onToggleMute }: {
  post: PostCard; height: number; active: boolean; muted: boolean; autoplay: boolean; onToggleMute: () => void;
}) {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const open = useUI((s) => s.open);
  const { liked, count, toggle } = useLike(post);
  const isMine = post.author_id === myId();
  const { data: relation } = useQuery({ queryKey: ['follow', post.author_id], enabled: !isMine, queryFn: () => followStatus(post.author_id) });

  const toggleFollow = async () => {
    try {
      if (relation) await unfollow(post.author_id);
      else await follow(post.author_id);
      qc.invalidateQueries({ queryKey: ['follow', post.author_id] });
      toast(relation ? t('profile.unfollowed', { name: post.username }) : t('profile.nowFollowing', { name: post.username }));
    } catch {
      toast(t('common.tryAgain'));
    }
  };

  return (
    <View style={{ height, backgroundColor: DARK.bg, overflow: 'hidden' }}>
      <VideoPlayerView path={post.media_path} active={active} muted={muted} autoplay={autoplay} style={StyleSheet.absoluteFill} />

      <View pointerEvents="box-none" style={{ position: 'absolute', top: 6, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4 }}>
        <T s={20} w="700" c={DARK.fg} style={textGlow(c)}>{t('tabs.scrolls')}</T>
        <IconButton label={muted ? t('scrolls.unmute') : t('scrolls.mute')} onPress={onToggleMute}>
          {muted ? <VolumeX size={24} color={DARK.fg} strokeWidth={1.8} /> : <Volume2 size={24} color={DARK.fg} strokeWidth={1.8} />}
        </IconButton>
      </View>

      <View style={{ position: 'absolute', right: 6, bottom: 110, gap: 18, alignItems: 'center' }}>
        <RailButton label={liked ? t('post.unlike') : t('post.like')} selected={liked} count={count} onPress={toggle}>
          <Heart size={30} color={DARK.fg} fill={liked ? DARK.fg : 'none'} strokeWidth={liked ? 2.6 : 1.9} />
        </RailButton>
        <RailButton label={t('comments.title')} count={post.comment_count} onPress={() => open({ type: 'comments', postId: post.id })}>
          <MessageCircle size={30} color={DARK.fg} strokeWidth={1.9} />
        </RailButton>
        <RailButton label={t('share.title')} onPress={() => open({ type: 'share', postId: post.id, ownerId: post.author_id })}>
          <Send size={28} color={DARK.fg} strokeWidth={1.9} />
        </RailButton>
        {!isMine ? (
          <RailButton label={t('report.title')} onPress={() => open({ type: 'report', target: { type: 'post', id: post.id } })}>
            <Flag size={26} color={DARK.fg} strokeWidth={1.9} />
          </RailButton>
        ) : null}
      </View>

      <View style={{ position: 'absolute', left: 14, right: 70, bottom: 20, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={post.username} onPress={() => router.push(`/user/${post.author_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
            <Avatar name={post.username} url={post.avatar_url} size={32} bg={DARK.avatar} fg={DARK.fg} />
            <T s={14} w="600" c={DARK.fg} numberOfLines={1} style={{ flexShrink: 1 }}>{post.username}</T>
          </Pressable>
          {!isMine ? (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: !!relation }} onPress={toggleFollow} style={{ minHeight: 30, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: DARK.fg, backgroundColor: relation ? DARK.fg : 'transparent' }}>
              <T s={13} w="600" c={relation ? DARK.bg : DARK.fg}>{relation === 'accepted' ? t('profile.followingBtn') : relation === 'pending' ? t('profile.requested') : t('profile.follow')}</T>
            </Pressable>
          ) : null}
        </View>
        {post.caption ? <T s={14} c={DARK.fg} style={{ lineHeight: 20 }}>{post.caption}</T> : null}
        <View style={{ alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: DARK.chip }}>
          <T s={12} w="600" c={DARK.fg}>{t(`subtag.${post.subtag}`)}</T>
        </View>
      </View>
    </View>
  );
}
