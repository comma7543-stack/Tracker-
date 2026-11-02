import '../lib/i18n';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GlobalSheets, Toast } from '../components/Sheets';
import { getSettings, syncTimezone } from '../lib/api';
import { DEMO } from '../lib/config';
import { useDailyLimit, useMe, useMyStreak } from '../lib/hooks';
import { applyLanguage, deviceLanguage } from '../lib/i18n';
import { scheduleStreakReminders } from '../lib/reminders';
import { DEFAULT_CHOICES, DEFAULT_PREFS, useAuth, useCommitment, useSettings, useSignup } from '../lib/store';
import { sessionFromUrl, supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

const ONBOARDING = ['name-password', 'birthday', 'username', 'terms', 'done'];

function useAuthRouting() {
  const session = useAuth((s) => s.session);
  const ready = useAuth((s) => s.ready);
  const resetting = useSignup((s) => s.resetting);
  const segments = useSegments() as string[];
  const me = useMe();
  const committed = useCommitment((s) => s.done);

  useEffect(() => {
    if (!ready || resetting) return;
    const inAuth = segments[0] === '(auth)';
    const screen = segments[1] ?? '';

    if (!session) {
      if (!committed) {
        if (screen !== 'commitment') router.replace('/(auth)/commitment');
      } else if (!inAuth) {
        router.replace('/(auth)/welcome');
      }
      return;
    }
    // "No profile" isn't an answer while a newer one is on its way.
    if ((me.isFetching && !me.data) || me.isError) return;

    if (!me.data) {
      // Signed in but not finished signing up. Apple and Google skip name and password.
      const provider = session.user.app_metadata?.provider;
      if (!ONBOARDING.includes(screen)) router.replace(provider === 'apple' || provider === 'google' ? '/(auth)/birthday' : '/(auth)/name-password');
    } else if ((inAuth && screen !== 'done' && screen !== 'terms') || segments.length === 0) {
      router.replace('/(tabs)/home');
    }
  }, [ready, resetting, session, me.isFetching, me.isError, me.data, segments, committed]);
}

function useSession() {
  const setSession = useAuth((s) => s.set);
  // Waits for the saved answers, so the auth router knows whether to ask the questions.
  const hydrated = useCommitment((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) return undefined;
    supabase.auth.getSession().then(async ({ data }) => {
      if (DEMO) {
        // Demo mode opens signed in once the questions are done. Log out in demo mode asks them again.
        if (!useCommitment.getState().done) {
          if (data.session) await supabase.auth.signOut({ scope: 'local' });
          return setSession(null);
        }
        if (!data.session) return setSession((await supabase.auth.signInWithPassword({ email: 'demo@example.com', password: 'demo' })).data.session);
      }
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Covers log out, account deletion and expired sessions. The next person on this
      // phone must not inherit this goal, which sign-up would publish, or these settings.
      if (event === 'SIGNED_OUT') {
        useCommitment.getState().reset();
        useSettings.setState({ prefs: DEFAULT_PREFS, choices: DEFAULT_CHOICES });
      }
      setSession(session);
    });
    return () => data.subscription.unsubscribe();
  }, [setSession, hydrated]);
}

// Password-reset links arrive here from outside the app.
function useResetLinks() {
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url || !url.includes('type=recovery')) return;
      useSignup.getState().patch({ resetting: true });
      if (await sessionFromUrl(url)) router.replace('/(auth)/new-password');
      else useSignup.getState().patch({ resetting: false });
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);
}

/** Loads the settings row into the local cache once signed in, and applies language and reminders. */
function useSettingsSync() {
  const me = useMe().data;
  const streak = useMyStreak();
  const hydrate = useSettings((s) => s.hydrate);
  const remind = useSettings((s) => `${s.prefs.streakRemind}|${s.prefs.pauseAll}|${s.choices.reminderTime}`);
  const lang = useSettings((s) => s.choices.lang);
  const { data } = useQuery({ queryKey: ['settings', me?.id], enabled: !!me, queryFn: getSettings });

  useEffect(() => {
    if (data) hydrate(data.prefs, data.choices);
  }, [data, hydrate]);

  useEffect(() => {
    if (me) syncTimezone();
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    applyLanguage(lang || deviceLanguage());
  }, [lang]);

  useEffect(() => {
    if (me) scheduleStreakReminders(streak).catch(() => {});
  }, [me?.id, streak?.last_post_date, remind]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Root() {
  const c = useTheme();
  useSession();
  useResetLinks();
  useAuthRouting();
  useSettingsSync();
  useDailyLimit();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={c.glow ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="compose" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="story/[userId]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      </Stack>
      <GlobalSheets />
      <Toast />
    </View>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
