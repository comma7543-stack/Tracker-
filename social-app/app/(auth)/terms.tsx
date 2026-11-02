import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AuthScreen, Button, ErrorText, H1, Sub, T } from '../../components/ui';
import { completeSignup, getMyProfile, saveChoice } from '../../lib/api';
import { PRIVACY_URL, TERMS_URL } from '../../lib/config';
import { errorText } from '../../lib/format';
import { deviceLanguage } from '../../lib/i18n';
import { useAuth, useCommitment, useSignup } from '../../lib/store';
import { useTheme } from '../../lib/theme';

export default function Terms() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { fullName, username, dob } = useSignup();
  const session = useAuth((s) => s.session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const agree = async () => {
    setBusy(true);
    setError('');
    try {
      const name = fullName || session?.user.user_metadata?.full_name || username;
      await completeSignup(String(name).slice(0, 60), username, dob, useCommitment.getState().goal);
      // Account settings start in the device's language. The account exists by now, so a
      // failure here must not show an error: trying again would say the username is taken.
      await saveChoice('lang', deviceLanguage()).catch(() => undefined);
      // Waits for the profile, so tapping Continue on Done can't beat it and restart sign-up.
      qc.setQueryData(['me', session?.user.id], await getMyProfile());
      router.replace('/(auth)/done');
    } catch (e) {
      const message = errorText(e);
      setError(message.includes('username_taken') ? t('auth.usernameTaken') : message.includes('under_13') ? t('auth.tooYoung') : t('common.tryAgain'));
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <H1>{t('terms.title')}</H1>
      <Sub>{t('terms.intro')}</Sub>
      <View style={{ gap: 14, padding: 16, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, marginBottom: 20 }}>
        <T s={14} w="600">{t('terms.canPost')}</T>
        <T s={14} style={{ lineHeight: 20 }}>{t('terms.canPostBody')}</T>
        <T s={14} w="600" style={{ marginTop: 4 }}>{t('terms.never')}</T>
        <T s={14} style={{ lineHeight: 20 }}>{t('terms.neverBody')}</T>
        <T s={14} style={{ lineHeight: 20 }}>{t('terms.strikes')}</T>
        <T s={14} style={{ lineHeight: 20 }}>{t('terms.age')}</T>
      </View>
      <T s={13} c={c.muted} style={{ lineHeight: 20, marginBottom: 24 }}>{t('terms.read', { terms: TERMS_URL, privacy: PRIVACY_URL })}</T>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button auth label={t('terms.agree')} busy={busy} onPress={agree} style={{ marginTop: 8 }} />
    </AuthScreen>
  );
}
