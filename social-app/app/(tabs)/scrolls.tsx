import { useNetInfo } from '@react-native-community/netinfo';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { ScrollItem } from '../../components/ScrollItem';
import { Screen, Spinner, T } from '../../components/ui';
import { recordView, scrollsRanked } from '../../lib/api';
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

  // Ranked, so pages are by position. A score can shift between pages; repeats are dropped.
  const feed = useInfiniteQuery({
    queryKey: ['scrolls'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => scrollsRanked(pageParam),
    getNextPageParam: (last: PostCard[], all: PostCard[][]) => (last.length === 10 ? all.flat().length : undefined),
  });
  const items = Array.from(new Map((feed.data?.pages.flat() ?? []).map((p) => [p.id, p])).values());
  const current = activeId ?? items[0]?.id;

  // Watch time per scroll, for ranking: reported when the next one takes over.
  const watching = useRef<{ id: string; since: number } | null>(null);
  const finishWatch = () => {
    const w = watching.current;
    if (w && Date.now() - w.since >= 800) recordView(w.id, Date.now() - w.since);
    watching.current = null;
  };
  useEffect(() => {
    if (!focused || !current) { finishWatch(); return; }
    if (watching.current?.id !== current) { finishWatch(); watching.current = { id: current, since: Date.now() }; }
  }, [focused, current]);
  useEffect(() => finishWatch, []);

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
