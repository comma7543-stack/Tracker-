import { describe, expect, it } from 'vitest';
import { badgeProgress, effectiveStreak, flameTier, freezesLeft, isFrozen, reasonDayOptions, timeLeftToday, weekDates } from '../lib/streak';

describe('effectiveStreak', () => {
  const s = { current: 9, last_post_date: '2026-03-10', freezes_available: 1 };
  it('holds through today and tomorrow', () => {
    expect(effectiveStreak(s, '2026-03-10')).toBe(9);
    expect(effectiveStreak(s, '2026-03-11')).toBe(9);
  });
  it('drops to 0 after a missed day with no freeze', () => expect(effectiveStreak(s, '2026-03-12')).toBe(0));
  it('holds when a freeze covers the gap', () => expect(effectiveStreak(s, '2026-03-12', true)).toBe(9));
  it('drops when freezes cannot cover the gap', () => expect(effectiveStreak(s, '2026-03-13', true)).toBe(0));
  it('is 0 before the first post', () => expect(effectiveStreak({ current: 0, last_post_date: null }, '2026-03-10')).toBe(0));
});

describe('the flame', () => {
  const s = { current: 9, last_post_date: '2026-03-10', freezes_available: 2, excused_dates: [] as string[] };

  it('steps up at each badge', () => {
    expect([0, 1, 2, 3, 6, 7, 29, 30, 99, 100, 400].map(flameTier)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
  it('burns normally until a day is missed', () => {
    expect(isFrozen(s, '2026-03-10', true)).toBe(false);
    expect(isFrozen(s, '2026-03-11', true)).toBe(false);
  });
  it('turns blue while a freeze holds the streak, and ends with the next post', () => {
    expect(isFrozen(s, '2026-03-12', true)).toBe(true);
    expect(isFrozen({ ...s, last_post_date: '2026-03-12' }, '2026-03-12', true)).toBe(false);
  });
  it('turns blue on a reason day, including today', () => {
    expect(isFrozen({ ...s, excused_dates: ['2026-03-11'] }, '2026-03-11')).toBe(true);
    expect(isFrozen({ ...s, excused_dates: ['2026-03-11'] }, '2026-03-12')).toBe(true);
  });
  it('is not blue once the streak is lost, or with auto-freeze off', () => {
    expect(isFrozen(s, '2026-03-20', true)).toBe(false);
    expect(isFrozen(s, '2026-03-12', false)).toBe(false);
  });
  it('counts freezes already holding the streak as used', () => {
    expect(freezesLeft(s, '2026-03-11', true)).toBe(2);
    expect(freezesLeft(s, '2026-03-12', true)).toBe(1);
    expect(freezesLeft(s, '2026-03-20', true)).toBe(2);
  });
});

describe('reason days', () => {
  const s = { current: 9, last_post_date: '2026-03-10', freezes_available: 0, excused_dates: [] as string[] };

  it('counts an excused day as not missed', () => {
    expect(effectiveStreak({ ...s, excused_dates: ['2026-03-11'] }, '2026-03-12')).toBe(9);
  });
  it('ignores excused days outside the gap', () => {
    expect(effectiveStreak({ ...s, excused_dates: ['2026-03-01'] }, '2026-03-12')).toBe(0);
  });
  it('still drops when another day in the gap was missed', () => {
    expect(effectiveStreak({ ...s, excused_dates: ['2026-03-12'] }, '2026-03-13')).toBe(0);
  });
  it('offers today once it is the next day to post', () => {
    expect(reasonDayOptions(s, '2026-03-11')).toEqual(['2026-03-11']);
  });
  it('offers nothing on a day already posted', () => {
    expect(reasonDayOptions(s, '2026-03-10')).toEqual([]);
  });
  it('offers yesterday to rescue a streak that just lapsed, but not today yet', () => {
    expect(reasonDayOptions(s, '2026-03-12')).toEqual(['2026-03-11']);
  });
  it('offers both when a freeze is holding the streak', () => {
    expect(reasonDayOptions({ ...s, freezes_available: 1 }, '2026-03-12', true)).toEqual(['2026-03-11', '2026-03-12']);
  });
  it('offers today after yesterday is fixed', () => {
    expect(reasonDayOptions({ ...s, excused_dates: ['2026-03-11'] }, '2026-03-12')).toEqual(['2026-03-12']);
  });
  it('offers nothing when two days are already lost', () => {
    expect(reasonDayOptions(s, '2026-03-13')).toEqual([]);
  });
  it('offers nothing with no streak to protect', () => {
    expect(reasonDayOptions({ current: 0, last_post_date: null }, '2026-03-13')).toEqual([]);
  });
});

describe('badgeProgress', () => {
  it('targets the next badge', () => {
    expect(badgeProgress(0)).toMatchObject({ next: 3, toGo: 3 });
    expect(badgeProgress(3)).toMatchObject({ next: 7, toGo: 4, fraction: 0 });
    expect(badgeProgress(100)).toMatchObject({ next: 365 });
  });
});

describe('dates', () => {
  it('finds the time to local midnight', () => {
    expect(timeLeftToday(new Date(2026, 2, 10, 22, 30))).toEqual({ hours: 1, minutes: 30 });
  });
  it('starts the week on Monday, including from a Sunday', () => {
    const w = weekDates(new Date(2026, 2, 15)); // Sunday
    expect(w[0].date).toBe('2026-03-09');
    expect(w[6].date).toBe('2026-03-15');
  });
});
