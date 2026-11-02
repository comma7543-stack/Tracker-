import { isBad } from './profanity';

export const validPhone = (v: string) => v.replace(/\D/g, '').length >= 7;
export const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// Supabase needs E.164, so the number must include its country code.
export const toE164 = (v: string) => '+' + v.replace(/\D/g, '');

type UsernameIssue = 'empty' | 'offensive' | 'chars' | 'short' | 'long' | 'dots' | null;

export function usernameIssue(u: string): UsernameIssue {
  if (u.length === 0) return 'empty';
  if (isBad(u)) return 'offensive';
  if (!/^[a-z0-9._]+$/.test(u)) return 'chars';
  if (u.length < 3) return 'short';
  if (u.length > 30) return 'long';
  if (u.startsWith('.') || u.endsWith('.')) return 'dots';
  return null;
}

export const normalizeUsername = (v: string) => v.toLowerCase().replace(/\s/g, '');

/** Whole years between a YYYY-MM-DD birthday and now, or null if not a real age. */
export function ageFrom(date: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age < 0 || age > 120 ? null : age;
}

export const canSignUp = (age: number | null) => age !== null && age >= 13;
