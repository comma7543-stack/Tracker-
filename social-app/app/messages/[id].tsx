import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Image as ImageIcon } from 'lucide-react-native';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { Avatar, BackHeader, ErrorText, FAST_SCROLL, IconButton, Screen, T } from '../../components/ui';
import { canSendPhotos, conversationOther, getMessages, getProfile, getStreak, markRead, reportPhoto, sendMessage } from '../../lib/api';
import { pickMedia, uploadMessagePhoto, useMediaUrl } from '../../lib/media';
import { timeAgo } from '../../lib/format';
import { useReduceMotion } from '../../lib/hooks';
import { isBad } from '../../lib/profanity';
import { myId, toast, useUI } from '../../lib/store';
import { effectiveStreak, localDate } from '../../lib/streak';
import { supabase } from '../../lib/supabase';
import { boxGlow, useTheme } from '../../lib/theme';
import type { Message } from '../../lib/types';

/** A new bubble: yours pops up from the input with a small bounce, theirs fades in. Old ones just appear. */
function Arrival({ mine, isNew, children }: { mine: boolean; isNew: boolean; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const shown = useRef(new Animated.Value(isNew ? 0 : 1)).current;
  useEffect(() => {
    if (!isNew) return;
    if (reduceMotion) shown.setValue(1);
    else if (mine) Animated.spring(shown, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true }).start();
    else Animated.timing(shown, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    // Only ever runs for the mount, so scrolling back to a bubble doesn't replay it.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const opacity = shown.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const rise = shown.interpolate({ inputRange: [0, 1], outputRange: [mine ? 28 : 8, 0] });
  const scale = shown.interpolate({ inputRange: [0, 1], outputRange: [mine ? 0.85 : 1, 1] });
  return <Animated.View style={{ opacity, transform: [{ translateY: rise }, { scale }] }}>{children}</Animated.View>;
}

function MessagePhoto({ message, mine }: { message: Message; mine: boolean }) {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const removed = !!message.photo_removed_at;
  const url = useMediaUrl(removed ? null : message.photo_path, 'message-photos');

  const report = () => Alert.alert(t('messages.reportPhotoTitle'), t('messages.reportPhotoBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('messages.reportPhotoConfirm'),
      style: 'destructive',
      onPress: () => reportPhoto(message.id)
        .then(() => { toast(t('messages.photoReported')); qc.invalidateQueries({ queryKey: ['messages', message.conversation_id] }); })
        .catch(() => toast(t('common.tryAgain'))),
    },
  ]);

  if (removed) return <T s={13} c={c.muted} style={{ paddingVertical: 6, paddingHorizontal: 6, fontStyle: 'italic' }}>{t('messages.photoRemoved')}</T>;
  return (
    <View style={{ gap: 2, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View style={{ width: 220, height: 280, borderRadius: 16, overflow: 'hidden', backgroundColor: c.surface2 }}>
        {url ? <Image source={{ uri: url }} style={{ width: 220, height: 280 }} contentFit="cover" /> : null}
      </View>
      {!mine ? (
        <Pressable accessibilityRole="button" onPress={report} style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 6 }}>
          <T s={12} w="600" c={c.muted}>{t('messages.reportPhoto')}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function Thread() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const open = useUI((s) => s.open);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Message>>(null);

  const { data: otherId } = useQuery({ queryKey: ['conversation-other', id], queryFn: () => conversationOther(id) });
  const { data: other } = useQuery({ queryKey: ['profile', otherId], enabled: !!otherId, queryFn: () => getProfile(otherId as string) });
  const { data: streak } = useQuery({ queryKey: ['streak', otherId], enabled: !!otherId, queryFn: () => getStreak(otherId as string) });
  const { data: messages = [], isFetched } = useQuery({ queryKey: ['messages', id], queryFn: () => getMessages(id) });
  // Their auto-freeze setting is private, so assume the default: on, as on profiles and posts.
  const count = streak ? effectiveStreak(streak, localDate(), true) : 0;
  const reduceMotion = useReduceMotion();
  const sendPress = useRef(new Animated.Value(1)).current;
  // Everything already on screen when the thread loads is old. Only later arrivals animate.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (isFetched) known.current = new Set(messages.map((m) => m.id));
  }, [isFetched, messages]);

  useEffect(() => {
    const read = () => markRead(id).then(() => qc.invalidateQueries({ queryKey: ['inbox'] }));
    read();
    const channel = supabase
      .channel(`conversation-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ['messages', id] });
        read();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, qc]);

  const bad = isBad(draft);
  const canSend = draft.trim().length > 0 && !bad && !busy;
  const { data: photosAllowed } = useQuery({ queryKey: ['can-send-photos', id], queryFn: () => canSendPhotos(id) });

  const sendPhoto = async () => {
    if (busy) return;
    const picked = await pickMedia('photo');
    if (!picked) return;
    setBusy(true);
    try {
      await sendMessage(id, '', await uploadMessagePhoto(id, picked));
      qc.invalidateQueries({ queryKey: ['messages', id] });
    } catch {
      toast(t('messages.photoFailed'));
    }
    setBusy(false);
  };

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    if (!reduceMotion) {
      sendPress.setValue(0.8);
      Animated.spring(sendPress, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }).start();
    }
    try {
      await sendMessage(id, draft.trim());
      setDraft('');
      qc.invalidateQueries({ queryKey: ['messages', id] });
    } catch {
      toast(t('messages.notAllowed'));
    }
    setBusy(false);
  };

  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <BackHeader
          title=" "
          right={null}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={other?.username}
          onPress={() => otherId && router.push(`/user/${otherId}`)}
          style={{ position: 'absolute', top: 4, left: 52, right: 8, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <Avatar name={other?.username} url={other?.avatar_url} size={34} />
          <View style={{ flex: 1 }}>
            <T s={15} w="700" numberOfLines={1}>{other?.username}</T>
            <T s={12} c={c.muted}>{count > 0 ? t('post.streak', { count }) : t('messages.noStreak')}</T>
          </View>
        </Pressable>
        <FlatList
          {...FAST_SCROLL}
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 12, gap: 8 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: !!known.current && !reduceMotion })}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const mine = item.sender_id === myId();
            return (
              <Arrival mine={mine} isNew={!!known.current && !known.current.has(item.id)}>
                <Pressable
                  onLongPress={() => { if (!mine) open({ type: 'report', target: { type: 'message', id: item.id } }); }}
                  style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}
                >
                  {item.photo_path ? <MessagePhoto message={item} mine={mine} /> : null}
                  {item.body ? (
                    <View style={[{ maxWidth: '75%', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20, backgroundColor: mine ? c.accent : c.surface2 }, mine ? boxGlow(c) : null]}>
                      <T s={14} c={mine ? c.onAccent : c.fg} style={{ lineHeight: 20 }}>{item.body}</T>
                    </View>
                  ) : null}
                  <T s={11} c={c.muted} style={{ paddingHorizontal: 6 }}>{timeAgo(item.created_at, t)}</T>
                </Pressable>
              </Arrival>
            );
          }}
        />
        {bad ? <View style={{ paddingHorizontal: 16 }}><ErrorText>{t('messages.offensive')}</ErrorText></View> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingLeft: photosAllowed ? 6 : 16, paddingRight: 10, borderTopWidth: 1, borderTopColor: c.line }}>
          {photosAllowed ? (
            <IconButton label={t('messages.addPhoto')} onPress={sendPhoto}>
              <ImageIcon size={24} color={busy ? c.faint : c.fg} strokeWidth={1.8} />
            </IconButton>
          ) : null}
          <TextInput
            accessibilityLabel={t('messages.placeholder')}
            value={draft}
            onChangeText={setDraft}
            maxLength={500}
            placeholder={t('messages.placeholder')}
            placeholderTextColor={c.muted}
            returnKeyType="send"
            onSubmitEditing={send}
            style={{ flex: 1, minWidth: 0, height: 40, borderWidth: 1, borderColor: c.line, borderRadius: 999, backgroundColor: c.surface, paddingHorizontal: 14, fontSize: 15, color: c.fg }}
          />
          <Animated.View style={{ transform: [{ scale: sendPress }] }}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={send} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
              <T s={15} w="700" c={canSend ? c.fg : c.faint}>{t('messages.send')}</T>
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
