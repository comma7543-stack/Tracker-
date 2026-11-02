import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Flag, Heart, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { MediaThumb, VideoPlayerView } from '../../components/Media';
import { useLike } from '../../components/PostCard';
import { Avatar, ErrorText, IconButton, Screen, T } from '../../components/ui';
import { activeStories, markStorySeen, sendMessage, startConversation } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useReduceMotion } from '../../lib/hooks';
import { isBad } from '../../lib/profanity';
import { myId, toast, useUI } from '../../lib/store';
import { DARK } from '../../lib/theme';
import type { PostCard } from '../../lib/types';

const FRAME_MS = 5000;
// A press shorter than this is a tap (next/back). Longer is a hold (pause).
const HOLD_MS = 200;
const SLIDE_MS = 320;
const FADE_MS = 170;

function StoryLikeButton({ story }: { story: PostCard }) {
  const { t } = useTranslation();
  const { liked, toggle } = useLike(story);
  return (
    <IconButton label={liked ? t('post.unlike') : t('post.like')} onPress={toggle}>
      <Heart size={26} color={DARK.fg} fill={liked ? DARK.fg : 'none'} strokeWidth={1.8} />
    </IconButton>
  );
}

/** One person's stories. Neighbors stay mounted but inactive, so they slide in already loaded. */
function StoryPage({ userId, active, onNext, onPrev, onClose }: {
  userId: string; active: boolean; onNext: () => void; onPrev: () => boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const open = useUI((s) => s.open);
  const reduceMotion = useReduceMotion();
  const [frame, setFrame] = useState(0);
  const [under, setUnder] = useState<PostCard | null>(null);
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const elapsed = useRef(0);
  const restart = useRef(false);
  const [runs, setRuns] = useState(0);
  const pressedAt = useRef(0);

  const { data: frames = [], isLoading } = useQuery({ queryKey: ['stories', userId], queryFn: () => activeStories(userId) });
  const story = frames[Math.min(frame, frames.length - 1)];
  const upcoming = frames[frame + 1];
  const paused = held || typing || !active;
  const isMine = userId === myId();
  const bad = isBad(draft);

  /** The new story fades in over the old one, so there's never an empty panel. */
  const changeFrame = (to: number) => {
    if (reduceMotion) {
      setFrame(to);
      return;
    }
    setUnder(story);
    fade.setValue(0);
    setFrame(to);
    Animated.timing(fade, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setUnder(null);
    });
  };

  const next = () => (frame < frames.length - 1 ? changeFrame(frame + 1) : onNext());

  const prev = () => {
    if (frame > 0) changeFrame(frame - 1);
    else if (!onPrev()) {
      // Nothing before this: start it over, in the timer effect so its cleanup can't add time back.
      restart.current = true;
      setRuns((n) => n + 1);
    }
  };

  useEffect(() => {
    progress.setValue(0);
    elapsed.current = 0;
    if (active && story) markStorySeen(story.id);
  }, [story?.id, active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active && !isLoading && frames.length === 0) onNext();
  }, [active, isLoading, frames.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs even with Reduce motion on: it's a timer, and it's what moves frames along.
  useEffect(() => {
    if (!story || paused) return undefined;
    if (restart.current) {
      restart.current = false;
      elapsed.current = 0;
      progress.setValue(0);
    }
    const started = Date.now();
    const animation = Animated.timing(progress, { toValue: 1, duration: Math.max(0, FRAME_MS - elapsed.current), easing: Easing.linear, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) next(); });
    return () => {
      animation.stop();
      elapsed.current += Date.now() - started;
    };
  }, [story?.id, paused, runs]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendReply = async () => {
    const text = draft.trim();
    if (!text || bad || !story) return;
    setDraft('');
    try {
      await sendMessage(await startConversation(userId), t('story.replyPrefix', { text }));
      toast(t('story.replySent', { name: story.username }));
    } catch {
      toast(t('messages.notAllowed'));
    }
  };

  const zone = (action: () => void) => ({
    onPressIn: () => { pressedAt.current = Date.now(); setHeld(true); },
    onPressOut: () => { setHeld(false); if (Date.now() - pressedAt.current < HOLD_MS) action(); },
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingTop: 10 }}>
        {frames.map((f, i) => (
          <View key={f.id} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: DARK.faint, overflow: 'hidden' }}>
            <Animated.View style={{ height: '100%', backgroundColor: DARK.fg, transformOrigin: 'left', transform: [{ scaleX: i < frame ? 1 : i > frame ? 0 : progress }] }} />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 12, paddingRight: 4 }}>
        <Avatar name={story?.username} url={story?.avatar_url} size={32} bg={DARK.avatar} fg={DARK.fg} />
        <T s={14} w="600" c={DARK.fg} numberOfLines={1} style={{ flexShrink: 1 }}>{isMine ? t('home.yourProof') : story?.username}</T>
        {story ? <T s={13} c={DARK.muted}>{timeAgo(story.created_at, t)}</T> : null}
        <View style={{ flex: 1 }} />
        {story && !isMine ? <IconButton label={t('report.title')} onPress={() => open({ type: 'report', target: { type: 'post', id: story.id } })}><Flag size={20} color={DARK.fg} strokeWidth={1.8} /></IconButton> : null}
        <IconButton label={t('common.close')} onPress={onClose}><X size={24} color={DARK.fg} strokeWidth={2} /></IconButton>
      </View>

      <View style={{ flex: 1, marginHorizontal: 8, borderRadius: 12, overflow: 'hidden', backgroundColor: DARK.panel }}>
        {/* Loads the next picture ahead of time, under everything. */}
        {upcoming ? <MediaThumb post={upcoming} style={[StyleSheet.absoluteFill, { opacity: 0 }]} /> : null}
        {under ? <MediaThumb post={under} style={StyleSheet.absoluteFill} /> : null}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }]}>
          {story ? (
            story.media_type === 'video' && active
              ? <VideoPlayerView path={story.media_path} active={!paused} style={StyleSheet.absoluteFill} />
              : <MediaThumb post={story} style={StyleSheet.absoluteFill} />
          ) : null}
          {story?.caption ? <T s={22} w="700" c={DARK.fg} style={{ textAlign: 'center', lineHeight: 30 }}>{story.caption}</T> : null}
          {story ? (
            <View style={{ paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999, backgroundColor: DARK.scrim }}>
              <T s={12} w="600" c={DARK.fg}>{t(`subtag.${story.subtag}`)}</T>
            </View>
          ) : null}
        </Animated.View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('story.previous')} {...zone(prev)} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '35%' }} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('story.next')} {...zone(next)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '65%' }} />
      </View>

      {story && !isMine ? (
        <>
          {bad ? <View style={{ paddingHorizontal: 16 }}><ErrorText>{t('messages.offensive')}</ErrorText></View> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, paddingBottom: 8, paddingLeft: 12, paddingRight: 8 }}>
            <TextInput
              accessibilityLabel={t('story.replyLabel')}
              value={draft}
              onChangeText={setDraft}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onSubmitEditing={sendReply}
              returnKeyType="send"
              maxLength={300}
              placeholder={t('story.replyPlaceholder', { name: story.username })}
              placeholderTextColor={DARK.muted}
              style={{ flex: 1, height: 44, borderWidth: 1, borderColor: DARK.muted, borderRadius: 999, paddingHorizontal: 16, fontSize: 15, color: DARK.fg }}
            />
            <StoryLikeButton key={story.id} story={story} />
          </View>
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export default function StoryViewer() {
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ userId: string; queue?: string }>();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const queue = (params.queue ?? params.userId).split(',');
  const start = Math.max(0, queue.indexOf(params.userId));
  const [personIndex, setPersonIndex] = useState(start);
  // Which neighbors to keep mounted. Waits for the slide to end, so mounting can't stutter it.
  const [settled, setSettled] = useState(start);
  // Never reset: each page has a fixed place on the track, so nothing jumps when a slide ends.
  const position = useRef(new Animated.Value(start)).current;

  const close = () => {
    qc.invalidateQueries({ queryKey: ['story-roll'] });
    router.back();
  };

  const goTo = (index: number) => {
    setPersonIndex(index);
    if (reduceMotion) {
      position.setValue(index);
      setSettled(index);
      return;
    }
    Animated.timing(position, { toValue: index, duration: SLIDE_MS, easing: Easing.bezier(0.22, 0.61, 0.36, 1), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setSettled(index);
    });
  };

  const onNext = () => (personIndex < queue.length - 1 ? goTo(personIndex + 1) : close());
  const onPrev = () => {
    if (personIndex === 0) return false;
    goTo(personIndex - 1);
    return true;
  };

  return (
    <Screen dark bottom>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Animated.View
          style={{
            flex: 1, flexDirection: 'row', width: width * queue.length,
            transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) }],
          }}
        >
          {queue.map((id, i) => {
            const edges = (edge: number) => position.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [edge, 1, edge], extrapolate: 'clamp' });
            return (
              <Animated.View key={id} style={{ width, opacity: edges(0.6), transform: [{ scale: edges(0.94) }] }}>
                {i === personIndex || Math.abs(i - settled) <= 1 ? (
                  <StoryPage userId={id} active={i === personIndex} onNext={onNext} onPrev={onPrev} onClose={close} />
                ) : null}
              </Animated.View>
            );
          })}
        </Animated.View>
      </View>
    </Screen>
  );
}
