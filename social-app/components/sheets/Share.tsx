import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { followingList, sendMessage, startConversation } from '../../lib/api';
import { toast } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { Avatar, Button, Empty, SheetFrame, T } from '../ui';

export function ShareSheet({ postId, ownerId, onClose }: { postId: string; ownerId: string; onClose: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  const { data = [] } = useQuery({ queryKey: ['following-list'], queryFn: followingList });
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const link = `appname://post/${postId}`;

  const send = async (id: string) => {
    setSent((s) => ({ ...s, [id]: true }));
    try {
      await sendMessage(await startConversation(id), link);
    } catch {
      setSent((s) => ({ ...s, [id]: false }));
      toast(t('messages.notAllowed'));
    }
  };

  return (
    <SheetFrame title={t('share.title')} onClose={onClose}>
      <T s={12} w="600" c={c.muted} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, letterSpacing: 0.7, textTransform: 'uppercase' }}>{t('share.friend')}</T>
      <ScrollView style={{ maxHeight: 280, paddingHorizontal: 16 }}>
        {data.filter((f) => f.id !== ownerId).map((f) => (
          <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 52 }}>
            <Avatar name={f.username} url={f.avatar_url} size={32} />
            <T s={14} w="600" numberOfLines={1} style={{ flex: 1 }}>{f.username}</T>
            <Pressable accessibilityRole="button" disabled={sent[f.id]} onPress={() => send(f.id)} style={{ height: 32, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', backgroundColor: sent[f.id] ? c.surface2 : c.accent }}>
              <T s={13} w="600" c={sent[f.id] ? c.fg : c.onAccent}>{sent[f.id] ? t('share.sent') : t('share.send')}</T>
            </Pressable>
          </View>
        ))}
        {data.length === 0 ? <Empty text={t('share.noFriends')} /> : null}
      </ScrollView>
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <Button kind="secondary" label={copied ? t('share.copied') : t('share.copy')} onPress={async () => { await Clipboard.setStringAsync(link); setCopied(true); }} />
      </View>
    </SheetFrame>
  );
}
