import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AuthScreen, Button, H1, Input, Label, Sub } from '../../components/ui';
import { requestResetForUsername } from '../../lib/api';
import { AUTH_REDIRECT } from '../../lib/config';
import { useSignup } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { toE164, validEmail, validPhone } from '../../lib/validation';

export default function Forgot() {
  const { t } = useTranslation();
  const patch = useSignup((s) => s.patch);
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Coming back from Verify means that reset was abandoned; let the auth router work again.
  useFocusEffect(useCallback(() => { patch({ resetting: false }); }, [patch]));

  // Every path ends on the same screen, so this can't reveal who has an account.
  const send = async () => {
    setBusy(true);
    const v = value.trim();
    if (validEmail(v)) {
      await supabase.auth.resetPasswordForEmail(v, { redirectTo: AUTH_REDIRECT });
    } else if (/^[+\d][\d\s()-]*$/.test(v) && validPhone(v)) {
      const phone = toE164(v);
      await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
      patch({ contact: phone, mode: 'phone', resetting: true });
      setBusy(false);
      router.push('/(auth)/verify');
      return;
    } else {
      await requestResetForUsername(v);
    }
    setBusy(false);
    setSent(true);
  };

  return (
    <AuthScreen>
      {sent ? (
        <>
          <H1>{t('forgot.sentTitle')}</H1>
          <Sub style={{ marginBottom: 24 }}>{t('forgot.sentBody')}</Sub>
          <Button auth label={t('forgot.back')} onPress={() => router.replace('/(auth)/login')} />
        </>
      ) : (
        <>
          <H1>{t('forgot.title')}</H1>
          <Sub>{t('forgot.body')}</Sub>
          <Label>{t('auth.loginId')}</Label>
          <Input accessibilityLabel={t('auth.loginId')} value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} placeholder={t('auth.loginId')} />
          <View style={{ height: 24 }} />
          <Button auth label={t('forgot.send')} disabled={value.trim().length < 3} busy={busy} onPress={send} />
        </>
      )}
      <View style={{ flex: 1, minHeight: 24 }} />
      <Button auth kind="secondary" label={t('auth.newHere')} onPress={() => router.replace('/(auth)/sign-up')} />
    </AuthScreen>
  );
}
