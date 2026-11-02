import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Bell, Check, MessageCircle, Play, Plus, Snowflake } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { MediaThumb } from '../../components/Media';
import { PostCard } from '../../components/PostCard';
import { Avatar, Empty, FAST_SCROLL, IconButton, Screen, T } from '../../components/ui';
import { homeFeed, inbox, scrollsFeed, storyRoll, unreadNotificationCount } from '../../lib/api';
import { APP_NAME } from '../../lib/config';
import { useMyStreak, useNow, useStartCompose } from '../../lib/hooks';
import { myId, toast, useSettings, useUI } from '../../lib/store';
import { effectiveStreak, freezesLeft, isFrozen, localDate, timeLeftToday } from '../../lib/streak';
import { supabase } from '../../lib/supabase';
import { boxGlow, FIRE, flamePalette, textGlow, useTheme } from '../../lib/theme';
import { StreakFlame } from '../../components/StreakFlame';
import type { PostCard as Post, StoryRollRow } from '../../lib/types';

function useLiveBadges() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('badges')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${myId()}` }, () => {
        qc.invalidateQueries({ queryKey: ['unread-notifications'] });
        qc.invalidateQueries({ queryKey: ['notifications'] });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => qc.invalidateQueries({ queryKey: ['inbox'] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

function StreakBand() {
  const c = useTheme();
  const { t, i18n } = useTranslation();
  const open = useUI((s) => s.open);
  const streak = useMyStreak();
  const autoFreeze = useSettings((s) => s.prefs.autoFreeze);
  const now = useNow();
  const today = localDate(now);
  const count = streak ? effectiveStreak(streak, today, autoFreeze) : 0;
  const frozen = !!streak && isFrozen(streak, today, autoFreeze);
  const posted = streak?.last_post_date === today;
  const { hours, minutes } = timeLeftToday(now);
  const date = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' }).format(now);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('streak.title')} onPress={() => open({ type: 'streak' })} style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface, borderWidth: c.cardBorderWidth, borderColor: c.cardBorderColor }}>
      <View style={{ gap: 2, flex: 1 }}>
        <T s={12} c={c.muted}>{date}</T>
        <T s={14} w="600">{posted ? t('home.postedToday') : t('home.leftToPost')}</T>
        {!posted ? <T s={12} c={c.muted}>{t('home.countdown', { hours, minutes })}</T> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StreakFlame count={count} frozen={frozen} size={38} />
        <View style={{ alignItems: 'flex-end' }}>
          <T s={20} w="700" c={count > 0 ? flamePalette(count, frozen).outer : undefined} style={[{ lineHeight: 22 }, count > 0 ? textGlow(c) : null]}>{count}</T>
          <T s={10} c={c.muted} style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>{t('streak.dayStreak')}</T>
          {streak ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
              <Snowflake size={11} color={FIRE.frozen.outer} strokeWidth={2.2} />
              <T s={11} w="600" c={FIRE.frozen.outer}>{t('streak.freezes', { count: freezesLeft(streak, today, autoFreeze) })}</T>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function StoryRoll() {
  const c = useTheme();
  const { t } = useTranslation();
  const { compose } = useStartCompose();
  const { data = [] } = useQuery({ queryKey: ['story-roll'], queryFn: storyRoll });
  const withStories = data.filter((x) => x.has_story);
  const done = data.filter((x) => x.posted_today).length;

  const openRow = (row: StoryRollRow, isMe: boolean) => {
    if (row.has_story) {
      const queue = isMe ? [row.user_id] : withStories.filter((x) => x.user_id !== myId()).map((x) => x.user_id);
      router.push({ pathname: '/story/[userId]', params: { userId: row.user_id, queue: queue.join(',') } });
    } else if (isMe) {
      compose('story');
    } else if (row.posted_today) {
      router.push(`/user/${row.user_id}`);
    } else {
      toast(t('home.notPosted', { name: row.username }));
    }
  };

  return (
    <View style={{ paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 6 }}>
        <T s={12} c={c.muted}>{t('home.doneCount', { done, total: data.length })}</T>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: 16 }}>
        {data.map((row, i) => {
          const isMe = row.user_id === myId();
          const unseen = row.has_story && !row.all_seen;
          const ringColor = c.storyRings[i % c.storyRings.length];
          return (
            <Pressable
              key={row.user_id}
              accessibilityRole="button"
              accessibilityLabel={isMe ? (row.has_story ? t('home.viewYourStory') : t('home.addStory')) : row.posted_today ? t('home.viewProof', { name: row.username }) : t('home.notPosted', { name: row.username })}
              onPress={() => openRow(row, isMe)}
              style={{ width: 82, alignItems: 'center', gap: 6 }}
            >
              <View
                style={[
                  { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center' },
                  unseen ? { borderWidth: 2.5, borderColor: ringColor } : row.has_story ? { borderWidth: 2, borderColor: c.faint } : { borderWidth: 2, borderColor: c.faint, borderStyle: 'dashed' },
                  unseen ? boxGlow(c) : null,
                ]}
              >
                <Avatar name={row.username} url={row.avatar_url} size={70} />
                <View style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: c.bg, backgroundColor: row.posted_today ? c.accent : c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  {isMe && !row.has_story
                    ? <Plus size={15} color={row.posted_today ? c.onAccent : c.fg} strokeWidth={2.6} />
                    : row.posted_today
                      ? <Check size={14} color={c.onAccent} strokeWidth={3} />
                      : <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.muted }} />}
                </View>
              </View>
              <T s={12} c={row.posted_today ? c.fg : c.muted} numberOfLines={1}>{isMe ? t('home.yourProof') : row.username}</T>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ScrollsRow() {
  const c = useTheme();
  const { t } = useTranslation();
  const { data = [] } = useQuery({ queryKey: ['scrolls-row'], queryFn: () => scrollsFeed() });
  if (data.length === 0) return null;
  return (
    <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line, paddingTop: 14, paddingBottom: 18, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 }}>
        <T s={15} w="700" style={textGlow(c)}>{t('tabs.scrolls')}</T>
        <T s={13} c={c.muted}>{t('home.scrollsSub')}</T>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {data.slice(0, 6).map((p) => (
          <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={t('home.openScroll', { name: p.username })} onPress={() => router.navigate('/(tabs)/scrolls')} style={{ width: 128, height: 210, borderRadius: 10, overflow: 'hidden', backgroundColor: c.surface2 }}>
            <MediaThumb post={p} showPlay={false} style={{ flex: 1 }} />
            <View style={{ position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center' }}><Play size={28} color={c.mediaFg} fill={c.mediaFg} /></View>
            <View style={{ padding: 8, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line }}>
              <T s={12} w="600" numberOfLines={1}>{p.caption || t(`subtag.${p.subtag}`)}</T>
              <T s={11} c={c.muted} numberOfLines={1}>{p.username}</T>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default function Home() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { compose } = useStartCompose();
  useLiveBadges();

  const feed = useInfiniteQuery({
    queryKey: ['home-feed'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => homeFeed(pageParam),
    getNextPageParam: (last: Post[]) => (last.length === 20 ? last[last.length - 1].created_at : undefined),
  });
  const posts = feed.data?.pages.flat() ?? [];
  const { data: unreadNotifs = 0 } = useQuery({ queryKey: ['unread-notifications'], queryFn: unreadNotificationCount });
  const { data: threads = [] } = useQuery({ queryKey: ['inbox'], queryFn: inbox });
  const unreadDms = threads.filter((x) => x.unread > 0).length;

  return (
    <Screen>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 8 }}>
        <T s={24} w="700" c={c.brand} style={[{ letterSpacing: -0.2 }, textGlow(c)]}>{APP_NAME}</T>
        <View style={{ flexDirection: 'row' }}>
          <IconButton label={unreadNotifs ? t('home.notificationsNew') : t('notifications.title')} onPress={() => router.push('/notifications')}>
            <Bell size={24} color={c.fg} strokeWidth={1.8} />
            {unreadNotifs > 0 ? <View style={[{ position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }, boxGlow(c)]} /> : null}
          </IconButton>
          <IconButton label={unreadDms ? t('home.messagesUnread', { count: unreadDms }) : t('messages.title')} onPress={() => router.push('/messages')}>
            <MessageCircle size={24} color={c.fg} strokeWidth={1.8} />
            {unreadDms > 0 ? (
              <View style={{ position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, borderWidth: 2, borderColor: c.bg, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                <T s={10} w="700" c={c.onAccent}>{unreadDms}</T>
              </View>
            ) : null}
          </IconButton>
        </View>
      </View>
      <FlatList
        {...FAST_SCROLL}
        data={posts}
        keyExtractor={(p) => p.id}
        refreshing={feed.isRefetching}
        onRefresh={() => qc.invalidateQueries()}
        onEndReachedThreshold={0.5}
        onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage(); }}
        ListHeaderComponent={<><StreakBand /><StoryRoll /></>}
        ListEmptyComponent={feed.isLoading ? undefined : (
          <>
            <Empty text={t('home.emptyFeed')}>
              <Pressable accessibilityRole="button" onPress={() => compose('post')} style={{ height: 44, paddingHorizontal: 20, borderRadius: 999, backgroundColor: c.accent, justifyContent: 'center' }}>
                <T s={15} w="600" c={c.onAccent}>{t('streak.postToday')}</T>
              </Pressable>
            </Empty>
            <ScrollsRow />
          </>
        )}
        renderItem={({ item, index }) => (
          <>
            <PostCard post={item} />
            {index === Math.min(2, posts.length - 1) ? <ScrollsRow /> : null}
          </>
        )}
      />
    </Screen>
  );
}
