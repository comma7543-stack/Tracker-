// After sign-up: which topics to see first. Optional, and changeable later in Discover.
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { TopicPicker } from '../../components/TopicPicker';
import { AuthScreen, Button, H1, Sub } from '../../components/ui';
import { setInterests } from '../../lib/api';
import { track } from '../../lib/analytics';

export default function Interests() {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const next = async () => {
    setBusy(true);
    // Not worth blocking sign-up over: Discover can set these again.
    await setInterests(picked).catch(() => undefined);
    track('interests_set', { count: picked.length });
    router.replace('/(auth)/people');
  };

  return (
    <AuthScreen back={false}>
      <H1>{t('discover.interestsTitle')}</H1>
      <Sub>{t('discover.interestsBody')}</Sub>
      <TopicPicker value={picked} onChange={setPicked} />
      <View style={{ gap: 8, marginTop: 28 }}>
        <Button auth label={picked.length ? t('common.next') : t('discover.skip')} busy={busy} onPress={next} />
      </View>
    </AuthScreen>
  );
}
