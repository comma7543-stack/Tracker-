// Push notifications: registering this phone, and opening the right screen on tap.
// The server decides what to send (see the push migration and send-push).
//
// Remote push needs a development or store build on Android: Expo Go there can't
// receive it. Streak reminders are local and work everywhere.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { track } from './analytics';
import { registerPushToken, unregisterPushToken } from './api';
import { DEMO } from './config';

const TOKEN_KEY = 'push-token';

// Shown while the app is open too, except the badge sound: the app is already in front.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
});

export async function pushPermission() {
  if (DEMO) return 'denied' as const;
  return (await Notifications.getPermissionsAsync()).status;
}

/** Asks only if `ask`; otherwise registers silently when permission was already given. */
export async function registerForPush(ask = false): Promise<boolean> {
  if (DEMO || Platform.OS === 'web') return false;
  let { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && ask && canAskAgain) {
    status = (await Notifications.requestPermissionsAsync()).status;
    track('push_permission', { granted: status === 'granted' });
  }
  if (status !== 'granted') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await registerPushToken(token, Platform.OS);
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return true;
  } catch {
    // No EAS project id yet, or Expo Go on Android. In-app notifications still work.
    return false;
  }
}

/** Before signing out, so the next person on this phone doesn't get these pushes. */
export async function forgetPushToken() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await unregisterPushToken(token);
  await AsyncStorage.removeItem(TOKEN_KEY);
}

type PushData = { type?: string; post_id?: string | null; actor_id?: string | null; conversation_id?: string | null };

export function routeForPush(data: PushData): string | null {
  switch (data.type) {
    case 'message': return data.conversation_id ? `/messages/${data.conversation_id}` : '/messages';
    case 'like': case 'comment': case 'mention': return data.post_id ? `/post/${data.post_id}` : '/notifications';
    case 'follow': case 'follow_request': return '/notifications';
    case 'admin': return '/admin';
    default: return null;
  }
}

const handled = new Set<string>();

/** Opens the screen a tapped push points at, including the tap that launched the app. */
export function usePushTaps(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn || DEMO) return undefined;
    const open = (response: Notifications.NotificationResponse | null) => {
      const id = response?.notification.request.identifier;
      if (!id || handled.has(id)) return;
      handled.add(id);
      const data = response?.notification.request.content.data as PushData | undefined;
      // Local streak reminders carry no type: they just open the app.
      const to = data ? routeForPush(data) : null;
      if (!to) return;
      track('push_opened', { type: data?.type ?? null });
      router.push(to);
    };
    Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [signedIn]);
}
