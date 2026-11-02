import { router } from 'expo-router';
import { UserRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Screen, T } from '../../components/ui';
import { useTheme } from '../../lib/theme';

export default function Done() {
  const c = useTheme();
  const { t } = useTranslation();
  return (
    <Screen bottom style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 32 }}>
      <View style={{ height: 96 }} />
      <View style={{ alignItems: 'center', gap: 14 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <UserRound size={44} color={c.muted} strokeWidth={1.6} />
        </View>
        <T s={26} w="700" accessibilityRole="header" style={{ marginTop: 6, textAlign: 'center' }}>{t('done.title')}</T>
        <T s={15} c={c.muted} style={{ textAlign: 'center', maxWidth: 300, lineHeight: 22 }}>{t('done.body')}</T>
      </View>
      <Button auth label={t('done.continue')} onPress={() => router.replace('/(tabs)/home')} />
    </Screen>
  );
}
