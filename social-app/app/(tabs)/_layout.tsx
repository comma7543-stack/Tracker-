import { Tabs } from 'expo-router';
import { TabBar } from '../../components/TabBar';

export default function TabsLayout() {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...(props as any)} />}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="scrolls" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
