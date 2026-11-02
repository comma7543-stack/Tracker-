import { ProfileView } from '../../components/ProfileView';
import { useAuth } from '../../lib/store';

export default function MyProfile() {
  const id = useAuth((s) => s.session?.user.id);
  return id ? <ProfileView userId={id} /> : null;
}
