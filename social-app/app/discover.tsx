// People to support, and the topics that shape For you.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SuggestedPeopleList } from '../components/SuggestedPeople';
import { TopicPicker } from '../components/TopicPicker';
import { BackHeader, Screen, T } from '../components/ui';
import { myInterests, setInterests } from '../lib/api';
import { toast } from '../lib/store';
import { useTheme } from '../lib/theme';

export default function Discover() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: saved } = useQuery({ queryKey: ['interests'], queryFn: myInterests });
  const [picked, setPicked] = useState<string[] | null>(null);
  useEffect(() => { if (saved && picked === null) setPicked(saved); }, [saved, picked]);

  const change = (next: string[]) => {
    setPicked(next);
    setInterests(next).then(() => {
      qc.invalidateQueries({ queryKey: ['for-you'] });
      qc.invalidateQueries({ queryKey: ['suggested-people'] });
      qc.invalidateQueries({ queryKey: ['scrolls'] });
    }, () => toast(t('common.tryAgain')));
  };

  return (
    <Screen>
      <BackHeader title={t('discover.title')} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        <T s={15} w="700">{t('discover.yourTopics')}</T>
        <T s={13} c={c.muted} style={{ lineHeight: 18 }}>{t('discover.yourTopicsBody')}</T>
        <TopicPicker value={picked ?? []} onChange={change} />
        <View style={{ height: 12 }} />
        <T s={15} w="700">{t('discover.suggested')}</T>
        <SuggestedPeopleList from="discover" />
      </ScrollView>
    </Screen>
  );
}
