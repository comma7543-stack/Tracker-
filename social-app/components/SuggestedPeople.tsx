// A row of people worth supporting, for new accounts with a quiet feed and for
// anyone looking for more. Supported people drop out of the row.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { follow, suggestedPeople } from '../lib/api';
import { toast } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { SuggestedPerson } from '../lib/types';
import { StreakFlame } from './StreakFlame';
import { Avatar, T } from './ui';

export function useSuggestedPeople() {
  return useQuery({ queryKey: ['suggested-people'], queryFn: suggestedPeople, staleTime: 5 * 60_000 });
}

/** Why this person is suggested, in a few words. */
export function suggestionReason(p: SuggestedPerson, t: TFunction) {
  if (p.mutuals > 0) return t('discover.mutuals', { count: p.mutuals });
  if (p.top_topic) return t(`topic.${p.top_topic}`);
  return t('discover.active');
}

export function SupportButton({ person, from, onDone }: { person: Pick<SuggestedPerson, 'id' | 'username'>; from: string; onDone?: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const press = async () => {
    setDone(true);
    try {
      await follow(person.id, from);
      qc.invalidateQueries({ queryKey: ['home-feed'] });
      qc.invalidateQueries({ queryKey: ['story-roll'] });
      onDone?.();
    } catch {
      setDone(false);
      toast(t('common.tryAgain'));
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={done ? t('profile.followingBtn') : t('discover.supportName', { name: person.username })}
      disabled={done}
      onPress={press}
      style={{ height: 32, minWidth: 92, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? c.surface2 : c.accent }}
    >
      <T s={13} w="600" c={done ? c.fg : c.onAccent}>{done ? t('profile.followingBtn') : t('profile.follow')}</T>
    </Pressable>
  );
}

export function SuggestedPeopleRow({ title }: { title?: string }) {
  const c = useTheme();
  const { t } = useTranslation();
  const { data = [] } = useSuggestedPeople();
  if (data.length === 0) return null;
  return (
    <View style={{ paddingVertical: 14, marginBottom: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 16, paddingBottom: 10 }}>
        <T s={15} w="700">{title ?? t('discover.suggested')}</T>
        <Pressable accessibilityRole="button" onPress={() => router.push('/discover')} hitSlop={10}>
          <T s={13} w="600" c={c.muted}>{t('discover.seeAll')}</T>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
        {data.slice(0, 10).map((p) => (
          <View key={p.id} style={{ width: 150, padding: 12, gap: 6, alignItems: 'center', borderRadius: 14, borderWidth: c.cardBorderWidth, borderColor: c.cardBorderColor, backgroundColor: c.surface }}>
            <Pressable accessibilityRole="button" accessibilityLabel={p.username} onPress={() => router.push(`/user/${p.id}`)} style={{ alignItems: 'center', gap: 6 }}>
              <Avatar name={p.username} url={p.avatar_url} size={56} />
              <T s={14} w="600" numberOfLines={1}>{p.username}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {p.streak ? <StreakFlame count={p.streak} size={14} /> : null}
                <T s={12} c={c.muted} numberOfLines={1}>{p.streak ? `${p.streak} · ` : ''}{suggestionReason(p, t)}</T>
              </View>
            </Pressable>
            <SupportButton person={p} from="suggested_row" />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** The full list, for onboarding and the Discover screen. */
export function SuggestedPeopleList({ from }: { from: string }) {
  const c = useTheme();
  const { t } = useTranslation();
  const { data = [], isLoading } = useSuggestedPeople();
  if (!isLoading && data.length === 0) return <T s={14} c={c.muted} style={{ textAlign: 'center', marginTop: 24, lineHeight: 20 }}>{t('discover.noneYet')}</T>;
  return (
    <View>
      {data.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 }}>
          <Pressable accessibilityRole="button" onPress={() => router.push(`/user/${p.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <Avatar name={p.username} url={p.avatar_url} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T s={14} w="600" numberOfLines={1}>{p.username}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {p.streak ? <StreakFlame count={p.streak} size={13} /> : null}
                <T s={13} c={c.muted} numberOfLines={1}>{p.streak ? `${p.streak} · ` : ''}{suggestionReason(p, t)}</T>
              </View>
            </View>
          </Pressable>
          <SupportButton person={p} from={from} />
        </View>
      ))}
    </View>
  );
}
