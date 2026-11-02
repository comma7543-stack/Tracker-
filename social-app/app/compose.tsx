import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertCircle, Image as ImageIcon, Play } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Button, Chip, ErrorText, Screen, Switch, T } from '../components/ui';
import { createPost, deletePostRow, goalStatus, postingLimits, requestReview, runModeration } from '../lib/api';
import { DEMO } from '../lib/config';
import { deleteMedia, PickedMedia, pickMedia, PROOF_FRAMES, uploadMedia } from '../lib/media';
import { isBad } from '../lib/profanity';
import { toast } from '../lib/store';
import { useTheme } from '../lib/theme';
import { TOPICS, topicOf } from '../lib/topics';
import type { MediaType, PostKind } from '../lib/types';

type Stage = 'form' | 'checking' | 'still_checking' | 'off_topic' | 'banned' | 'review_requested' | 'limit' | 'not_proven' | 'demo_ask';

export default function Compose() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { mode: rawMode, proof: proofParam } = useLocalSearchParams<{ mode: PostKind; proof?: string }>();
  const mode: PostKind = rawMode === 'story' || rawMode === 'scroll' ? rawMode : 'post';
  const isStory = mode === 'story';

  const [type, setType] = useState<MediaType>(mode === 'scroll' ? 'video' : 'photo');
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [text, setText] = useState('');
  const [group, setGroup] = useState('');
  const [subtag, setSubtag] = useState('');
  const [toScroll, setToScroll] = useState(false);
  const [proof, setProof] = useState(proofParam === '1');
  const [goalReason, setGoalReason] = useState('');
  const answerDemo = useRef<(proven: boolean) => void>(() => undefined);
  const [stage, setStage] = useState<Stage>('form');
  const [strikes, setStrikes] = useState(0);
  const [suspended, setSuspended] = useState(false);
  const [error, setError] = useState('');
  // Kept so "Change topic" can reshare without uploading again.
  const [uploaded, setUploaded] = useState<{ path: string; for: string } | null>(null);
  const [postId, setPostId] = useState<string | null>(null);

  const { data: limits } = useQuery({ queryKey: ['posting-limits'], enabled: !isStory, queryFn: postingLimits, staleTime: 0 });
  const left = limits && !isStory ? limits.posts_limit - limits.posts_used : null;

  const { data: goal } = useQuery({ queryKey: ['goal-status'], queryFn: goalStatus });
  const proving = proof && media?.type === 'video' && !!goal?.goal;

  const bad = isBad(text);
  const canShare = !!media && !!subtag && !bad;
  const title = mode === 'post' ? t('compose.newPost') : isStory ? t('compose.newStory') : t('compose.newScroll');
  const subs = TOPICS.find((x) => x[0] === group)?.[1] ?? [];

  const pick = async (next: MediaType) => {
    setType(next);
    const picked = await pickMedia(next);
    if (picked) {
      setMedia(picked);
      if (next === 'photo') setToScroll(false);
    }
  };

  const share = async () => {
    if (!media) return;
    setError('');
    setStage('checking');
    try {
      const path = uploaded?.for === media.uri ? uploaded.path : await uploadMedia(media, proving ? PROOF_FRAMES : undefined);
      setUploaded({ path, for: media.uri });
      const id = await createPost({ kind: mode, mediaPath: path, mediaType: media.type, caption: text.trim(), subtag, alsoScroll: mode === 'post' && media.type === 'video' && toScroll, goalProof: proving });
      setPostId(id);
      qc.invalidateQueries({ queryKey: ['posting-limits'] });
      // The demo has no AI to look at the video, so it asks what the AI would say.
      let demoProven: boolean | undefined;
      if (DEMO && proving) {
        demoProven = await new Promise<boolean>((resolve) => {
          answerDemo.current = resolve;
          setStage('demo_ask');
        });
        setStage('checking');
      }
      const result = await runModeration(id, demoProven);
      qc.invalidateQueries({ queryKey: ['status'] });

      if (result.status === 'live') {
        qc.invalidateQueries();
        if (result.certificate_id) {
          router.replace(`/certificate/${result.certificate_id}?new=1`);
          return;
        }
        if (proving) {
          setGoalReason(result.goal_reason ?? '');
          setStage('not_proven');
          return;
        }
        toast(isStory ? t('compose.addedStory') : mode === 'scroll' ? t('compose.sharedScrolls') : toScroll ? t('compose.postedBoth') : t('compose.posted'));
        router.back();
      } else if (result.status === 'off_topic') {
        setStage('off_topic');
      } else if (result.status === 'rejected' || result.status === 'removed') {
        setStrikes(result.strikes ?? 0);
        setSuspended(!!result.suspended);
        setStage('banned');
      } else {
        setStage('still_checking');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('daily_limit_reached')) {
        setStage('limit');
        return;
      }
      setError(e instanceof Error && e.message.includes('goal_proof_limit') ? t('compose.proofLimit') : t('compose.failed'));
      setStage('form');
    }
  };

  const discard = async () => {
    try {
      if (postId) await deletePostRow(postId);
      if (uploaded) await deleteMedia(uploaded.path);
    } catch {
      // Hidden from everyone anyway; removed with the account or by the owner later.
    }
    router.back();
  };

  const changeTopic = async () => {
    // The off-topic row goes, the uploaded file stays for the next try.
    if (postId) await deletePostRow(postId).catch(() => {});
    setPostId(null);
    setStage('form');
  };

  const review = async () => {
    if (!postId) return;
    try {
      await requestReview(postId);
      setStage('review_requested');
    } catch {
      toast(t('common.tryAgain'));
    }
  };

  if (stage === 'demo_ask') {
    return (
      <Screen style={{ justifyContent: 'center', gap: 12, padding: 24 }}>
        <T s={22} w="700">{t('compose.demoTitle')}</T>
        <T s={15} c={c.muted} style={{ lineHeight: 22 }}>{t('compose.demoBody')}</T>
        <Button label={t('compose.demoProven')} onPress={() => answerDemo.current(true)} style={{ marginTop: 8 }} />
        <Button kind="secondary" label={t('compose.demoNotProven')} onPress={() => answerDemo.current(false)} />
      </Screen>
    );
  }

  if (stage === 'checking') {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center', gap: 18, padding: 32 }}>
        <ActivityIndicator size="large" color={c.fg} />
        <T s={18} w="700" accessibilityLiveRegion="polite">{t('compose.checking')}</T>
        {!isStory || proving ? (
          <View style={{ gap: 8, alignItems: 'center' }}>
            <T s={14} c={c.muted}>{t('compose.scanning')}</T>
            <T s={14} c={c.muted}>{t('compose.fits', { topic: t(`subtag.${subtag}`) })}</T>
          </View>
        ) : null}
      </Screen>
    );
  }

  const notice = (title: string, body: string) => (
    <Screen style={{ justifyContent: 'center', gap: 12, padding: 24 }}>
      <T s={22} w="700">{title}</T>
      <T s={15} c={c.muted} style={{ lineHeight: 22 }}>{body}</T>
      <Button label={t('common.done')} onPress={() => router.back()} style={{ marginTop: 8 }} />
    </Screen>
  );

  if (stage === 'limit' || (stage === 'form' && left === 0)) return notice(t('compose.limitTitle'), t('compose.limitPosts', { n: limits?.posts_limit ?? 5 }));
  if (stage === 'still_checking') return notice(t('compose.stillTitle'), t('compose.stillBody'));
  if (stage === 'not_proven') return notice(t('compose.notProvenTitle'), `${goalReason ? `${goalReason} ` : ''}${t('compose.notProvenBody')}`);
  if (stage === 'review_requested') return notice(t('compose.reviewTitle'), t('compose.reviewBody'));

  if (stage === 'off_topic' || stage === 'banned') {
    return (
      <Screen style={{ justifyContent: 'center', gap: 14, padding: 24 }}>
        <AlertCircle size={56} color={c.danger} strokeWidth={1.8} />
        {stage === 'off_topic' ? (
          <View style={{ gap: 10 }}>
            <T s={22} w="700" accessibilityRole="alert">{t('compose.offTitle', { topic: t(`subtag.${subtag}`) })}</T>
            <T s={15} c={c.muted} style={{ lineHeight: 22 }}>{t('compose.offBody')}</T>
            <Button label={t('compose.changeTopic')} onPress={changeTopic} style={{ marginTop: 8 }} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <T s={22} w="700" accessibilityRole="alert">{t('compose.banTitle')}</T>
            <T s={15} c={c.muted} style={{ lineHeight: 22 }}>{t('compose.banBody')}</T>
            {strikes > 0 ? (
              <T s={14} w="600" c={c.danger} style={{ lineHeight: 20 }}>
                {suspended ? t('compose.strikeSuspended', { n: strikes }) : t('compose.strikeLine', { n: strikes })}
              </T>
            ) : null}
            <Button kind="secondary" label={t('compose.readGuidelines')} onPress={() => { router.back(); router.push('/settings/guidelines'); }} style={{ marginTop: 8 }} />
          </View>
        )}
        <Button kind="secondary" label={t('compose.requestReview')} onPress={review} />
        <Pressable accessibilityRole="button" onPress={discard} style={{ alignSelf: 'center', height: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
          <T s={15} c={c.muted}>{t('compose.discard')}</T>
        </Pressable>
      </Screen>
    );
  }

  const boxStyle = mode === 'post' ? { width: '100%' as const, aspectRatio: 1 } : { width: 203, height: 360, alignSelf: 'center' as const };

  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <Pressable accessibilityRole="button" onPress={discard} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 4 }}><T s={15}>{t('common.cancel')}</T></Pressable>
          <T s={16} w="700">{title}</T>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canShare }} disabled={!canShare} onPress={share} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
            <T s={15} w="700" c={canShare ? c.fg : c.faint}>{isStory ? t('compose.add') : t('compose.share')}</T>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 18 }}>
          {left !== null ? <T s={13} c={c.muted}>{t('compose.leftToday', { n: left })}</T> : null}

          {mode !== 'scroll' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['photo', 'video'] as const).map((k) => (
                <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: type === k }} onPress={() => pick(k)} style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: type === k ? c.selected : c.line, backgroundColor: type === k ? c.selected : c.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <T s={14} w="600" c={type === k ? c.onSelected : c.fg}>{k === 'photo' ? t('compose.photo') : t('compose.video')}</T>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel={type === 'video' ? t('compose.pickVideo') : t('compose.pickPhoto')} onPress={() => pick(type)} style={[boxStyle, { borderRadius: 12, backgroundColor: c.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 }]}>
            {media ? (
              <>
                <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                {media.type === 'video' ? <Play size={36} color={c.mediaFg} fill={c.mediaFg} /> : null}
              </>
            ) : (
              <>
                <ImageIcon size={32} color={c.muted} strokeWidth={1.6} />
                <T s={13} c={c.muted}>{type === 'video' ? t('compose.pickVideo') : t('compose.pickPhoto')}</T>
              </>
            )}
            {isStory && text.trim() ? <T s={18} w="700" c={media ? c.mediaFg : c.fg} style={{ textAlign: 'center', lineHeight: 24 }}>{text}</T> : null}
          </Pressable>

          <View style={{ gap: 6 }}>
            <T s={12} w="600" c={c.muted} style={{ letterSpacing: 0.7, textTransform: 'uppercase' }}>{isStory ? t('compose.storyText') : t('compose.caption')}</T>
            <TextInput
              accessibilityLabel={isStory ? t('compose.storyText') : t('compose.caption')}
              value={text}
              onChangeText={setText}
              maxLength={200}
              placeholder={isStory ? t('compose.storyPh') : mode === 'scroll' ? t('compose.scrollPh') : t('compose.captionPh')}
              placeholderTextColor={c.muted}
              style={{ height: 44, borderWidth: 1, borderColor: c.line, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, color: c.fg, backgroundColor: c.bg }}
            />
            {bad ? <ErrorText>{t('compose.offensive')}</ErrorText> : null}
          </View>

          <View style={{ gap: 8 }}>
            <T s={12} w="600" c={c.muted} style={{ letterSpacing: 0.7, textTransform: 'uppercase' }}>{t('compose.topic')}</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {TOPICS.map(([name]) => <Chip key={name} label={t(`topic.${name}`)} on={name === group} onPress={() => { if (name !== group) setSubtag(''); setGroup(name); }} />)}
            </View>
            {group ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingTop: 2 }}>
                {subs.map((k) => <Chip key={k} label={t(`subtag.${k}`)} on={k === subtag} onPress={() => { setSubtag(k); setGroup(topicOf(k)); }} />)}
              </View>
            ) : null}
            {!subtag ? <T s={13} c={c.muted} style={{ lineHeight: 18 }}>{isStory ? t('compose.needTopicStory') : t('compose.needTopic')}</T> : null}
          </View>

          {mode === 'post' && media?.type === 'video' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T s={15} w="600">{t('compose.alsoScrolls')}</T>
                <T s={13} c={c.muted}>{t('compose.alsoScrollsSub')}</T>
              </View>
              <Switch on={toScroll} label={t('compose.alsoScrolls')} onPress={() => setToScroll(!toScroll)} />
            </View>
          ) : null}

          {media?.type === 'video' && goal?.goal ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T s={15} w="600">{t('compose.provesGoal')}</T>
                <T s={13} c={c.muted}>{t('compose.provesGoalSub', { goal: goal.goal })}</T>
              </View>
              <Switch on={proof} label={t('compose.provesGoal')} onPress={() => setProof(!proof)} />
            </View>
          ) : null}

          {error ? <ErrorText>{error}</ErrorText> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
