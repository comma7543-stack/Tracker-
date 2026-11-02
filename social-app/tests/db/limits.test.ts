import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makePost, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

let n = 0;
const share = (uid: string, kind = 'post', subtag = 'Gym') => {
  n += 1;
  const video = kind === 'scroll';
  return as(db, uid, () => rows(
    db,
    `insert into public.posts (author_id, kind, media_path, media_type, subtag, topic)
     values ($1, $2, $3, $4, $5, 'set by a trigger') returning id`,
    [uid, kind, `${uid}/${n}.${video ? 'mp4' : 'jpg'}`, video ? 'video' : 'photo', subtag],
  ));
};
const limits = async (uid: string) => (await as(db, uid, () => rows(db, 'select * from public.posting_limits()')))[0];

describe('daily post limits', () => {
  it('allows 5 posts and scrolls combined, then refuses', async () => {
    const a = await makeUser(db);
    for (const kind of ['post', 'scroll', 'post', 'scroll', 'post']) await share(a, kind);
    await expect(share(a)).rejects.toThrow(/daily_limit_reached/);
    await expect(share(a, 'scroll')).rejects.toThrow(/daily_limit_reached/);
    expect(await limits(a)).toEqual({ posts_used: 5, posts_limit: 5 });
  });

  it('never limits stories, and they use none of the 5', async () => {
    const a = await makeUser(db);
    for (let i = 0; i < 30; i += 1) await share(a, 'story');
    expect((await limits(a)).posts_used).toBe(0);
    for (let i = 0; i < 5; i += 1) await share(a);
    await share(a, 'story');
  });

  it('keeps stories out of the streak, but not posts', async () => {
    const a = await makeUser(db);
    const live = async (kind: string) => {
      const [p] = await share(a, kind);
      await rows(db, `select public.apply_moderation($1, '{"on_topic":true,"violation":null}')`, [p.id]);
    };
    const current = async () => (await rows(db, 'select current from public.streaks where user_id = $1', [a]))[0].current;
    await live('story');
    expect(await current()).toBe(0);
    await live('post');
    expect(await current()).toBe(1);
  });

  it('counts each person separately', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    for (let i = 0; i < 5; i += 1) await share(a);
    await share(b);
    expect((await limits(b)).posts_used).toBe(1);
  });

  it('does not give the slot back when a post is deleted or blocked', async () => {
    const a = await makeUser(db);
    for (let i = 0; i < 5; i += 1) {
      const [p] = await share(a);
      await rows(db, `update public.posts set status = 'off_topic' where id = $1`, [p.id]);
      await as(db, a, () => rows(db, 'delete from public.posts where id = $1', [p.id]));
    }
    await expect(share(a)).rejects.toThrow(/daily_limit_reached/);
  });

  it('does not use a slot when the post itself is refused', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    await expect(as(db, a, () => rows(
      db,
      `insert into public.posts (author_id, kind, media_path, media_type, subtag, topic) values ($1, 'post', $2, 'photo', 'Gym', 'Fitness')`,
      [a, `${b}/stolen.jpg`],
    ))).rejects.toThrow();
    expect((await limits(a)).posts_used).toBe(0);
  });

  it('resets on a new day', async () => {
    const a = await makeUser(db);
    for (let i = 0; i < 5; i += 1) await share(a);
    await rows(db, `update public.daily_post_counts set day = day - 1 where user_id = $1`, [a]);
    expect((await limits(a)).posts_used).toBe(0);
    await share(a);
  });

  it('uses the local date of the user', async () => {
    const a = await makeUser(db);
    await rows(db, `update public.streaks set timezone = 'Pacific/Kiritimati' where user_id = $1`, [a]);
    await share(a);
    const [row] = await rows(db, `select day::text as day, (now() at time zone 'Pacific/Kiritimati')::date::text as expected from public.daily_post_counts where user_id = $1`, [a]);
    expect(row.day).toBe(row.expected);
  });

  it('does not limit admin work', async () => {
    const a = await makeUser(db);
    for (let i = 0; i < 7; i += 1) await makePost(db, a);
  });

  it('accepts the Motivation topic', async () => {
    const a = await makeUser(db);
    const [p] = await share(a, 'post', 'Quotes');
    const [row] = await rows(db, 'select topic from public.posts where id = $1', [p.id]);
    expect(row.topic).toBe('Motivation');
  });

  it('hides the counters from users', async () => {
    const a = await makeUser(db);
    await expect(as(db, a, () => rows(db, 'select * from public.daily_post_counts'))).rejects.toThrow(/permission denied/);
    await expect(as(db, a, () => rows(db, 'update public.daily_post_counts set used = 0'))).rejects.toThrow(/permission denied/);
    await expect(as(db, a, () => rows(db, 'select * from public.moderation_usage'))).rejects.toThrow(/permission denied/);
    await expect(as(db, a, () => rows(db, 'select check_claimed_at from public.posts'))).rejects.toThrow(/permission denied/);
  });
});

describe('all-users daily ceiling', () => {
  const claim = async (post: string, limit: number) =>
    (await rows(db, 'select public.claim_moderation_check($1, $2) as r', [post, limit]))[0].r;

  it('stops users from claiming checks themselves', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    await expect(as(db, a, () => rows(db, 'select public.claim_moderation_check($1, 9999)', [p]))).rejects.toThrow(/permission denied/);
  });

  it('allows up to the ceiling, then makes posts wait', async () => {
    const a = await makeUser(db);
    await db.exec('delete from public.moderation_usage');
    const p1 = await makePost(db, a, { status: 'checking' });
    const p2 = await makePost(db, a, { status: 'checking' });
    const p3 = await makePost(db, a, { status: 'checking' });
    expect(await claim(p1, 2)).toBe('ok');
    expect(await claim(p2, 2)).toBe('ok');
    expect(await claim(p3, 2)).toBe('over_limit');
    const [row] = await rows(db, 'select check_claimed_at, status from public.posts where id = $1', [p3]);
    expect(row).toEqual({ check_claimed_at: null, status: 'checking' });
    expect((await rows(db, 'select checks from public.moderation_usage'))[0].checks).toBe(2);
  });

  it('lets a waiting post through the next day', async () => {
    const a = await makeUser(db);
    await db.exec('delete from public.moderation_usage');
    const p = await makePost(db, a, { status: 'checking' });
    expect(await claim(p, 0)).toBe('over_limit');
    expect(await claim(p, 1)).toBe('ok');
  });

  it('buys one model call however often a post is sent', async () => {
    const a = await makeUser(db);
    await db.exec('delete from public.moderation_usage');
    const p = await makePost(db, a, { status: 'checking' });
    expect(await claim(p, 100)).toBe('ok');
    expect(await claim(p, 100)).toBe('busy');
    expect(await claim(p, 100)).toBe('busy');
    expect((await rows(db, 'select checks from public.moderation_usage'))[0].checks).toBe(1);
    await rows(db, `update public.posts set check_claimed_at = now() - interval '4 minutes' where id = $1`, [p]);
    expect(await claim(p, 100)).toBe('ok');
  });

  it('never claims for a post already decided', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'live' });
    expect(await claim(p, 100)).toBe('busy');
  });
});
