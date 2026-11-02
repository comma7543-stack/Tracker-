import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Award, Lock, Menu, MoreHorizontal, Snowflake, Target } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Share, View } from 'react-native';
import { block, certificatesOf, follow, followStatus, getProfile, getStreak, profileGoal, profileStats, savedPosts, startConversation, unfollow, userPosts } from '../lib/api';
import { useStartCompose } from '../lib/hooks';
import { myId, toast, useSettings, useUI } from '../lib/store';
import { effectiveStreak, freezesLeft, isFrozen, localDate } from '../lib/streak';
import { CERTIFICATE, FIRE, flamePalette, textGlow, useTheme } from '../lib/theme';
import { MediaThumb } from './Media';
import { StreakFlame } from './StreakFlame';
import { Avatar, BackHeader, Button, Card, Empty, FAST_SCROLL, IconButton, Pill, Screen, T } from './ui';

type Tab = 'posts' | 'scrolls' | 'saved';

export function ProfileView({ userId }: { userId: string }) {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const open = useUI((s) => s.open);
  const { compose } = useStartCompose();
  const autoFreeze = useSettings((s) => s.prefs.autoFreeze);
  const isMe = userId === myId();
  const [tab, setTab] = useState<Tab>('posts');

  const { data: profile, isLoading } = useQuery({ queryKey: ['profile', userId], queryFn: () => getProfile(userId) });
  const { data: stats } = useQuery({ queryKey: ['stats', userId], queryFn: () => profileStats(userId) });
  const { data: streak } = useQuery({ queryKey: ['streak', userId], queryFn: () => getStreak(userId) });
  const { data: goal } = useQuery({ queryKey: ['goal', userId], queryFn: () => profileGoal(userId) });
  const { data: certificates = [] } = useQuery({ queryKey: ['certificates', userId], queryFn: () => certificatesOf(userId) });
  const { data: relation } = useQuery({ queryKey: ['follow', userId], enabled: !isMe, queryFn: () => followStatus(userId) });
  const { data: items = [] } = useQuery({
    queryKey: ['grid', userId, tab],
    queryFn: () => (tab === 'saved' ? savedPosts() : userPosts(userId, tab === 'posts' ? 'post' : 'scroll')),
  });

  const locked = !isMe && !!profile?.is_private && relation !== 'accepted';
  // Other people's auto-freeze setting is private, so assume the default: on.
  const freezeOn = isMe ? autoFreeze : true;
  const today = localDate();
  const count = streak ? effectiveStreak(streak, today, freezeOn) : 0;
  const frozen = !!streak && isFrozen(streak, today, freezeOn);

  const refreshRelation = () => {
    qc.invalidateQueries({ queryKey: ['follow', userId] });
    qc.invalidateQueries({ queryKey: ['stats', userId] });
    qc.invalidateQueries({ queryKey: ['grid', userId] });
    qc.invalidateQueries({ queryKey: ['streak', userId] });
    qc.invalidateQueries({ queryKey: ['goal', userId] });
    qc.invalidateQueries({ queryKey: ['certificates', userId] });
  };

  const toggleFollow = async () => {
    try {
      if (relation) await unfollow(userId);
      else await follow(userId);
      refreshRelation();
    } catch {
      toast(t('common.tryAgain'));
    }
  };

  const message = async () => {
    try {
      router.push(`/messages/${await startConversation(userId)}`);
    } catch {
      toast(t('messages.notAllowed'));
    }
  };

  const more = () => {
    Alert.alert(profile?.username ?? '', undefined, [
      { text: t('report.title'), onPress: () => open({ type: 'report', target: { type: 'user', id: userId } }) },
      {
        text: t('profile.block'),
        style: 'destructive',
        onPress: () => Alert.alert(t('profile.blockTitle', { name: profile?.username }), t('profile.blockBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('profile.block'),
            style: 'destructive',
            onPress: async () => {
              try {
                await block(userId);
                await qc.invalidateQueries();
                toast(t('profile.blocked'));
                router.back();
              } catch {
                toast(t('common.tryAgain'));
              }
            },
          },
        ]),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  if (!isLoading && !profile) {
    return (
      <Screen>
        <BackHeader />
        <Empty text={t('profile.unavailable')} />
      </Screen>
    );
  }

  const tabs: [Tab, string][] = isMe
    ? [['posts', t('profile.posts')], ['scrolls', t('profile.scrolls')], ['saved', t('profile.saved')]]
    : [['posts', t('profile.posts')], ['scrolls', t('profile.scrolls')]];

  const emptyText = tab === 'posts' ? t('profile.noPosts') : tab === 'scrolls' ? t('profile.noScrolls') : t('profile.noSaved');

  return (
    <Screen>
      {isMe ? (
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            {profile?.is_private ? <Lock size={16} color={c.fg} strokeWidth={2} accessibilityLabel={t('profile.private')} /> : null}
            <T s={20} w="700" numberOfLines={1} style={textGlow(c)}>{profile?.username}</T>
          </View>
          <IconButton label={t('settings.title')} onPress={() => router.push('/settings/main')}><Menu size={24} color={c.fg} strokeWidth={1.8} /></IconButton>
        </View>
      ) : (
        <BackHeader right={<IconButton label={t('common.more')} onPress={more}><MoreHorizontal size={24} color={c.fg} strokeWidth={1.8} /></IconButton>} />
      )}

      <ScrollView {...FAST_SCROLL} contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          <Avatar name={profile?.username} url={profile?.avatar_url} size={90} />
          <View style={{ alignItems: 'center', gap: 2 }}>
            <T s={20} w="700">{profile?.full_name}</T>
            <T s={14} c={c.muted}>@{profile?.username}</T>
          </View>
          {profile?.bio ? <T s={14} style={{ maxWidth: 300, lineHeight: 20, textAlign: 'center' }}>{profile.bio}</T> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
          {([[stats?.posts, t('profile.proofs'), null], [stats?.followers, t('profile.followers'), 'supporters'], [stats?.following, t('profile.following'), 'supporting']] as const).map(([n, label, list]) => (
            <Pressable key={label} accessibilityRole={list ? 'button' : undefined} disabled={!list} onPress={() => router.push(`/people/${userId}?list=${list}`)} style={{ flex: 1, borderWidth: 1, borderColor: c.line, borderRadius: 14, paddingVertical: 10, alignItems: 'center' }}>
              <T s={18} w="700">{n ?? 0}</T>
              <T s={12} c={c.muted}>{label}</T>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 16 }}>
          {isMe ? (
            <>
              <Button kind="secondary" label={t('profile.edit')} onPress={() => router.push('/edit-profile')} style={{ flex: 1 }} />
              <Button kind="secondary" label={t('profile.share')} onPress={() => Share.share({ message: `appname://user/${userId}` })} style={{ paddingHorizontal: 18 }} />
            </>
          ) : (
            <>
              <Button
                kind={relation ? 'secondary' : 'primary'}
                label={relation === 'accepted' ? t('profile.followingBtn') : relation === 'pending' ? t('profile.requested') : t('profile.follow')}
                onPress={toggleFollow}
                style={{ flex: 1 }}
              />
              <Button kind="secondary" label={t('profile.message')} onPress={message} style={{ flex: 1 }} />
            </>
          )}
        </View>

        {goal && !locked ? (
          <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Target size={28} color={c.fg} strokeWidth={1.6} />
            <View style={{ flex: 1, gap: 2 }}>
              <T s={12} c={c.muted}>{t('profile.goal')}</T>
              <T s={15} w="600">{goal}</T>
            </View>
            {isMe ? <Pill primary label={t('profile.proveGoal')} onPress={() => compose('scroll', true)} /> : null}
          </Card>
        ) : null}

        {isMe && !goal ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/edit-profile')}>
            <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Target size={28} color={c.muted} strokeWidth={1.6} />
              <T s={15} w="600" style={{ flex: 1 }}>{t('profile.setGoal')}</T>
            </Card>
          </Pressable>
        ) : null}

        {!locked ? certificates.map((x) => (
          <Pressable key={x.id} accessibilityRole="button" onPress={() => router.push(`/certificate/${x.id}`)}>
            <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Award size={28} color={CERTIFICATE.gold} strokeWidth={1.6} />
              <View style={{ flex: 1, gap: 2 }}>
                <T s={12} c={c.muted}>{t('certificate.achieved')}</T>
                <T s={15} w="600">{x.goal}</T>
              </View>
            </Card>
          </Pressable>
        )) : null}

        {streak && !locked ? (
          <Pressable accessibilityRole="button" disabled={!isMe} onPress={() => open({ type: 'streak' })}>
            <Card style={{ marginHorizontal: 16, marginBottom: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <StreakFlame count={count} frozen={frozen} size={44} />
              <View style={{ flex: 1 }}>
                <T s={24} w="800" c={count > 0 ? flamePalette(count, frozen).outer : undefined} style={count > 0 ? textGlow(c) : null}>{count}</T>
                <T s={13} c={c.muted}>{t('streak.dayStreak')}</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <Snowflake size={13} color={FIRE.frozen.outer} strokeWidth={2.2} />
                  <T s={12} w="600" c={FIRE.frozen.outer}>{t('streak.freezes', { count: freezesLeft(streak, today, freezeOn) })}</T>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T s={11} w="600" c={c.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('streak.best')}</T>
                <T s={18} w="700">{streak.best}</T>
              </View>
            </Card>
          </Pressable>
        ) : null}

        {locked ? (
          <Empty text={t('profile.privateBody')} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 4, marginHorizontal: 16, padding: 4, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              {tabs.map(([key, label]) => (
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={{ flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === key ? c.selected : 'transparent' }}>
                  <T s={14} w="600" c={tab === key ? c.onSelected : c.muted}>{label}</T>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12 }}>
              {items.map((p) => (
                <Pressable key={p.id} accessibilityRole="imagebutton" accessibilityLabel={p.caption || t('post.open')} onPress={() => router.push(`/post/${p.id}`)} style={{ width: '48.5%' }}>
                  <MediaThumb post={p} style={{ aspectRatio: 4 / 5, borderRadius: 14 }} />
                </Pressable>
              ))}
            </View>
            {items.length === 0 ? (
              <Empty text={emptyText}>
                {isMe && tab !== 'saved' ? (
                  <Button label={tab === 'scrolls' ? t('profile.firstScroll') : t('profile.firstPost')} onPress={() => compose(tab === 'scrolls' ? 'scroll' : 'post')} style={{ paddingHorizontal: 20 }} />
                ) : null}
              </Empty>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
