import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Search as SearchIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { MediaThumb } from '../../components/Media';
import { Avatar, Chip, Empty, FAST_SCROLL, Screen, T } from '../../components/ui';
import { explore, searchUsers } from '../../lib/api';
import { TOPICS } from '../../lib/topics';
import { useTheme } from '../../lib/theme';

export default function Search() {
  const c = useTheme();
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  const { data: posts = [], isLoading } = useQuery({ queryKey: ['explore', q, topic], enabled: active, queryFn: () => explore(q, topic) });
  const { data: users = [] } = useQuery({ queryKey: ['search-users', q], enabled: active && q.length > 0, queryFn: () => searchUsers(q) });

  const cancel = () => { setActive(false); setText(''); setTopic(null); };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 }}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <TextInput
            accessibilityLabel={t('search.label')}
            value={text}
            onChangeText={setText}
            onFocus={() => setActive(true)}
            placeholder={t('search.placeholder')}
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{ height: 44, borderRadius: 10, backgroundColor: c.surface2, paddingLeft: 36, paddingRight: 12, fontSize: 15, color: c.fg }}
          />
          <View pointerEvents="none" style={{ position: 'absolute', left: 12 }}><SearchIcon size={18} color={c.muted} strokeWidth={2} /></View>
        </View>
        {active ? <Pressable accessibilityRole="button" onPress={cancel} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 4 }}><T s={15} w="600">{t('common.cancel')}</T></Pressable> : null}
      </View>

      {!active ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32, paddingBottom: 80 }}>
          <SearchIcon size={40} color={c.faint} strokeWidth={1.6} />
          <T s={16} w="700">{t('search.idleTitle')}</T>
          <T s={14} c={c.muted} style={{ textAlign: 'center', lineHeight: 20 }}>{t('search.idleBody')}</T>
        </View>
      ) : (
        <FlatList
          {...FAST_SCROLL}
          data={posts}
          numColumns={2}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          columnWrapperStyle={{ gap: 8, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 12, paddingBottom: 20 }}
          ListHeaderComponent={(
            <View style={{ gap: 12 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
                <Chip label={t('search.all')} on={!topic} onPress={() => setTopic(null)} />
                {TOPICS.map(([name]) => <Chip key={name} label={t(`topic.${name}`)} on={topic === name} onPress={() => setTopic(name)} />)}
              </ScrollView>
              {users.length > 0 ? (
                <View>
                  {users.map((u) => (
                    <Pressable key={u.id} accessibilityRole="button" onPress={() => router.push(`/user/${u.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16 }}>
                      <Avatar name={u.username} url={u.avatar_url} size={40} />
                      <View style={{ flex: 1 }}>
                        <T s={14} w="600" numberOfLines={1}>{u.username}</T>
                        <T s={13} c={c.muted} numberOfLines={1}>{u.full_name}</T>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <T s={15} w="700" style={{ paddingHorizontal: 16 }}>{q ? t('search.resultsFor', { q }) : t('search.recommended')}</T>
            </View>
          )}
          ListEmptyComponent={isLoading ? undefined : <Empty text={t('search.empty')} />}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => router.push(`/post/${item.id}`)} style={{ flex: 1, maxWidth: '50%', gap: 4, minWidth: 0 }}>
              <View>
                <MediaThumb post={item} style={{ height: 220, borderRadius: 10 }} />
                <View style={{ position: 'absolute', left: 8, top: 8, backgroundColor: c.bg, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999 }}>
                  <T s={11} w="600">{t(`subtag.${item.subtag}`)}</T>
                </View>
              </View>
              <T s={13} w="600" numberOfLines={2} style={{ lineHeight: 17 }}>{item.caption || t(`subtag.${item.subtag}`)}</T>
              <T s={12} c={c.muted} numberOfLines={1}>{item.username}</T>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
