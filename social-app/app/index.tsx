import { View } from 'react-native';
import { Spinner } from '../components/ui';

// Shown for a moment at launch; the router in _layout.tsx moves on from here.
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Spinner />
    </View>
  );
}
