import { CirclePlay, CirclePlus, Image as ImageIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useStartCompose } from '../../lib/hooks';
import { useTheme } from '../../lib/theme';
import { SheetFrame, T } from '../ui';

export function CreateSheet({ onClose }: { onClose: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  const { compose } = useStartCompose();
  const rows = [
    { mode: 'post' as const, Icon: ImageIcon, title: t('create.post'), sub: t('create.postSub') },
    { mode: 'story' as const, Icon: CirclePlus, title: t('create.story'), sub: t('create.storySub') },
    { mode: 'scroll' as const, Icon: CirclePlay, title: t('create.scroll'), sub: t('create.scrollSub') },
  ];
  return (
    <SheetFrame title={t('create.title')} onClose={onClose}>
      {rows.map(({ mode, Icon, title, sub }) => (
        <Pressable key={mode} accessibilityRole="button" onPress={() => compose(mode)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: pressed ? c.surface : 'transparent' })}>
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon size={22} color={c.fg} strokeWidth={1.8} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <T s={15} w="600">{title}</T>
            <T s={13} c={c.muted}>{sub}</T>
          </View>
        </Pressable>
      ))}
    </SheetFrame>
  );
}
