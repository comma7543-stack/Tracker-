// A streak card to post to stories on other apps. It's how people bring friends here,
// so it shows the number big and the app name clearly.
import { ComponentRef, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { StreakFlame } from '../components/StreakFlame';
import { BackHeader, Button, Screen, T } from '../components/ui';
import { APP_NAME } from '../lib/config';
import { useMe, useMyStreak } from '../lib/hooks';
import { toast, useSettings } from '../lib/store';
import { shareImage } from '../lib/share';
import { effectiveStreak, isFrozen, localDate } from '../lib/streak';
import { DARK, flamePalette, useTheme } from '../lib/theme';

export default function ShareStreak() {
  const { t } = useTranslation();
  const c = useTheme();
  const me = useMe().data;
  const streak = useMyStreak();
  const autoFreeze = useSettings((s) => s.prefs.autoFreeze);
  const today = localDate();
  const count = streak ? effectiveStreak(streak, today, autoFreeze) : 0;
  const frozen = !!streak && isFrozen(streak, today, autoFreeze);
  const card = useRef<ComponentRef<typeof View>>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' });
      if (!(await shareImage(uri, 'streak_card'))) toast(t('growth.shareUnavailable'));
    } catch {
      toast(t('common.tryAgain'));
    }
    setBusy(false);
  };

  return (
    <Screen>
      <BackHeader title={t('growth.shareStreak')} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <View
          ref={card}
          collapsable={false}
          accessible
          accessibilityLabel={t('growth.cardLabel', { count, name: me?.username ?? '' })}
          style={{ width: '82%', aspectRatio: 9 / 16, borderRadius: 24, backgroundColor: DARK.bg, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 36, paddingHorizontal: 20 }}
        >
          <T s={20} w="700" c={DARK.fg}>{APP_NAME}</T>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <StreakFlame count={count} frozen={frozen} size={120} />
            <T s={72} w="800" c={flamePalette(count, frozen).outer} style={{ lineHeight: 80 }}>{count}</T>
            <T s={14} w="700" c={DARK.muted} style={{ letterSpacing: 1.4, textTransform: 'uppercase' }}>{t('streak.dayStreak')}</T>
            {streak && streak.best > count ? <T s={13} c={DARK.muted} style={{ marginTop: 8 }}>{t('growth.best', { count: streak.best })}</T> : null}
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <T s={16} w="600" c={DARK.fg}>{me?.username ?? ''}</T>
            <T s={13} c={DARK.muted}>{t('auth.tagline')}</T>
          </View>
        </View>
      </View>
      <View style={{ padding: 16, gap: 8 }}>
        <Button label={t('growth.shareCard')} busy={busy} onPress={share} />
        <T s={12} c={c.muted} style={{ textAlign: 'center' }}>{t('growth.cardNote')}</T>
      </View>
    </Screen>
  );
}
