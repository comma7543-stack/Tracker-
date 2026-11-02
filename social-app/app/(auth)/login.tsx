import { Link, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AuthScreen, Button, ErrorText, Input, Logo, T } from '../../components/ui';
import { logInWithUsername } from '../../lib/api';
import { APP_NAME } from '../../lib/config';
import { signInWithProvider, supabase } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import { toE164, validEmail, validPhone } from '../../lib/validation';

export default function Login() {
  const c = useTheme();
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const logIn = async () => {
    setBusy(true);
    setError('');
    const value = id.trim();
    try {
      if (validEmail(value)) {
        const { error: e } = await supabase.auth.signInWithPassword({ email: value, password: pw });
        if (e) throw e;
      } else if (/^[+\d][\d\s()-]*$/.test(value) && validPhone(value)) {
        const { error: e } = await supabase.auth.signInWithPassword({ phone: toE164(value), password: pw });
        if (e) throw e;
      } else {
        await logInWithUsername(value, pw);
      }
    } catch {
      setError(t('auth.loginFailed'));
      setBusy(false);
    }
  };

  const social = async (provider: 'apple' | 'google') => {
    setError('');
    try {
      await signInWithProvider(provider);
    } catch {
      setError(t('auth.socialFailed'));
    }
  };

  return (
    <AuthScreen>
      <View style={{ alignItems: 'center', gap: 10, marginTop: 24, marginBottom: 32 }}>
        <Logo size={64} />
        <T s={22} w="700">{APP_NAME}</T>
      </View>
      <View style={{ gap: 10 }}>
        <Input accessibilityLabel={t('auth.loginId')} value={id} onChangeText={setId} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" placeholder={t('auth.loginId')} />
        <Input accessibilityLabel={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" placeholder={t('auth.password')} />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button auth label={t('auth.logIn')} disabled={!id.trim() || !pw} busy={busy} onPress={logIn} style={{ marginTop: 6 }} />
        <Link href="/(auth)/forgot" style={{ alignSelf: 'center', fontSize: 14, fontWeight: '600', padding: 10, color: c.fg }}>{t('auth.forgot')}</Link>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8, marginBottom: 18 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
        <T s={13} w="600" c={c.muted}>{t('common.or')}</T>
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      </View>
      <View style={{ gap: 10 }}>
        <Button auth kind="secondary" label={t('auth.apple')} onPress={() => social('apple')} />
        <Button auth kind="secondary" label={t('auth.google')} onPress={() => social('google')} />
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <Button auth kind="secondary" label={t('auth.newHere')} onPress={() => router.replace('/(auth)/sign-up')} />
    </AuthScreen>
  );
}
