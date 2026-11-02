import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';
import { PostCard } from '../../components/PostCard';
import { BackHeader, Empty, FAST_SCROLL, Screen, Spinner } from '../../components/ui';
import { getPost } from '../../lib/api';

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { data: post, isLoading } = useQuery({ queryKey: ['post', id], queryFn: () => getPost(id) });
  return (
    <Screen>
      <BackHeader title={t('post.title')} />
      <ScrollView {...FAST_SCROLL} contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}>
        {isLoading ? <Spinner /> : post ? <PostCard post={post} playVideo /> : <Empty text={t('post.unavailable')} />}
      </ScrollView>
    </Screen>
  );
}
