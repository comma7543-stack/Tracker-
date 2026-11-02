import { beforeAll, describe, expect, it } from 'vitest';
import { Db, freshDb, makePost, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const day = (d: string) => `${d}T12:00:00Z`;
const goLive = async (user: string, at: string) => {
  const p = await makePost(db, user, { status: 'checking', at });
  await rows(db, `update public.posts set status = 'live' where id = $1`, [p]);
};
const streak = async (user: string) =>
  (await rows(db, 'select current, best, freezes_available, last_post_date::text as last from public.streaks where user_id = $1', [user]))[0];
const setStreak = (user: string, s: { current: number; last: string; freezes: number }) =>
  rows(db, 'update public.streaks set current = $2, best = $2, last_post_date = $3, freezes_available = $4 where user_id = $1', [user, s.current, s.last, s.freezes]);

describe('streak', () => {
  it('starts at 1 on the first live post', async () => {
    const u = await makeUser(db);
    await goLive(u, day('2026-03-01'));
    expect(await streak(u)).toMatchObject({ current: 1, best: 1 });
  });

  it('only counts live posts', async () => {
    const u = await makeUser(db);
    const p = await makePost(db, u, { status: 'checking', at: day('2026-03-01') });
    await rows(db, `update public.posts set status = 'rejected' where id = $1`, [p]);
    expect((await streak(u)).current).toBe(0);
  });

  it('does not change on a second post the same day', async () => {
    const u = await makeUser(db);
    await goLive(u, day('2026-03-01'));
    await goLive(u, '2026-03-01T20:00:00Z');
    expect((await streak(u)).current).toBe(1);
  });

  it('adds 1 the next day', async () => {
    const u = await makeUser(db);
    await goLive(u, day('2026-03-01'));
    await goLive(u, day('2026-03-02'));
    expect(await streak(u)).toMatchObject({ current: 2, best: 2 });
  });

  it('spends a freeze on a missed day', async () => {
    const u = await makeUser(db);
    await setStreak(u, { current: 5, last: '2026-03-01', freezes: 1 });
    await goLive(u, day('2026-03-03'));
    expect(await streak(u)).toMatchObject({ current: 6, freezes_available: 0 });
  });

  it('resets to 1 on a missed day with no freeze', async () => {
    const u = await makeUser(db);
    await setStreak(u, { current: 5, last: '2026-03-01', freezes: 0 });
    await goLive(u, day('2026-03-03'));
    expect(await streak(u)).toMatchObject({ current: 1, best: 5 });
  });

  it('resets and keeps freezes when autoFreeze is off', async () => {
    const u = await makeUser(db);
    await rows(db, `update public.settings set prefs = prefs || '{"autoFreeze":false}' where user_id = $1`, [u]);
    await setStreak(u, { current: 5, last: '2026-03-01', freezes: 2 });
    await goLive(u, day('2026-03-03'));
    expect(await streak(u)).toMatchObject({ current: 1, freezes_available: 2 });
  });

  it('resets when freezes cannot cover the whole gap', async () => {
    const u = await makeUser(db);
    await setStreak(u, { current: 5, last: '2026-03-01', freezes: 1 });
    await goLive(u, day('2026-03-04'));
    expect(await streak(u)).toMatchObject({ current: 1, freezes_available: 1 });
  });

  it('earns a freeze at every 7-day multiple', async () => {
    const u = await makeUser(db);
    await setStreak(u, { current: 6, last: '2026-03-01', freezes: 0 });
    await goLive(u, day('2026-03-02'));
    expect(await streak(u)).toMatchObject({ current: 7, freezes_available: 1 });
  });

  it('caps freezes at 2', async () => {
    const u = await makeUser(db);
    await setStreak(u, { current: 13, last: '2026-03-01', freezes: 2 });
    await goLive(u, day('2026-03-02'));
    expect(await streak(u)).toMatchObject({ current: 14, freezes_available: 2 });
  });

  it("uses the user's timezone for the day boundary", async () => {
    const u = await makeUser(db);
    await rows(db, `update public.streaks set timezone = 'Asia/Seoul' where user_id = $1`, [u]);
    await goLive(u, '2026-03-01T14:00:00Z'); // 23:00 Mar 1 in Seoul
    await goLive(u, '2026-03-01T16:00:00Z'); // 01:00 Mar 2 in Seoul
    expect(await streak(u)).toMatchObject({ current: 2, last: '2026-03-02' });
  });
});
