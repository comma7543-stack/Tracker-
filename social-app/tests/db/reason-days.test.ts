import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makePost, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

/** A user whose last post was this many days ago, with a streak of 5. */
async function userWithStreak(daysAgo: number, freezes = 0) {
  const u = await makeUser(db);
  await rows(db, 'update public.streaks set current = 5, best = 5, last_post_date = $2, freezes_available = $3 where user_id = $1', [u, iso(daysAgo), freezes]);
  return u;
}
const use = (u: string, daysAgo: number, reason = 'sick') =>
  as(db, u, () => rows(db, 'select public.use_reason_day($1, $2)', [iso(daysAgo), reason]));
const left = async (u: string) => (await as(db, u, () => rows(db, 'select public.reason_days_left() as n')))[0].n;
const streak = async (u: string) => (await rows(db, 'select current, freezes_available from public.streaks where user_id = $1', [u]))[0];
const postToday = async (u: string) => {
  const p = await makePost(db, u, { status: 'checking' });
  await rows(db, `update public.posts set status = 'live' where id = $1`, [p]);
};

describe('reason days', () => {
  it('keeps a streak through a missed day, without spending a freeze', async () => {
    const u = await userWithStreak(2, 1);
    await use(u, 1);
    await postToday(u);
    expect(await streak(u)).toEqual({ current: 6, freezes_available: 1 });
  });

  it('without one, the same gap spends a freeze or resets', async () => {
    const withFreeze = await userWithStreak(2, 1);
    await postToday(withFreeze);
    expect(await streak(withFreeze)).toEqual({ current: 6, freezes_available: 0 });
    const without = await userWithStreak(2);
    await postToday(without);
    expect((await streak(without)).current).toBe(1);
  });

  it('counts down from 3', async () => {
    const u = await userWithStreak(1);
    expect(await left(u)).toBe(3);
    await use(u, 0);
    expect(await left(u)).toBe(2);
  });

  it('refuses a fourth in the same month', async () => {
    const u = await userWithStreak(1);
    const month = iso(0).slice(0, 8);
    const others = ['01', '02', '03', '04'].map((d) => month + d).filter((d) => d !== iso(0)).slice(0, 3);
    for (const d of others) await rows(db, `insert into public.streak_reasons (user_id, day, reason) values ($1, $2, 'sick')`, [u, d]);
    expect(await left(u)).toBe(0);
    await expect(use(u, 0)).rejects.toThrow(/reason_limit/);
  });

  it('gives a fresh 3 in a new month', async () => {
    const u = await userWithStreak(1);
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03']) await rows(db, `insert into public.streak_reasons (user_id, day, reason) values ($1, $2, 'sick')`, [u, d]);
    expect(await left(u)).toBe(3);
  });

  it('charges nothing for using the same day twice', async () => {
    const u = await userWithStreak(1);
    await use(u, 0);
    await use(u, 0);
    expect(await left(u)).toBe(2);
  });

  it('only allows today and yesterday', async () => {
    const u = await userWithStreak(5);
    await expect(use(u, 2)).rejects.toThrow(/bad_day/);
    await expect(use(u, -1)).rejects.toThrow(/bad_day/);
  });

  it('refuses a day already posted', async () => {
    const u = await userWithStreak(0);
    await expect(use(u, 0)).rejects.toThrow(/already_posted/);
    await expect(use(u, 1)).rejects.toThrow(/already_posted/);
  });

  it('refuses when there is no streak yet', async () => {
    const u = await makeUser(db);
    await expect(use(u, 0)).rejects.toThrow(/no_streak/);
  });

  it('refuses a made-up reason, and spends nothing', async () => {
    const u = await userWithStreak(1);
    await expect(use(u, 0, 'because')).rejects.toThrow();
    expect(await left(u)).toBe(3);
  });

  it('keeps the reason private to its owner', async () => {
    const owner = await userWithStreak(1);
    const other = await makeUser(db);
    await use(owner, 0, 'family');
    expect(await as(db, other, () => rows(db, 'select * from public.streak_reasons where user_id = $1', [owner]))).toEqual([]);
    expect((await as(db, owner, () => rows(db, 'select reason from public.streak_reasons')))[0].reason).toBe('family');
  });

  it('never lets users write reasons or dates directly', async () => {
    const u = await userWithStreak(1);
    await expect(as(db, u, () => rows(db, `insert into public.streak_reasons (user_id, day, reason) values ($1, $2, 'sick')`, [u, iso(0)]))).rejects.toThrow(/permission denied/);
    await expect(as(db, u, () => rows(db, `update public.streaks set excused_dates = '{}' where user_id = $1`, [u]))).rejects.toThrow(/permission denied/);
  });
});
