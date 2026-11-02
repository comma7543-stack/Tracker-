import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';
import { MediaThumb } from '../../components/Media';
import { BackHeader, Empty, FAST_SCROLL, Screen, T } from '../../components/ui';
import { tagPosts } from '../../lib/api';
import { useTheme } from '../../lib/theme';

export default function Tag() {
  const c = useTheme();
  const { t } = useTranslation();
  const { tag = '' } = useLocalSearchParams<{ tag: string }>();
  const { data = [], isLoading } = useQuery({ queryKey: ['tag', tag], queryFn: () => tagPosts(tag) });
  return (
    <Screen>
      <BackHeader title={`#${tag}`} />
      <FlatList
        {...FAST_SCROLL}
        data={data}
        numColumns={3}
        keyExtractor={(p) => p.id}
        columnWrapperStyle={{ gap: 2 }}
        contentContainerStyle={{ gap: 2, paddingBottom: 24 }}
        ListHeaderComponent={<T s={13} c={c.muted} style={{ paddingHorizontal: 16, paddingBottom: 10 }}>{t('tags.count', { count: data.length })}</T>}
        ListEmptyComponent={isLoading ? undefined : <Empty text={t('tags.empty')} />}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={item.caption || item.username} onPress={() => router.push(`/post/${item.id}`)} style={{ flex: 1 / 3 }}>
            <View><MediaThumb post={item} style={{ aspectRatio: 3 / 4 }} /></View>
          </Pressable>
        )}
      />
    </Screen>
  );
}
