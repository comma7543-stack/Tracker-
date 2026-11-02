import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { Avatar, BackHeader, Empty, FAST_SCROLL, Pill, Screen, T } from '../../components/ui';
import { follow, getProfile, profilePeople, profileStats, removeFollower, unfollow } from '../../lib/api';
import { myId, toast } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { PersonRow } from '../../lib/types';

type List = 'supporters' | 'supporting';

export default function People() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string; list: List }>();
  const userId = params.id;
  const [list, setList] = useState<List>(params.list === 'supporting' ? 'supporting' : 'supporters');
  const { data: profile } = useQuery({ queryKey: ['profile', userId], queryFn: () => getProfile(userId) });
  const { data: stats } = useQuery({ queryKey: ['stats', userId], queryFn: () => profileStats(userId) });
  const { data = [], isLoading } = useQuery({ queryKey: ['people', userId, list], queryFn: () => profilePeople(userId, list) });

  const run = async (action: Promise<unknown>, person: string) => {
    try {
      await action;
      qc.invalidateQueries({ queryKey: ['people'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['follow', person] });
    } catch {
      toast(t('common.tryAgain'));
    }
  };

  const remove = (p: PersonRow) =>
    Alert.alert(t('profile.removeTitle', { name: p.username }), t('profile.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.remove'), style: 'destructive', onPress: () => run(removeFollower(p.id), p.id) },
    ]);

  const tabs: [List, string][] = [['supporters', t('profile.followers')], ['supporting', t('profile.following')]];
  const hidden = stats && !stats.lists_visible;

  return (
    <Screen>
      <BackHeader title={profile?.username} />
      <View style={{ flexDirection: 'row', gap: 4, margin: 16, padding: 4, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
        {tabs.map(([key, label]) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: list === key }} onPress={() => setList(key)} style={{ flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: list === key ? c.selected : 'transparent' }}>
            <T s={14} w="600" c={list === key ? c.onSelected : c.muted}>{label}</T>
          </Pressable>
        ))}
      </View>
      {hidden ? <Empty text={t('profile.listsHidden')} /> : (
        <FlatList
          {...FAST_SCROLL}
          data={data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={isLoading ? undefined : <Empty text={list === 'supporters' ? t('profile.noSupporters') : t('profile.noSupporting')} />}
          renderItem={({ item: p }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={p.username} onPress={() => router.push(`/user/${p.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 64, paddingHorizontal: 16 }}>
              <Avatar name={p.username} url={p.avatar_url} size={44} />
              <View style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
                <T s={14} w="600" numberOfLines={1}>{p.username}</T>
                <T s={13} c={c.muted} numberOfLines={1}>{p.full_name}</T>
              </View>
              {p.id === myId() ? null : p.my_status ? (
                <Pill label={p.my_status === 'pending' ? t('profile.requested') : t('profile.followingBtn')} onPress={() => run(unfollow(p.id), p.id)} />
              ) : (
                <Pill primary label={t('profile.follow')} onPress={() => run(follow(p.id), p.id)} />
              )}
              {userId === myId() && list === 'supporters' ? <Pill label={t('profile.remove')} onPress={() => remove(p)} /> : null}
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
