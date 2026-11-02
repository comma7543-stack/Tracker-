// After sign-up: a few people to support, so Home isn't empty on day one.
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SuggestedPeopleList } from '../../components/SuggestedPeople';
import { AuthScreen, Button, H1, Sub } from '../../components/ui';

export default function People() {
  const { t } = useTranslation();
  return (
    <AuthScreen back={false}>
      <H1>{t('discover.peopleTitle')}</H1>
      <Sub>{t('discover.peopleBody')}</Sub>
      <SuggestedPeopleList from="onboarding" />
      <Button auth label={t('common.next')} onPress={() => router.replace('/(auth)/done')} style={{ marginTop: 24 }} />
    </AuthScreen>
  );
}
