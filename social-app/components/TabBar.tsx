import { router } from 'expo-router';
import { CirclePlay, Home, Plus, Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMe, useStartCompose } from '../lib/hooks';
import { boxGlow, DARK, useTheme } from '../lib/theme';
import { Avatar, IconButton, T } from './ui';

type Props = { state: { index: number; routes: { name: string; key: string }[] } };

export function TabBar({ state }: Props) {
  const c = useTheme();
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const me = useMe().data;
  const { openCreate } = useStartCompose();
  const current = state.routes[state.index]?.name;
  const dark = current === 'scrolls';
  const go = (name: string) => router.navigate(`/(tabs)/${name}`);

  const color = (name: string) => (current === name ? (dark ? DARK.fg : c.activeTab) : dark ? DARK.muted : c.fg);
  const stroke = (name: string) => (current === name ? 2.7 : 1.8);

  return (
    <View
      accessibilityRole="tablist"
      style={[
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', height: 56 + inset.bottom, paddingBottom: inset.bottom, backgroundColor: dark ? DARK.bg : c.bg, borderTopWidth: dark ? 0 : c.cardBorderWidth, borderTopColor: dark ? DARK.bg : c.cardBorderColor },
      ]}
    >
      <IconButton label={t('tabs.home')} onPress={() => go('home')}>
        <Home size={26} color={color('home')} fill={current === 'home' ? color('home') : 'none'} strokeWidth={stroke('home')} />
      </IconButton>
      <IconButton label={t('tabs.search')} onPress={() => go('search')}>
        <Search size={26} color={color('search')} strokeWidth={stroke('search')} />
      </IconButton>
      <IconButton label={t('tabs.create')} onPress={openCreate}>
        <View style={[{ width: 40, height: 32, borderRadius: 999, backgroundColor: dark ? DARK.fg : c.accent, alignItems: 'center', justifyContent: 'center' }, boxGlow(c)]}>
          <Plus size={18} color={dark ? DARK.bg : c.onAccent} strokeWidth={2.6} />
        </View>
      </IconButton>
      <IconButton label={t('tabs.scrolls')} onPress={() => go('scrolls')}>
        <CirclePlay size={26} color={color('scrolls')} strokeWidth={stroke('scrolls')} />
      </IconButton>
      <IconButton label={t('tabs.profile')} onPress={() => go('profile')}>
        <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: current === 'profile' ? c.activeTab : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {me ? <Avatar name={me.username} url={me.avatar_url} size={24} /> : <T s={10} w="700">{t('common.you')}</T>}
        </View>
      </IconButton>
    </View>
  );
}
