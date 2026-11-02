// Opens a profile from an @mention, which only knows the username.
import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackHeader, Empty, Screen, Spinner } from '../../components/ui';
import { profileIdByUsername } from '../../lib/api';

export default function ByUsername() {
  const { t } = useTranslation();
  const { username = '' } = useLocalSearchParams<{ username: string }>();
  const { data, isLoading } = useQuery({ queryKey: ['username-id', username], queryFn: () => profileIdByUsername(username) });
  if (data) return <Redirect href={`/user/${data}`} />;
  return (
    <Screen>
      <BackHeader />
      {isLoading ? <Spinner /> : <Empty text={t('tags.noUser', { name: username })} />}
    </Screen>
  );
}
