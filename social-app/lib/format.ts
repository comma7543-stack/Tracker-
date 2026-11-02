import type { TFunction } from 'i18next';

export function timeAgo(iso: string, t: TFunction, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return t('time.now');
  if (minutes < 60) return t('time.minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('time.days', { n: days });
  return t('time.weeks', { n: Math.floor(days / 7) });
}

export const initial = (name?: string | null) => (name ?? '?').charAt(0).toUpperCase();

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
