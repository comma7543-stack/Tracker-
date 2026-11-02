import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useTheme } from '../../lib/theme';
import { Button, SheetFrame, T } from '../ui';

export function SuspendedSheet({ onClose }: { onClose: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  return (
    <SheetFrame onClose={onClose}>
      <View style={{ gap: 12, paddingHorizontal: 20, paddingBottom: 16 }}>
        <T s={20} w="700">{t('suspended.title')}</T>
        <T s={15} c={c.muted} style={{ lineHeight: 22 }}>{t('suspended.body')}</T>
        <Button label={t('settings.status')} onPress={() => { onClose(); router.push('/settings/status'); }} />
      </View>
    </SheetFrame>
  );
}
