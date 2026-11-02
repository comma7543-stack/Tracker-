import { useNetInfo } from '@react-native-community/netinfo';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { ScrollItem } from '../../components/ScrollItem';
import { Screen, Spinner, T } from '../../components/ui';
import { scrollsFeed } from '../../lib/api';
import { useSettings } from '../../lib/store';
import { DARK } from '../../lib/theme';
import type { PostCard } from '../../lib/types';

export default function Scrolls() {
  const { t } = useTranslation();
  const [height, setHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);
  const [muted, setMuted] = useState(false);
  const net = useNetInfo();
  const dataSaver = useSettings((s) => s.prefs.dataSaver);
  const wifiOnly = useSettings((s) => s.prefs.autoplayWifi);
  const autoplay = !dataSaver && (!wifiOnly || net.type === 'wifi');

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  const feed = useInfiniteQuery({
    queryKey: ['scrolls'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => scrollsFeed(pageParam),
    getNextPageParam: (last: PostCard[]) => (last.length === 10 ? last[last.length - 1].created_at : undefined),
  });
  const items = feed.data?.pages.flat() ?? [];
  const current = activeId ?? items[0]?.id;

  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: PostCard }[] }) => {
    if (viewableItems[0]) setActiveId(viewableItems[0].item.id);
  }).current;

  return (
    <Screen dark>
      <View style={{ flex: 1 }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
        {height > 0 && items.length > 0 ? (
          <FlatList
            data={items}
            keyExtractor={(p) => p.id}
            pagingEnabled
            decelerationRate="fast"
            snapToInterval={height}
            showsVerticalScrollIndicator={false}
            windowSize={3}
            maxToRenderPerBatch={2}
            initialNumToRender={1}
            removeClippedSubviews
            viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
            onViewableItemsChanged={onViewable}
            getItemLayout={(_d, index) => ({ length: height, offset: height * index, index })}
            onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage(); }}
            renderItem={({ item }) => (
              <ScrollItem
                post={item}
                height={height}
                active={focused && item.id === current}
                muted={muted}
                autoplay={autoplay}
                onToggleMute={() => setMuted((m) => !m)}
              />
            )}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {feed.isLoading ? <Spinner color={DARK.fg} /> : <T s={14} c={DARK.muted}>{t('scrolls.empty')}</T>}
          </View>
        )}
      </View>
    </Screen>
  );
}
