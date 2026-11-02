import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, AppState } from 'react-native';
import { accountStatus, getMyProfile, getStreak, saveChoice, savePref, usernameAvailable } from './api';
import i18n from './i18n';
import { Choices, Prefs, toast, useAuth, useSettings, useUI } from './store';
import { localDate } from './streak';
import { supabase } from './supabase';
import { useTheme } from './theme';
import { usernameIssue } from './validation';

export function useMe() {
  const id = useAuth((s) => s.session?.user.id);
  return useQuery({ queryKey: ['me', id], enabled: !!id, queryFn: getMyProfile });
}

export function useMyStreak() {
  const id = useAuth((s) => s.session?.user.id);
  return useQuery({ queryKey: ['streak', id], enabled: !!id, queryFn: () => getStreak(id as string) }).data ?? null;
}

function useStatus() {
  const id = useAuth((s) => s.session?.user.id);
  return useQuery({ queryKey: ['status', id], enabled: !!id, queryFn: accountStatus }).data;
}

/** Re-renders on an interval, for countdowns. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useUpdateSettings() {
  const failed = () => toast(i18n.t('common.tryAgain'));
  return {
    setPref: (k: keyof Prefs, v: boolean) => { useSettings.getState().setPref(k, v); savePref(k, v).catch(failed); },
    setChoice: (k: keyof Choices, v: string) => { useSettings.getState().setChoice(k, v); saveChoice(k, v).catch(failed); },
  };
}

/** The "Reduce motion" setting or the device's own accessibility setting. */
export function useReduceMotion() {
  const setting = useSettings((s) => s.prefs.reduceMotion);
  const [os, setOs] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setOs);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOs);
    return () => sub.remove();
  }, []);
  return setting || os;
}

export function useStartCompose() {
  const status = useStatus();
  const open = useUI((s) => s.open);
  const close = useUI((s) => s.close);
  return {
    openCreate: () => open(status?.suspended ? { type: 'suspended' } : { type: 'create' }),
    compose: (mode: 'post' | 'story' | 'scroll', proof = false) => {
      if (status?.suspended) { open({ type: 'suspended' }); return; }
      close();
      router.push({ pathname: '/compose', params: { mode, proof: proof ? '1' : '' } });
    },
  };
}

export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

const LIMIT_MINUTES: Record<string, number> = { '15 min': 15, '30 min': 30, '1 hour': 60, '2 hours': 120 };

/** Counts time in the foreground each day and shows one reminder at the limit. */
export function useDailyLimit() {
  const { t } = useTranslation();
  const limit = useSettings((s) => LIMIT_MINUTES[s.choices.timeLimit] ?? 0);
  const limitRef = useRef(limit);
  limitRef.current = limit;

  useEffect(() => {
    const tick = async () => {
      if (AppState.currentState !== 'active') return;
      const key = `usage-${localDate()}`;
      const used = Number((await AsyncStorage.getItem(key)) ?? 0) + 1;
      await AsyncStorage.setItem(key, String(used));
      if (limitRef.current > 0 && used === limitRef.current) toast(t('settings.limitReached'));
    };
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [t]);
}

/** Field state and save for the three screens that set a password. */
export function usePasswordForm() {
  const { t } = useTranslation();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (onSaved: () => void) => {
    setBusy(true);
    setError('');
    const { error: e } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (e) setError(t('auth.passwordFailed'));
    else onSaved();
  };
  return { pw, setPw, busy, error, save };
}

/** The note, its color and whether Next is allowed, shared with Edit profile. */
export function useUsernameCheck(u: string, unchangedFrom?: string) {
  const c = useTheme();
  const { t } = useTranslation();
  const [debounced, setDebounced] = useState(u);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(u), 350);
    return () => clearTimeout(id);
  }, [u]);

  const issue = usernameIssue(u);
  const unchanged = u === unchangedFrom;
  const { data: available, isFetching } = useQuery({
    queryKey: ['username', debounced],
    enabled: !issue && !unchanged && debounced === u,
    queryFn: () => usernameAvailable(debounced),
    gcTime: 0,
  });

  if (unchanged) return { note: t('username.rule'), color: c.muted, ok: true };
  if (issue === 'empty') return { note: t('username.rule'), color: c.muted, ok: false };
  if (issue) return { note: t(`username.${issue}`), color: issue === 'offensive' ? c.danger : c.fg, ok: false };
  if (isFetching || debounced !== u || available === undefined) return { note: t('username.checking'), color: c.muted, ok: false };
  if (!available) return { note: t('username.taken', { name: u }), color: c.danger, ok: false };
  return { note: t('username.available', { name: u }), color: c.fg, ok: true };
}

/**
 * Times how long each list item stays on screen and reports it once it leaves,
 * for ranking. Pass the result straight to a FlatList.
 */
export function useViewTracking(report: (id: string, ms: number) => void) {
  const shown = useRef(new Map<string, number>());
  const reportRef = useRef(report);
  reportRef.current = report;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { key: string; isViewable: boolean }[] }) => {
    const now = Date.now();
    const visible = new Set(viewableItems.filter((v) => v.isViewable).map((v) => v.key));
    for (const key of visible) if (!shown.current.has(key)) shown.current.set(key, now);
    for (const [key, at] of shown.current) {
      if (!visible.has(key)) {
        shown.current.delete(key);
        if (now - at >= 800) reportRef.current(key, now - at);
      }
    }
  }).current;
  // Whatever is on screen when the list goes away counts too.
  useEffect(() => () => {
    const now = Date.now();
    for (const [key, at] of shown.current) if (now - at >= 800) reportRef.current(key, now - at);
    shown.current.clear();
  }, []);
  return { onViewableItemsChanged, viewabilityConfig: { itemVisiblePercentThreshold: 60 } };
}
