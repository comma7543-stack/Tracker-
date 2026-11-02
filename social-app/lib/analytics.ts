// First-party analytics and crash reports, stored in our own database (see the
// analytics migration). Events are batched and sent every 30 seconds, or when the
// app goes to the background. Nothing here may hold content: no captions, messages,
// names or goals. Ids and small labels only.
import * as Crypto from 'expo-crypto';
import { AppState, Platform } from 'react-native';
import { APP_VERSION, DEMO } from './config';
import { supabase } from './supabase';

type Props = Record<string, string | number | boolean | null>;
type Event = { name: string; props: Props; at: string; session_id: string };

const sessionId = Crypto.randomUUID().slice(0, 36);
let queue: Event[] = [];
let started = false;

const platform = () => (Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web');

/** Names are lower_snake_case, as the database requires. */
export function track(name: string, props: Props = {}) {
  if (DEMO) return;
  queue.push({ name, props, at: new Date().toISOString(), session_id: sessionId });
  if (queue.length >= 40) flush();
}

export async function flush() {
  if (DEMO || queue.length === 0) return;
  const { data } = await supabase.auth.getSession();
  // Signed out: hold events until sign-in, but never let the queue grow without limit.
  if (!data.session) { queue = queue.slice(-100); return; }
  const batch = queue.splice(0, 50);
  const { error } = await supabase.rpc('log_events', { p_events: batch, p_platform: platform(), p_version: APP_VERSION });
  // Rate-limited or offline: put them back once, then drop, so a broken network can't pile up memory.
  if (error && queue.length < 200) queue.unshift(...batch);
}

let currentScreen = '';
export function screenView(path: string) {
  if (path === currentScreen) return;
  currentScreen = path;
  // Route patterns only, never ids: "/post/[id]" not the id itself.
  track('screen_view', { screen: path.replace(/[0-9a-f-]{36}/gi, '[id]').slice(0, 80) });
}

export function reportError(error: unknown, fatal = false) {
  if (DEMO) return;
  const e = error instanceof Error ? error : new Error(String(error));
  supabase.rpc('log_error', {
    p_message: e.message.slice(0, 500), p_stack: (e.stack ?? '').slice(0, 4000), p_screen: currentScreen,
    p_fatal: fatal, p_platform: platform(), p_version: APP_VERSION,
  }).then(() => undefined, () => undefined);
}

/** Call once at startup. */
export function startAnalytics() {
  if (started || DEMO) return;
  started = true;
  track('app_open', { cold: true });
  setInterval(flush, 30_000);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') track('app_open', { cold: false });
    else flush();
  });

  // Crashes outside React's tree, such as in timers and event handlers.
  const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } };
  const previous = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    reportError(e, !!fatal);
    previous?.(e, fatal);
  });
}
