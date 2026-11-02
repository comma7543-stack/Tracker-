import { Link, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AuthScreen, Button, ErrorText, H1, Input, Label, Sub, T } from '../../components/ui';
import { useSignup } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import { toE164, validEmail, validPhone } from '../../lib/validation';

export default function SignUp() {
  const c = useTheme();
  const { t } = useTranslation();
  const patch = useSignup((s) => s.patch);
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isPhone = mode === 'phone';
  const valid = isPhone ? validPhone(value) : validEmail(value);

  const next = async () => {
    setBusy(true);
    setError('');
    const contact = isPhone ? toE164(value) : value.trim();
    const { error: e } = await supabase.auth.signInWithOtp(isPhone ? { phone: contact } : { email: contact });
    setBusy(false);
    if (e) { setError(t('auth.codeFailed')); return; }
    patch({ contact, mode });
    router.push('/(auth)/verify');
  };

  return (
    <AuthScreen>
      <H1>{isPhone ? t('auth.addPhone') : t('auth.addEmail')}</H1>
      <Sub>{t('auth.contactWhy')}</Sub>
      <Label>{isPhone ? t('auth.phone') : t('auth.email')}</Label>
      {isPhone ? (
        <Input accessibilityLabel={t('auth.phone')} value={value} onChangeText={setValue} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+1 (949) 555-0123" />
      ) : (
        <Input accessibilityLabel={t('auth.email')} value={value} onChangeText={setValue} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" />
      )}
      <T s={13} c={c.muted} style={{ marginTop: 10, marginBottom: 20, lineHeight: 18 }}>{isPhone ? t('auth.phoneNote') : t('auth.emailNote')}</T>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ gap: 10, marginTop: 8 }}>
        <Button auth label={t('common.next')} disabled={!valid} busy={busy} onPress={next} />
        <Button auth kind="secondary" label={isPhone ? t('auth.useEmail') : t('auth.usePhone')} onPress={() => { setMode(isPhone ? 'email' : 'phone'); setValue(''); setError(''); }} />
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <T s={14} style={{ textAlign: 'center' }}><Link href="/(auth)/login" style={{ fontWeight: '600', color: c.fg }}>{t('auth.haveAccountLogIn')}</Link></T>
    </AuthScreen>
  );
}
