import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const row = async (uid: string) => (await rows(db, 'select prefs, choices from public.settings where user_id = $1', [uid]))[0];
const setPref = (uid: string, key: string, value: boolean) =>
  as(db, uid, () => rows(db, 'select public.set_pref($1, $2)', [key, value]));

describe('saving one setting', () => {
  it('changes that key and leaves the rest', async () => {
    const me = await makeUser(db);
    await rows(db, `update public.settings set prefs = prefs || '{"isPrivate":true,"showLists":false}' where user_id = $1`, [me]);
    await setPref(me, 'nLikes', false);
    expect((await row(me)).prefs).toMatchObject({ nLikes: false, isPrivate: true, showLists: false });
  });

  it('saves choices the same way', async () => {
    const me = await makeUser(db);
    await as(db, me, () => rows(db, `select public.set_choice('streakWho', 'Only me')`));
    expect((await row(me)).choices).toMatchObject({ streakWho: 'Only me', theme: 'white' });
  });

  it('still makes the account private', async () => {
    const me = await makeUser(db);
    await setPref(me, 'isPrivate', true);
    expect((await rows(db, 'select is_private from public.profiles where id = $1', [me]))[0].is_private).toBe(true);
  });

  it('only ever changes your own settings', async () => {
    const me = await makeUser(db);
    const other = await makeUser(db);
    await setPref(me, 'nLikes', false);
    expect((await row(other)).prefs.nLikes).toBe(true);
  });
});
