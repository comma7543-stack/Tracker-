import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const support = (a: string, b: string) =>
  rows(db, `insert into public.follows (follower_id, followee_id, status) values ($1, $2, 'accepted')`, [a, b]);
const people = (viewer: string, owner: string, list: string) =>
  as(db, viewer, () => rows(db, 'select id, my_status from public.profile_people($1, $2)', [owner, list]));
const stats = async (viewer: string, owner: string) =>
  (await as(db, viewer, () => rows(db, 'select * from public.profile_stats($1)', [owner])))[0];
const setShow = (uid: string, on: boolean) =>
  rows(db, `update public.settings set prefs = prefs || jsonb_build_object('showLists', $1::boolean) where user_id = $2`, [on, uid]);

describe('supporter lists', () => {
  it('shows both lists, with whether the viewer supports each person', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db);
    const idol = await makeUser(db);
    const viewer = await makeUser(db);
    await support(fan, owner);
    await support(owner, idol);
    await support(viewer, fan);
    expect(await people(viewer, owner, 'supporters')).toEqual([{ id: fan, my_status: 'accepted' }]);
    expect(await people(viewer, owner, 'supporting')).toEqual([{ id: idol, my_status: null }]);
  });

  it('starts shown for adults and hidden for under 18', async () => {
    const adult = await makeUser(db);
    const teen = await makeUser(db, { age: 15 });
    const pref = async (u: string) => (await rows(db, 'select prefs from public.settings where user_id = $1', [u]))[0].prefs.showLists;
    expect(await pref(adult)).toBe(true);
    expect(await pref(teen)).toBe(false);
  });

  it('hiding locks the lists but keeps the counts, and the owner still sees them', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db);
    await support(fan, owner);
    await setShow(owner, false);
    expect(await people(fan, owner, 'supporters')).toEqual([]);
    expect(await stats(fan, owner)).toMatchObject({ followers: 1, lists_visible: false });
    expect(await people(owner, owner, 'supporters')).toHaveLength(1);
    expect((await stats(owner, owner)).lists_visible).toBe(true);
  });

  it('cannot be read around the switch', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db);
    const stranger = await makeUser(db);
    await support(fan, owner);
    await setShow(owner, false);
    const direct = (uid: string) => as(db, uid, () => rows(db, 'select 1 from public.follows where followee_id = $1', [owner]));
    expect(await direct(stranger)).toEqual([]);
    expect(await direct(owner)).toHaveLength(1);
    expect(await direct(fan)).toHaveLength(1); // Their own row.
  });

  it('still lists someone hidden on another person\'s visible list', async () => {
    const owner = await makeUser(db);
    const shy = await makeUser(db);
    const viewer = await makeUser(db);
    await support(shy, owner);
    await setShow(shy, false);
    expect(await people(viewer, owner, 'supporters')).toEqual([{ id: shy, my_status: null }]);
  });

  it('keeps private account lists to approved supporters', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db);
    const stranger = await makeUser(db);
    await rows(db, 'update public.profiles set is_private = true where id = $1', [owner]);
    await support(fan, owner);
    await rows(db, `update public.follows set status = 'accepted' where followee_id = $1`, [owner]);
    expect(await people(stranger, owner, 'supporters')).toEqual([]);
    expect(await people(fan, owner, 'supporters')).toHaveLength(1);
  });

  it('leaves out blocked people, and teens hidden from an adult stranger', async () => {
    const owner = await makeUser(db);
    const blocked = await makeUser(db);
    const teen = await makeUser(db, { age: 15 });
    const viewer = await makeUser(db);
    await support(blocked, owner);
    await support(teen, owner);
    await rows(db, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [viewer, blocked]);
    expect(await people(viewer, owner, 'supporters')).toEqual([]);
  });

  it('lets you remove your own supporter, and nobody else', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db);
    const stranger = await makeUser(db);
    await support(fan, owner);
    const drop = (uid: string) => as(db, uid, () => rows(db, 'delete from public.follows where follower_id = $1 and followee_id = $2', [fan, owner]));
    await drop(stranger);
    expect(await people(owner, owner, 'supporters')).toHaveLength(1);
    await drop(owner);
    expect(await people(owner, owner, 'supporters')).toEqual([]);
  });
});
