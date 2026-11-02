import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Heart, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, TextInput, View } from 'react-native';
import { addComment, deleteComment, editComment, getComments, setCommentLiked } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useMe } from '../../lib/hooks';
import { isBad } from '../../lib/profanity';
import { myId, toast, useSettings, useUI } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { CommentCard } from '../../lib/types';
import { Avatar, Empty, ErrorText, FAST_SCROLL, IconButton, SheetFrame, T } from '../ui';

function CommentRow({ c, small, onReply, onLongPress, onProfile }: { c: CommentCard; small?: boolean; onReply: () => void; onLongPress: () => void; onProfile: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [liked, setLiked] = useState(c.liked_by_me);
  const [count, setCount] = useState(c.like_count);
  const toggle = () => {
    const next = !liked;
    setLiked(next);
    setCount((n) => n + (next ? 1 : -1));
    setCommentLiked(c.id, next).catch(() => { setLiked(!next); setCount((n) => n + (next ? -1 : 1)); });
  };
  return (
    <Pressable onLongPress={onLongPress} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={c.username} hitSlop={6} onPress={onProfile} onLongPress={onLongPress}>
        <Avatar name={c.username} url={c.avatar_url} size={small ? 26 : 32} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={c.username} hitSlop={6} onPress={onProfile} onLongPress={onLongPress} style={{ flexShrink: 1 }}>
            <T s={13} w="600" numberOfLines={1}>{c.username}</T>
          </Pressable>
          <T s={13} c={theme.muted}>{timeAgo(c.created_at, t)}{c.edited_at ? ` · ${t('comments.edited')}` : ''}</T>
        </View>
        <T s={14} style={{ lineHeight: 20 }}>{c.body}</T>
        <Pressable accessibilityRole="button" onPress={onReply} style={{ paddingVertical: 6, alignSelf: 'flex-start' }}><T s={12} w="600" c={theme.muted}>{t('comments.reply')}</T></Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={liked ? t('comments.unlike') : t('comments.like')}
        accessibilityState={{ selected: liked }}
        onPress={toggle}
        style={{ width: 44, minHeight: 44, alignItems: 'center', gap: 2, paddingTop: 2 }}
      >
        <Heart size={16} color={theme.fg} fill={liked ? theme.fg : 'none'} strokeWidth={2} />
        <T s={11} w="600">{count}</T>
      </Pressable>
    </Pressable>
  );
}

export function CommentsSheet({ postId, onClose }: { postId: string; onClose: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const open = useUI((s) => s.open);
  const hideOffensive = useSettings((s) => s.prefs.hideOffensive);
  const me = useMe().data;
  const { data = [] } = useQuery({ queryKey: ['comments', postId], queryFn: () => getComments(postId) });
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ parent: string; name: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const shown = hideOffensive ? data.filter((x) => !isBad(x.body) || x.author_id === myId()) : data;
  const top = shown.filter((x) => !x.parent_id);
  const repliesOf = (id: string) => shown.filter((x) => x.parent_id === id);
  const bad = isBad(draft);
  const canSend = draft.trim().length > 0 && !bad && !busy;

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      if (editingId) await editComment(editingId, draft.trim());
      else await addComment(postId, draft.trim(), replyTo?.parent ?? null);
      setEditingId(null);
      if (replyTo) setExpanded((e) => ({ ...e, [replyTo.parent]: true }));
      setDraft('');
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ['comments', postId] });
    } catch {
      toast(t('comments.notAllowed'));
    }
    setBusy(false);
  };

  const menu = (x: CommentCard) => {
    if (x.author_id === myId()) {
      const confirmDelete = () => Alert.alert(t('comments.deleteTitle'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => deleteComment(x.id).then(() => qc.invalidateQueries({ queryKey: ['comments', postId] })) },
      ]);
      Alert.alert(t('comments.yours'), undefined, [
        { text: t('comments.edit'), onPress: () => { setReplyTo(null); setEditingId(x.id); setDraft(x.body); } },
        { text: t('common.delete'), style: 'destructive', onPress: confirmDelete },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
    } else {
      open({ type: 'report', target: { type: 'comment', id: x.id } });
    }
  };

  const openProfile = (x: CommentCard) => {
    onClose();
    router.push(`/user/${x.author_id}`);
  };

  const reply = (x: CommentCard, parent: string) => {
    setEditingId(null);
    setReplyTo({ parent, name: x.username });
    setDraft(`@${x.username} `);
  };

  return (
    <SheetFrame title={t('comments.title')} onClose={onClose} height={600}>
      <FlatList
        {...FAST_SCROLL}
        style={{ flex: 1 }}
        data={top}
        keyExtractor={(x) => x.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 18 }}
        ListEmptyComponent={<Empty text={t('comments.empty')} />}
        renderItem={({ item }) => {
          const replies = repliesOf(item.id);
          const isOpen = !!expanded[item.id];
          return (
            <View style={{ gap: 8 }}>
              <CommentRow c={item} onReply={() => reply(item, item.id)} onLongPress={() => menu(item)} onProfile={() => openProfile(item)} />
              {replies.length > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => setExpanded((e) => ({ ...e, [item.id]: !isOpen }))} style={{ marginLeft: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                  <View style={{ width: 24, height: 1, backgroundColor: c.faint }} />
                  <T s={12} w="600" c={c.muted}>{isOpen ? t('comments.hideReplies') : t('comments.viewReplies', { count: replies.length })}</T>
                </Pressable>
              ) : null}
              {isOpen ? (
                <View style={{ gap: 12, paddingLeft: 42 }}>
                  {replies.map((r) => <CommentRow key={r.id} c={r} small onReply={() => reply(r, item.id)} onLongPress={() => menu(r)} onProfile={() => openProfile(r)} />)}
                </View>
              ) : null}
            </View>
          );
        }}
      />
      {editingId ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40, paddingLeft: 16, paddingRight: 4, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line }}>
          <T s={13} c={c.muted}>{t('comments.editing')}</T>
          <IconButton label={t('comments.cancelEdit')} onPress={() => { setEditingId(null); setDraft(''); }}><X size={16} color={c.fg} strokeWidth={2} /></IconButton>
        </View>
      ) : null}
      {replyTo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40, paddingLeft: 16, paddingRight: 4, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line }}>
          <T s={13} c={c.muted}>{t('comments.replyingTo')} <T s={13} w="600">{replyTo.name}</T></T>
          <IconButton label={t('comments.cancelReply')} onPress={() => { setReplyTo(null); setDraft(''); }}><X size={16} color={c.fg} strokeWidth={2} /></IconButton>
        </View>
      ) : null}
      {bad ? <View style={{ paddingHorizontal: 16 }}><ErrorText>{t('comments.offensive')}</ErrorText></View> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingLeft: 16, paddingRight: 10, borderTopWidth: 1, borderTopColor: c.line }}>
        <Avatar name={me?.username} url={me?.avatar_url} size={32} />
        <TextInput
          accessibilityLabel={t('comments.write')}
          value={draft}
          onChangeText={setDraft}
          maxLength={300}
          placeholder={replyTo ? t('comments.replyPlaceholder', { name: replyTo.name }) : t('comments.write')}
          placeholderTextColor={c.muted}
          returnKeyType="send"
          onSubmitEditing={submit}
          style={{ flex: 1, minWidth: 0, height: 40, borderWidth: 1, borderColor: c.line, borderRadius: 999, backgroundColor: c.surface, paddingHorizontal: 14, fontSize: 15, color: c.fg }}
        />
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={submit} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
          <T s={15} w="700" c={canSend ? c.fg : c.faint}>{editingId ? t('common.save') : t('comments.post')}</T>
        </Pressable>
      </View>
    </SheetFrame>
  );
}
