import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { AuthScreen, Button, H1, Input, Label, Sub, T } from '../../components/ui';
import { useUsernameCheck } from '../../lib/hooks';
import { useSignup } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { normalizeUsername, usernameIssue } from '../../lib/validation';

export default function Username() {
  const c = useTheme();
  const { t } = useTranslation();
  const { fullName, patch } = useSignup();
  const [u, setU] = useState('');
  const check = useUsernameCheck(u);

  const suggestion = useMemo(() => {
    const base = fullName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 24) || 'user';
    const candidate = `${base}.${Math.floor(10 + Math.random() * 90)}`;
    return usernameIssue(candidate) ? `user.${Math.floor(1000 + Math.random() * 9000)}` : candidate;
  }, [fullName]);

  return (
    <AuthScreen>
      <H1>{t('username.title')}</H1>
      <Sub>{t('username.why')}</Sub>
      <Label>{t('username.label')}</Label>
      <Input accessibilityLabel={t('username.label')} value={u} onChangeText={(v) => setU(normalizeUsername(v))} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="username" textContentType="username" maxLength={40} placeholder={t('username.label')} />
      <T s={13} c={check.color} style={{ marginTop: 8, marginBottom: 16, lineHeight: 18 }}>{check.note}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
        <T s={13} c={c.muted}>{t('username.suggestion')}</T>
        <Pressable accessibilityRole="button" onPress={() => setU(suggestion)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: c.line, justifyContent: 'center' }}>
          <T s={14} w="600">{suggestion}</T>
        </Pressable>
      </View>
      <Button auth label={t('common.next')} disabled={!check.ok} onPress={() => { patch({ username: u }); router.push('/(auth)/terms'); }} />
    </AuthScreen>
  );
}
