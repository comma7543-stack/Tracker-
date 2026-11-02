import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { AuthScreen, Button, ErrorText, H1, Input, Label, Sub, T } from '../../components/ui';
import { usePasswordForm } from '../../lib/hooks';
import { isBad } from '../../lib/profanity';
import { useSignup } from '../../lib/store';
import { useTheme } from '../../lib/theme';

export default function NamePassword() {
  const c = useTheme();
  const { t } = useTranslation();
  const patch = useSignup((s) => s.patch);
  const [name, setName] = useState('');
  const { pw, setPw, busy, error, save } = usePasswordForm();
  const [show, setShow] = useState(false);
  const nameBad = isBad(name);
  const valid = name.trim().length >= 1 && !nameBad && pw.length >= 8;

  const next = () => save(() => {
    patch({ fullName: name.trim() });
    router.push('/(auth)/birthday');
  });

  return (
    <AuthScreen back={false}>
      <H1>{t('auth.whatsName')}</H1>
      <Sub>{t('auth.nameWhy')}</Sub>
      <Label>{t('auth.fullName')}</Label>
      <Input accessibilityLabel={t('auth.fullName')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={60} placeholder={t('auth.fullName')} />
      {nameBad ? <ErrorText>{t('auth.nameOffensive')}</ErrorText> : null}
      <T s={20} w="700" style={{ marginTop: 32, marginBottom: 8 }}>{t('auth.pickPassword')}</T>
      <Sub style={{ marginBottom: 16 }}>{t('auth.passwordRule')}</Sub>
      <Label>{t('auth.password')}</Label>
      <View>
        <Input accessibilityLabel={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry={!show} autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" placeholder={t('auth.password')} style={{ paddingRight: 72 }} />
        <Pressable accessibilityRole="button" onPress={() => setShow(!show)} style={{ position: 'absolute', right: 6, top: 4, height: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
          <T s={14} w="600">{show ? t('auth.hide') : t('auth.show')}</T>
        </Pressable>
      </View>
      <T s={13} c={c.muted} style={{ marginTop: 8, marginBottom: 24, minHeight: 18 }}>
        {pw.length === 0 ? '' : pw.length < 8 ? t('auth.moreChars', { count: 8 - pw.length }) : t('auth.passwordGood')}
      </T>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button auth label={t('common.next')} disabled={!valid} busy={busy} onPress={next} style={{ marginTop: 8 }} />
    </AuthScreen>
  );
}
