import { router } from 'expo-router';
import { ComponentRef, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { AuthScreen, Button, ErrorText, H1, Label, Sub, T } from '../../components/ui';
import { useSignup } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';

export default function Verify() {
  const c = useTheme();
  const { t } = useTranslation();
  const { contact, mode, resetting } = useSignup();
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  const next = async () => {
    setBusy(true);
    setError('');
    const { error: e } = await (mode === 'phone'
      ? supabase.auth.verifyOtp({ phone: contact, token: code, type: 'sms' })
      : supabase.auth.verifyOtp({ email: contact, token: code, type: 'email' }));
    setBusy(false);
    if (e) { setError(t('auth.codeWrong')); return; }
    // The router in _layout.tsx sends a new user on to name and password.
    if (resetting) router.replace('/(auth)/new-password');
  };

  const resend = async () => {
    setError('');
    const { error: e } = await supabase.auth.signInWithOtp(mode === 'phone' ? { phone: contact } : { email: contact });
    if (e) setError(t('auth.codeFailed'));
    else setSent(true);
  };

  return (
    <AuthScreen>
      <H1>{t('auth.checkCode')}</H1>
      <Sub style={{ marginBottom: 24 }}>{t('auth.typeCode')}</Sub>
      <Label>{t('auth.sixDigit')}</Label>
      <Pressable accessibilityLabel={t('auth.sixDigit')} onPress={() => input.current?.focus()} style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const current = i === Math.min(code.length, 5);
          return (
            <View key={i} style={{ flex: 1, height: 56, borderWidth: current ? 2 : 1, borderColor: current ? c.fg : c.line, borderRadius: 12, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
              <T s={24} w="600">{code[i] ?? ''}</T>
            </View>
          );
        })}
        <TextInput
          ref={input}
          autoFocus
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0 }}
        />
      </Pressable>
      <T s={13} c={c.muted} style={{ marginBottom: 24 }}>{sent ? t('auth.newCodeSent') : t('auth.noCodeYet')}</T>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ gap: 10, marginTop: 8 }}>
        <Button auth label={t('common.next')} disabled={code.length !== 6} busy={busy} onPress={next} />
        <Button auth kind="secondary" label={t('auth.resend')} onPress={resend} />
      </View>
    </AuthScreen>
  );
}
