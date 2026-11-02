import { Redirect, useLocalSearchParams } from 'expo-router';
import { ProfileView } from '../../components/ProfileView';
import { myId } from '../../lib/store';

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // This route has no tab bar, and your own profile has no back button, so it would trap you.
  if (id === myId()) return <Redirect href="/(tabs)/profile" />;
  return <ProfileView userId={id} />;
}
