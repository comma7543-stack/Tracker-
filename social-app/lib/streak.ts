// Client-side streak display. The real counting happens in private.bump_streak;
// this only works out what to show between posts.

const pad = (n: number) => String(n).padStart(2, '0');

export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 864e5).toISOString().slice(0, 10);

type StreakLike = { current: number; last_post_date: string | null; freezes_available?: number; excused_dates?: string[] | null };

/** Whole days since the last post that nothing has excused. */
function missedDays(s: StreakLike, today: string) {
  const last = s.last_post_date;
  if (!last) return 0;
  const excused = (s.excused_dates ?? []).filter((d) => d > last && d < today).length;
  return Math.max(0, daysBetween(last, today) - 1 - excused);
}

/** The stored count goes stale once days are missed, until the next post updates it. */
export function effectiveStreak(s: StreakLike, today: string, autoFreeze = false): number {
  if (!s.last_post_date) return 0;
  const missed = missedDays(s, today);
  if (missed <= 0) return s.current;
  return autoFreeze && (s.freezes_available ?? 0) >= missed ? s.current : 0;
}

/** Which days a reason day could still protect: yesterday if it was missed, and today. */
export function reasonDayOptions(s: StreakLike, today: string, autoFreeze = false): string[] {
  const last = s.last_post_date;
  if (!last || s.current <= 0) return [];
  const excused = s.excused_dates ?? [];
  const yesterday = addDays(today, -1);
  const options: string[] = [];
  if (yesterday > last && !excused.includes(yesterday) && effectiveStreak({ ...s, excused_dates: [...excused, yesterday] }, today, autoFreeze) > 0) options.push(yesterday);
  if (today > last && !excused.includes(today) && effectiveStreak(s, today, autoFreeze) > 0) options.push(today);
  return options;
}

/** True while a freeze or reason day is what's keeping the streak alive. The next post ends it. */
export function isFrozen(s: StreakLike, today: string, autoFreeze = false) {
  const last = s.last_post_date;
  if (!last || last >= today || effectiveStreak(s, today, autoFreeze) <= 0) return false;
  return missedDays(s, today) > 0 || (s.excused_dates ?? []).some((d) => d > last && d <= today);
}

/** The server only spends freezes at the next post, so count the ones already holding the streak. */
export function freezesLeft(s: StreakLike, today: string, autoFreeze = false) {
  const available = s.freezes_available ?? 0;
  return effectiveStreak(s, today, autoFreeze) > 0 ? Math.max(0, available - missedDays(s, today)) : available;
}

export function timeLeftToday(now = new Date()) {
  const mid = new Date(now);
  mid.setHours(24, 0, 0, 0);
  const ms = Math.max(0, mid.getTime() - now.getTime());
  return { hours: Math.floor(ms / 3600000), minutes: Math.floor((ms % 3600000) / 60000) };
}

export const BADGE_GOALS = [3, 7, 30, 100] as const;

/** 0 for no streak, then one step up at each badge: 1 to 5. */
export const flameTier = (count: number) => (count <= 0 ? 0 : 1 + BADGE_GOALS.filter((g) => count >= g).length);

/** Longer streaks burn harder and faster. A frozen flame drifts slowly. */
export const flameMotion = (tier: number, frozen: boolean) =>
  (frozen ? { stretch: 0.03, ms: 900 } : { stretch: 0.03 + tier * 0.02, ms: 420 - tier * 50 });

export function badgeProgress(streak: number) {
  const next = BADGE_GOALS.find((g) => g > streak) ?? 365;
  const prev = [...BADGE_GOALS].reverse().find((g) => g <= streak) ?? 0;
  return { next, toGo: next - streak, fraction: (streak - prev) / (next - prev) };
}

/** Monday-first dates of the week containing `now`, as YYYY-MM-DD. */
export function weekDates(now = new Date()) {
  const mondayOffset = (now.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset + i);
    return { date: localDate(d), day: d.getDate() };
  });
}
