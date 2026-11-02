import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Play } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { posterPath, useMediaUrl } from '../lib/media';
import { DARK, useTheme } from '../lib/theme';
import type { MediaType } from '../lib/types';

/** A post's photo, or a video's poster frame with a play mark. */
export function MediaThumb({ post, style, showPlay = true }: { post: { media_path: string; media_type: MediaType }; style?: StyleProp<ViewStyle>; showPlay?: boolean }) {
  const t = useTheme();
  const url = useMediaUrl(posterPath(post));
  return (
    <View style={[{ backgroundColor: t.media, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      {url ? <Image source={{ uri: url }} cachePolicy="memory-disk" recyclingKey={post.media_path} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {post.media_type === 'video' && showPlay ? <Play size={30} color={DARK.fg} fill={DARK.fg} strokeWidth={1.8} /> : null}
    </View>
  );
}

export function VideoPlayerView({ path, active = true, muted = false, autoplay = true, style }: {
  path: string; active?: boolean; muted?: boolean; autoplay?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const url = useMediaUrl(path);
  const [paused, setPaused] = useState(!autoplay);
  const player = useVideoPlayer(url ?? null, (p) => { p.loop = true; });

  useEffect(() => { setPaused(!autoplay); }, [active, autoplay]);
  useEffect(() => { player.muted = muted; }, [player, muted]);
  useEffect(() => {
    if (url && active && !paused) player.play();
    else player.pause();
  }, [player, url, active, paused]);

  return (
    <Pressable style={style} onPress={() => setPaused((v) => !v)} accessibilityRole="button" accessibilityState={{ selected: !paused }}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      {paused ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: DARK.scrim, alignItems: 'center', justifyContent: 'center' }}>
            <Play size={30} color={DARK.fg} fill={DARK.fg} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}
