import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';
import { AuthScreen, Button, H1, Label, Sub, T } from '../../components/ui';
import { useSignup } from '../../lib/store';
import { localDate } from '../../lib/streak';
import { useTheme } from '../../lib/theme';
import { ageFrom, canSignUp } from '../../lib/validation';

export default function Birthday() {
  const c = useTheme();
  const { t } = useTranslation();
  const patch = useSignup((s) => s.patch);
  const [date, setDate] = useState<Date | null>(null);
  const [picking, setPicking] = useState(false);
  const iso = date ? localDate(date) : '';
  const age = ageFrom(iso);
  const tooYoung = age !== null && age < 13;

  return (
    <AuthScreen back={false}>
      <H1>{t('auth.whenBorn')}</H1>
      <Sub>{t('auth.birthdayPrivate')}</Sub>
      <Label>{age === null ? t('auth.birthday') : t('auth.birthdayAge', { age })}</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('auth.birthday')}
        onPress={() => setPicking(true)}
        style={{ height: 52, borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: 'center' }}
      >
        <T s={16} c={iso ? c.fg : c.muted}>{iso || t('auth.chooseDate')}</T>
      </Pressable>
      {picking ? (
        <DateTimePicker
          value={date ?? new Date(2008, 0, 1)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={(_e, picked) => {
            if (Platform.OS !== 'ios') setPicking(false);
            if (picked) setDate(picked);
          }}
        />
      ) : null}
      {tooYoung ? (
        <View accessibilityRole="alert" style={{ marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: c.surface2 }}>
          <T s={14} style={{ lineHeight: 20 }}>{t('auth.tooYoung')}</T>
        </View>
      ) : null}
      <T s={13} c={c.muted} style={{ marginTop: 12, marginBottom: 24, lineHeight: 18 }}>{t('auth.ageWhy')}</T>
      <Button
        auth
        label={t('common.next')}
        disabled={!canSignUp(age)}
        onPress={() => { patch({ dob: iso }); router.push('/(auth)/username'); }}
      />
    </AuthScreen>
  );
}
