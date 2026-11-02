import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AuthScreen, Button, ErrorText, H1, Input, Label, Sub, T } from '../../components/ui';
import { usePasswordForm } from '../../lib/hooks';
import { toast, useSignup } from '../../lib/store';
import { useTheme } from '../../lib/theme';

export default function NewPassword() {
  const c = useTheme();
  const { t } = useTranslation();
  const { pw, setPw, busy, error, save } = usePasswordForm();

  const done = () => {
    useSignup.getState().patch({ resetting: false });
    toast(t('settings.passwordChanged'));
    router.replace('/(tabs)/home');
  };

  return (
    <AuthScreen back={false}>
      <H1>{t('settings.changePassword')}</H1>
      <Sub>{t('auth.passwordRule')}</Sub>
      <Label>{t('auth.password')}</Label>
      <Input accessibilityLabel={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" placeholder={t('auth.password')} />
      <T s={13} c={c.muted} style={{ marginTop: 8, marginBottom: 24, minHeight: 18 }}>
        {pw.length === 0 ? '' : pw.length < 8 ? t('auth.moreChars', { count: 8 - pw.length }) : t('auth.passwordGood')}
      </T>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button auth label={t('common.save')} disabled={pw.length < 8} busy={busy} onPress={() => save(done)} />
    </AuthScreen>
  );
}
