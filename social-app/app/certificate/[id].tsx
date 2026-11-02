import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Award } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, ScrollView, Share, View } from 'react-native';
import { BackHeader, Button, Empty, Screen, T } from '../../components/ui';
import { getCertificate, getProfile } from '../../lib/api';
import { useReduceMotion } from '../../lib/hooks';
import { myId } from '../../lib/store';
import { CERTIFICATE } from '../../lib/theme';

export default function Certificate() {
  const { t, i18n } = useTranslation();
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const reduceMotion = useReduceMotion();
  const { data: certificate, isLoading } = useQuery({ queryKey: ['certificate', id], queryFn: () => getCertificate(id) });
  const { data: owner } = useQuery({ queryKey: ['profile', certificate?.user_id], enabled: !!certificate, queryFn: () => getProfile(certificate!.user_id) });
  const justEarned = isNew === '1' && !reduceMotion;
  const reveal = useRef(new Animated.Value(justEarned ? 0 : 1)).current;

  useEffect(() => {
    if (justEarned && certificate) Animated.spring(reveal, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, [justEarned, !!certificate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLoading && !certificate) {
    return (
      <Screen>
        <BackHeader />
        <Empty text={t('certificate.unavailable')} />
      </Screen>
    );
  }

  const mine = certificate?.user_id === myId();
  const date = certificate ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date(certificate.finished_at)) : '';

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {isNew === '1' ? <T s={16} w="700" style={{ textAlign: 'center', paddingBottom: 4 }} accessibilityLiveRegion="polite">{t('certificate.congrats')}</T> : null}
        <Animated.View
          style={{
            opacity: reveal, transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
            backgroundColor: CERTIFICATE.paper, borderRadius: 6, borderWidth: 2, borderColor: CERTIFICATE.gold, padding: 6,
          }}
        >
          <View style={{ borderWidth: 1, borderColor: CERTIFICATE.gold, borderRadius: 3, paddingVertical: 32, paddingHorizontal: 20, alignItems: 'center', gap: 14 }}>
            <Award size={56} color={CERTIFICATE.gold} strokeWidth={1.4} />
            <T s={22} w="800" c={CERTIFICATE.ink} accessibilityRole="header" style={{ textAlign: 'center' }}>{t('certificate.title')}</T>
            <View style={{ width: 60, height: 2, backgroundColor: CERTIFICATE.gold }} />
            <T s={14} c={CERTIFICATE.muted}>{t('certificate.certifies')}</T>
            <T s={24} w="700" c={CERTIFICATE.ink} style={{ textAlign: 'center' }}>{owner?.full_name}</T>
            <T s={14} c={CERTIFICATE.muted}>{t('certificate.reached')}</T>
            <T s={20} w="700" c={CERTIFICATE.ink} style={{ textAlign: 'center', lineHeight: 26 }}>{certificate?.goal}</T>
            <T s={14} c={CERTIFICATE.muted} style={{ paddingTop: 8 }}>{date}</T>
            {certificate?.streak ? <T s={13} w="600" c={CERTIFICATE.gold}>{t('certificate.streak', { count: certificate.streak })}</T> : null}
            <T s={12} c={CERTIFICATE.muted} style={{ textAlign: 'center', lineHeight: 16, paddingTop: 8 }}>{t('certificate.checked')}</T>
          </View>
        </Animated.View>
        {certificate?.post_id ? <Button kind="secondary" label={t('certificate.watch')} onPress={() => router.push(`/post/${certificate.post_id}`)} style={{ marginTop: 4 }} /> : null}
        <Button kind="secondary" label={t('certificate.share')} onPress={() => Share.share({ message: `appname://certificate/${id}` })} />
        {mine && isNew === '1' ? <Button label={t('certificate.nextGoal')} onPress={() => router.replace('/edit-profile')} /> : null}
      </ScrollView>
    </Screen>
  );
}
