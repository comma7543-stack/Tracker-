import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makePost, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

describe('freezes on post cards', () => {
  it('shows freezes left to anyone who can see the streak, and hides them otherwise', async () => {
    const author = await makeUser(db);
    const viewer = await makeUser(db);
    const post = await makePost(db, author);
    await rows(db, 'update public.streaks set freezes_available = 2 where user_id = $1', [author]);
    const card = async () =>
      (await as(db, viewer, () => rows(db, 'select streak_freezes from public.post_cards where id = $1', [post])))[0].streak_freezes;
    expect(await card()).toBe(2);
    await rows(db, `update public.settings set choices = choices || '{"streakWho":"Only me"}' where user_id = $1`, [author]);
    expect(await card()).toBeNull();
  });
});
