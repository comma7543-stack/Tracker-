import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makePost, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const ids = (r: Record<string, any>[]) => r.map((x) => x.id);
const follow = (a: string, b: string) => rows(db, `insert into public.follows (follower_id, followee_id, status) values ($1, $2, 'accepted')`, [a, b]);
const like = (u: string, p: string) => rows(db, 'insert into public.likes (user_id, post_id) values ($1, $2)', [u, p]);
const forYou = (u: string) => as(db, u, () => rows(db, 'select id from public.for_you_feed(0, 30)'));

describe('interests', () => {
  it('keeps only real topics, readable only by the owner', async () => {
    const a = await makeUser(db);
    await as(db, a, () => rows(db, `select public.set_interests(array['Fitness', 'Hacking', 'Learning', 'Fitness'])`));
    const [{ my_interests }] = await as(db, a, () => rows(db, 'select public.my_interests()'));
    expect(my_interests).toEqual(['Fitness', 'Learning']);
    const b = await makeUser(db);
    await expect(as(db, b, () => rows(db, 'select interests from public.profiles where id = $1', [a]))).rejects.toThrow(/permission denied/);
  });
});

describe('for you feed', () => {
  it('ranks engaged posts above quiet ones for adults, leaving out people already supported', async () => {
    const viewer = await makeUser(db);
    const busy = await makeUser(db);
    const quiet = await makeUser(db);
    const known = await makeUser(db);
    await follow(viewer, known);
    const quietPost = await makePost(db, quiet, { at: new Date(Date.now() - 60_000).toISOString() });
    const busyPost = await makePost(db, busy, { at: new Date(Date.now() - 3 * 3600_000).toISOString() });
    const knownPost = await makePost(db, known);
    for (let i = 0; i < 5; i += 1) await like(await makeUser(db), busyPost);
    const feed = ids(await forYou(viewer));
    expect(feed.indexOf(busyPost)).toBeLessThan(feed.indexOf(quietPost));
    expect(feed).not.toContain(knownPost);
  });

  it('shows seen posts lower', async () => {
    const viewer = await makeUser(db);
    const x = await makePost(db, await makeUser(db));
    const y = await makePost(db, await makeUser(db));
    await as(db, viewer, () => rows(db, 'select public.record_view($1, 5000)', [x]));
    const feed = ids(await forYou(viewer));
    expect(feed.indexOf(y)).toBeLessThan(feed.indexOf(x));
  });

  it('gives teens newest first, only in their topics, and never shows teens to adult strangers', async () => {
    const teen = await makeUser(db, { age: 15 });
    const author = await makeUser(db);
    const old = await makePost(db, author, { at: new Date(Date.now() - 5 * 3600_000).toISOString() });
    const fresh = await makePost(db, author, { at: new Date(Date.now() - 60_000).toISOString() });
    for (let i = 0; i < 8; i += 1) await like(await makeUser(db), old);
    let feed = ids(await forYou(teen));
    expect(feed.indexOf(fresh)).toBeLessThan(feed.indexOf(old));

    await as(db, teen, () => rows(db, `select public.set_interests(array['Learning'])`));
    feed = ids(await forYou(teen));
    expect(feed).not.toContain(fresh);

    const otherTeen = await makeUser(db, { age: 16 });
    await rows(db, 'update public.profiles set is_private = false where id = $1', [otherTeen]);
    const teenPost = await makePost(db, otherTeen);
    expect(ids(await forYou(await makeUser(db)))).not.toContain(teenPost);
  });

  it('records the longest view only, and never for a hidden post', async () => {
    const viewer = await makeUser(db);
    const p = await makePost(db, await makeUser(db));
    await as(db, viewer, () => rows(db, 'select public.record_view($1, 4000)', [p]));
    await as(db, viewer, () => rows(db, 'select public.record_view($1, 1000)', [p]));
    expect((await rows(db, 'select ms from public.post_views where post_id = $1', [p]))[0].ms).toBe(4000);
    const hidden = await makePost(db, await makeUser(db), { status: 'checking' });
    await as(db, viewer, () => rows(db, 'select public.record_view($1, 4000)', [hidden]));
    expect(await rows(db, 'select 1 from public.post_views where post_id = $1', [hidden])).toHaveLength(0);
  });
});

describe('ranked scrolls', () => {
  it('serves scrolls and video posts shared to Scrolls, paged by offset', async () => {
    const viewer = await makeUser(db);
    const a = await makeUser(db);
    const s1 = await makePost(db, a, { kind: 'scroll' });
    const s2 = await makePost(db, a, { alsoScroll: true });
    await makePost(db, a);
    const all = ids(await as(db, viewer, () => rows(db, 'select id from public.scrolls_ranked(0, 30)')));
    expect(all).toEqual(expect.arrayContaining([s1, s2]));
    const page2 = ids(await as(db, viewer, () => rows(db, 'select id from public.scrolls_ranked(1, 30)')));
    expect(page2).toHaveLength(all.length - 1);
  });
});

describe('suggested people', () => {
  it('suggests active people and shared supporters, not people already supported or blocked', async () => {
    const me = await makeUser(db);
    const friend = await makeUser(db);
    const friendOfFriend = await makeUser(db);
    const active = await makeUser(db);
    const blocked = await makeUser(db);
    const inactive = await makeUser(db);
    await follow(me, friend);
    await follow(friend, friendOfFriend);
    await makePost(db, active);
    await makePost(db, blocked);
    await rows(db, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [me, blocked]);
    const out = await as(db, me, () => rows(db, 'select * from public.suggested_people(50)'));
    const got = ids(out);
    expect(got).toEqual(expect.arrayContaining([friendOfFriend, active]));
    expect(got).not.toContain(friend);
    expect(got).not.toContain(blocked);
    expect(got).not.toContain(inactive);
    expect(out.find((x) => x.id === friendOfFriend)?.mutuals).toBe(1);
  });

  it('never suggests a teen to an adult, and hides streaks people chose to hide', async () => {
    const adult = await makeUser(db);
    const teen = await makeUser(db, { age: 14 });
    await rows(db, 'update public.profiles set is_private = false where id = $1', [teen]);
    await makePost(db, teen);
    const hider = await makeUser(db);
    await makePost(db, hider);
    await rows(db, `update public.settings set choices = choices || '{"streakWho": "Only me"}' where user_id = $1`, [hider]);
    await rows(db, 'update public.streaks set current = 50 where user_id = $1', [hider]);
    const out = await as(db, adult, () => rows(db, 'select * from public.suggested_people(50)'));
    expect(ids(out)).not.toContain(teen);
    expect(out.find((x) => x.id === hider)?.streak).toBeNull();
  });
});
