import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';
import { DEMO } from './config';
import { demoFetch } from './demo';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// A placeholder keeps the app bootable before .env exists; every request then
// fails with a network error instead of crashing on launch.
if (!DEMO && (!url || !anonKey)) console.warn('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. See README.');

export const supabase = createClient(DEMO ? 'https://demo.invalid' : url ?? 'https://not-configured.invalid', anonKey ?? 'not-configured', {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  ...(DEMO ? { global: { fetch: demoFetch } } : {}),
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** Reads the tokens from an auth redirect (OAuth, password reset) and signs in. */
export async function sessionFromUrl(link: string) {
  const fragment = link.split('#')[1] ?? link.split('?')[1] ?? '';
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  return data.session;
}

export async function signInWithProvider(provider: 'apple' | 'google') {
  if (DEMO) return (await supabase.auth.signInWithPassword({ email: 'demo@example.com', password: 'demo' })).data.session;
  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return null;
  return sessionFromUrl(result.url);
}
