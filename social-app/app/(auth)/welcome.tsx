import { Link, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ErrorText, Button, Logo, Screen, T } from '../../components/ui';
import { APP_NAME } from '../../lib/config';
import { signInWithProvider } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';

export default function Welcome() {
  const c = useTheme();
  const { t } = useTranslation();
  const [error, setError] = useState('');

  const social = async (provider: 'apple' | 'google') => {
    setError('');
    try {
      await signInWithProvider(provider);
    } catch {
      setError(t('auth.socialFailed'));
    }
  };

  return (
    <Screen bottom style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 32 }}>
      <View style={{ height: 96 }} />
      <View style={{ alignItems: 'center', gap: 16 }}>
        <Logo />
        <T s={30} w="700" style={{ letterSpacing: -0.3 }}>{APP_NAME}</T>
        <T s={16} c={c.muted}>{t('auth.tagline')}</T>
      </View>
      <View style={{ gap: 10 }}>
        <Button auth label={t('auth.getStarted')} onPress={() => router.push('/(auth)/sign-up')} />
        <Button auth kind="secondary" label={t('auth.apple')} onPress={() => social('apple')} />
        <Button auth kind="secondary" label={t('auth.google')} onPress={() => social('google')} />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <T s={14} c={c.muted} style={{ textAlign: 'center', marginTop: 14 }}>
          {t('auth.haveAccount')} <Link href="/(auth)/login" style={{ fontWeight: '600', color: c.fg }}>{t('auth.logIn')}</Link>
        </T>
      </View>
    </Screen>
  );
}
