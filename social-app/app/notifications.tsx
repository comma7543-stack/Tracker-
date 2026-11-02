import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, View } from 'react-native';
import { Avatar, BackHeader, Empty, Pill, Screen, T } from '../components/ui';
import { acceptFollower, deleteNotification, follow, getNotifications, markNotificationsRead, removeFollower, unfollow } from '../lib/api';
import { timeAgo } from '../lib/format';
import { toast, useUI } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { NotificationCard } from '../lib/types';

const DAY = 864e5;

export default function Notifications() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const open = useUI((s) => s.open);
  const { data = [], isLoading } = useQuery({ queryKey: ['notifications'], queryFn: getNotifications });

  // Rows stay highlighted for this visit; they're marked read for the next one.
  useFocusEffect(useCallback(() => {
    markNotificationsRead().then(() => qc.invalidateQueries({ queryKey: ['unread-notifications'] }));
  }, [qc]));

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const guard = (work: Promise<unknown>) => work.then(refresh).catch(() => toast(t('common.tryAgain')));

  const openRow = (n: NotificationCard) => {
    if (n.type === 'comment' || (n.type === 'mention' && n.comment_id)) {
      if (n.post_id) { router.push(`/post/${n.post_id}`); open({ type: 'comments', postId: n.post_id }); }
    } else if (n.type === 'like' || n.type === 'mention') {
      if (n.post_id) router.push(`/post/${n.post_id}`);
    } else {
      router.push(`/user/${n.actor_id}`);
    }
  };

  const textFor = (n: NotificationCard) => {
    switch (n.type) {
      case 'like': return t('notifications.liked');
      case 'comment': return t('notifications.commented', { text: n.comment_body ?? '' });
      // A mention with no comment came from a post's caption.
      case 'mention': return n.comment_id ? t('notifications.mentioned', { text: n.comment_body ?? '' }) : t('notifications.mentionedInPost');
      case 'follow': return t('notifications.followed');
      case 'follow_request': return t('notifications.requested');
    }
  };

  const age = (n: NotificationCard) => Date.now() - Date.parse(n.created_at);
  const sections = [
    { title: t('notifications.today'), data: data.filter((n) => age(n) < DAY) },
    { title: t('notifications.week'), data: data.filter((n) => age(n) >= DAY && age(n) < 7 * DAY) },
    { title: t('notifications.earlier'), data: data.filter((n) => age(n) >= 7 * DAY) },
  ].filter((s) => s.data.length > 0);

  return (
    <Screen>
      <BackHeader title={t('notifications.title')} />
      <SectionList
        sections={sections}
        keyExtractor={(n) => n.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={isLoading ? undefined : <Empty text={t('notifications.empty')} />}
        renderSectionHeader={({ section }) => <T s={15} w="700" style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>{section.title}</T>}
        renderItem={({ item: n }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: n.read_at ? 'transparent' : c.surface2 }}>
            <Pressable accessibilityRole="button" onPress={() => router.push(`/user/${n.actor_id}`)} accessibilityLabel={n.actor_username}>
              <Avatar name={n.actor_username} url={n.actor_avatar_url} size={44} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => openRow(n)} style={{ flex: 1, minWidth: 0 }}>
              <T s={14} style={{ lineHeight: 20 }} numberOfLines={3}>
                <T s={14} w="600">{n.actor_username}</T> {textFor(n)} <T s={14} c={c.muted}>{timeAgo(n.created_at, t)}</T>
              </T>
            </Pressable>
            {n.type === 'follow' ? (
              n.my_follow_status
                ? <Pill label={n.my_follow_status === 'pending' ? t('profile.requested') : t('profile.followingBtn')} onPress={() => guard(unfollow(n.actor_id))} />
                : <Pill primary label={t('notifications.followBack')} onPress={() => guard(follow(n.actor_id))} />
            ) : null}
            {n.type === 'follow_request' && n.their_follow_status === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pill primary label={t('notifications.accept')} onPress={() => guard(acceptFollower(n.actor_id))} />
                <Pill label={t('notifications.decline')} onPress={() => guard(removeFollower(n.actor_id).then(() => deleteNotification(n.id)))} />
              </View>
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}
