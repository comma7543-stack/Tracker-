import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { Avatar, BackHeader, Empty, FAST_SCROLL, Screen, T } from '../../components/ui';
import { inbox } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useMe } from '../../lib/hooks';
import { myId } from '../../lib/store';
import { useTheme } from '../../lib/theme';

export default function Inbox() {
  const c = useTheme();
  const { t } = useTranslation();
  const me = useMe().data;
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['inbox'], queryFn: inbox });
  const threads = data.filter((x) => !q.trim() || x.other_username.includes(q.trim().toLowerCase()));

  return (
    <Screen>
      <BackHeader title={me?.username ?? t('messages.title')} />
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, justifyContent: 'center' }}>
        <TextInput
          accessibilityLabel={t('messages.search')}
          value={q}
          onChangeText={setQ}
          placeholder={t('messages.search')}
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          style={{ height: 44, borderRadius: 10, backgroundColor: c.surface2, paddingLeft: 36, paddingRight: 12, fontSize: 15, color: c.fg }}
        />
        <View pointerEvents="none" style={{ position: 'absolute', left: 28, top: 23 }}><Search size={18} color={c.muted} strokeWidth={2} /></View>
      </View>
      <T s={15} w="700" style={{ paddingHorizontal: 16, paddingVertical: 6 }}>{t('messages.title')}</T>
      <FlatList
        {...FAST_SCROLL}
        data={threads}
        keyExtractor={(x) => x.conversation_id}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={isLoading ? undefined : <Empty text={q.trim() ? t('messages.noMatch') : t('messages.empty')} />}
        renderItem={({ item }) => {
          const unread = item.unread > 0;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unread ? t('messages.threadUnread', { name: item.other_username }) : item.other_username}
              onPress={() => router.push(`/messages/${item.conversation_id}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingHorizontal: 16 }}
            >
              <Avatar name={item.other_username} url={item.other_avatar_url} size={52} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T s={14} w={unread ? '700' : '400'} numberOfLines={1}>{item.other_username}</T>
                <T s={13} w={unread ? '700' : '400'} c={unread ? c.fg : c.muted} numberOfLines={1}>
                  {item.last_sender_id === myId() ? t('messages.you', { text: item.last_body || t('messages.photo') }) : item.last_body || t('messages.photo')} · {timeAgo(item.last_at, t)}
                </T>
              </View>
              {unread ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.accent }} /> : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
