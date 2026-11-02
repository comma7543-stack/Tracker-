import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makePost, makeUser, rows, seedSql } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const canSeePost = async (viewer: string, id: string) =>
  as(db, viewer, async () => (await rows(db, 'select id from public.post_cards where id = $1', [id])).length === 1);

const insertPost = (author: string) =>
  rows(
    db,
    `insert into public.posts (author_id, kind, media_path, media_type, subtag, topic)
     values ($1, 'post', $2, 'photo', 'Gym', 'Fitness') returning id, status`,
    [author, `${author}/a.jpg`],
  );

describe('schema safety', () => {
  it('has RLS on every public table', async () => {
    const off = await rows(db, `select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(off).toEqual([]);
  });

  it('never lets users read a birthday, not even their own', async () => {
    const a = await makeUser(db);
    await expect(as(db, a, () => rows(db, 'select dob from public.profiles where id = $1', [a]))).rejects.toThrow(/permission denied/);
  });

  it('lets users read the safe profile columns', async () => {
    const a = await makeUser(db, { username: 'safe.columns' });
    const r = await as(db, a, () => rows(db, 'select username from public.profiles where id = $1', [a]));
    expect(r[0].username).toBe('safe.columns');
  });

  it('never lets users change post status or edit a live caption', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'rejected' });
    await expect(as(db, a, () => rows(db, `update public.posts set status = 'live' where id = $1`, [p]))).rejects.toThrow(/permission denied/);
    await expect(as(db, a, () => rows(db, `update public.posts set caption = 'x' where id = $1`, [p]))).rejects.toThrow(/permission denied/);
  });

  it('forces new posts into checking, even if the client asks for live', async () => {
    const a = await makeUser(db);
    const r = await as(db, a, () => insertPost(a));
    expect(r[0].status).toBe('checking');
    await expect(
      as(db, a, () =>
        rows(db, `insert into public.posts (author_id, kind, media_path, media_type, subtag, topic, status) values ($1, 'post', $2, 'photo', 'Gym', 'Fitness', 'live')`, [a, `${a}/b.jpg`]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses a post that points at someone else's file", async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    await expect(
      as(db, a, () =>
        rows(db, `insert into public.posts (author_id, kind, media_path, media_type, subtag, topic) values ($1, 'post', $2 || '/x.jpg', 'photo', 'Gym', 'Fitness')`, [a, b]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps moderation RPCs away from users', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    await expect(
      as(db, a, () => rows(db, `select public.apply_moderation($1, '{"on_topic":true,"violation":null}')`, [p])),
    ).rejects.toThrow(/permission denied/);
  });

  it('blocks users from the safety queue', async () => {
    const a = await makeUser(db);
    await expect(as(db, a, () => rows(db, 'select * from public.safety_escalations'))).rejects.toThrow(/permission denied/);
  });
});

describe('signup', () => {
  const signup = (uid: string, username: string, dob: string) =>
    as(db, uid, () => rows(db, `select public.complete_signup('Name', $1, $2::date, 'v1', 'Asia/Seoul')`, [username, dob]));

  const authOnly = async () => {
    const id = crypto.randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  };
  const yearsAgo = (y: number) => new Date(Date.now() - y * 366 * 864e5).toISOString().slice(0, 10);

  it('rejects under 13 on the server', async () => {
    await expect(signup(await authOnly(), 'too.young', yearsAgo(12))).rejects.toThrow(/under_13/);
  });

  it('gives 13-17 year olds a private account and adults a public one', async () => {
    const teen = await authOnly();
    await signup(teen, 'teen.user', yearsAgo(15));
    const adult = await authOnly();
    await signup(adult, 'adult.user', yearsAgo(30));
    const r = await rows(db, 'select id, is_private from public.profiles where id = any($1)', [[teen, adult]]);
    expect(r.find((x) => x.id === teen)?.is_private).toBe(true);
    expect(r.find((x) => x.id === adult)?.is_private).toBe(false);
    const s = await rows(db, 'select prefs, choices from public.settings where user_id = $1', [teen]);
    expect(s[0].prefs.isPrivate).toBe(true);
    expect(s[0].choices.dmWho).toBe('People you follow');
    expect(s[0].choices.streakWho).toBe('Everyone');
  });

  it('rejects bad and duplicate usernames', async () => {
    await signup(await authOnly(), 'taken.name', yearsAgo(20));
    await expect(signup(await authOnly(), 'taken.name', yearsAgo(20))).rejects.toThrow(/username_taken/);
    await expect(signup(await authOnly(), '.dotstart', yearsAgo(20))).rejects.toThrow(/username_format/);
    await expect(signup(await authOnly(), 'ab', yearsAgo(20))).rejects.toThrow(/username_format/);
  });
});

describe('blocks', () => {
  it('hides profile and posts in both directions', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const pa = await makePost(db, a);
    const pb = await makePost(db, b);
    expect(await canSeePost(b, pa)).toBe(true);
    await as(db, a, () => rows(db, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [a, b]));
    expect(await canSeePost(b, pa)).toBe(false);
    expect(await canSeePost(a, pb)).toBe(false);
    const seen = await as(db, b, () => rows(db, 'select id from public.profiles where id = $1', [a]));
    expect(seen).toEqual([]);
  });

  it('removes follows, and hides comments and messages both ways', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const c = await makeUser(db);
    const post = await makePost(db, c);
    await rows(db, `update public.settings set choices = choices || '{"dmWho":"Everyone"}' where user_id = any($1)`, [[a, b]]);
    await as(db, b, () => rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [b, a]));
    await as(db, b, () => rows(db, `insert into public.comments (post_id, author_id, body) values ($1, $2, 'hello')`, [post, b]));
    const conv = await as(db, a, async () => (await rows(db, 'select public.start_conversation($1) as id', [b]))[0].id);
    await as(db, a, () => rows(db, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hi')`, [conv, a]));

    await as(db, a, () => rows(db, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [a, b]));

    expect(await rows(db, 'select 1 from public.follows where follower_id = $1 and followee_id = $2', [b, a])).toEqual([]);
    const comments = await as(db, a, () => rows(db, 'select id from public.comment_cards where post_id = $1', [post]));
    expect(comments).toEqual([]);
    const msgs = await as(db, b, () => rows(db, 'select id from public.messages where conversation_id = $1', [conv]));
    expect(msgs).toEqual([]);
    await expect(
      as(db, b, () => rows(db, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'back')`, [conv, b])),
    ).rejects.toThrow(/row-level security/);
    await expect(as(db, b, () => rows(db, 'select public.start_conversation($1)', [a]))).rejects.toThrow(/cannot_message/);
    await expect(
      as(db, b, () => rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [b, a])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('private accounts', () => {
  it('shows content only to accepted followers', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db);
    await rows(db, `update public.settings set prefs = prefs || '{"isPrivate":true}' where user_id = $1`, [owner]);
    const p = await makePost(db, owner);
    expect(await canSeePost(fan, p)).toBe(false);

    await as(db, fan, () => rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [fan, owner]));
    const f = await rows(db, 'select status from public.follows where follower_id = $1', [fan]);
    expect(f[0].status).toBe('pending');
    expect(await canSeePost(fan, p)).toBe(false);

    // The follower can't approve themself.
    await as(db, fan, () => rows(db, `update public.follows set status = 'accepted' where follower_id = $1`, [fan]));
    expect((await rows(db, 'select status from public.follows where follower_id = $1', [fan]))[0].status).toBe('pending');

    await as(db, owner, () => rows(db, `update public.follows set status = 'accepted' where follower_id = $1 and followee_id = $2`, [fan, owner]));
    expect(await canSeePost(fan, p)).toBe(true);
  });

  it('accepts pending requests when the account goes public', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db);
    await rows(db, `update public.settings set prefs = prefs || '{"isPrivate":true}' where user_id = $1`, [owner]);
    await as(db, fan, () => rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [fan, owner]));
    await as(db, owner, () => rows(db, `update public.settings set prefs = prefs || '{"isPrivate":false}' where user_id = $1`, [owner]));
    expect((await rows(db, 'select status from public.follows where follower_id = $1', [fan]))[0].status).toBe('accepted');
  });
});

describe('post visibility', () => {
  it.each(['checking', 'off_topic', 'rejected', 'under_review', 'removed'])('hides %s posts from everyone but the author', async (status) => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const p = await makePost(db, a, { status });
    expect(await canSeePost(b, p)).toBe(false);
    expect(await canSeePost(a, p)).toBe(true);
  });

  it('hides stories after they expire', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const p = await makePost(db, a, { kind: 'story', at: new Date(Date.now() - 25 * 3600e3).toISOString() });
    expect(await canSeePost(b, p)).toBe(false);
  });
});

describe('suspension', () => {
  const strike = (uid: string, daysAgo = 0) =>
    rows(db, `insert into public.strikes (user_id, reason, created_at) values ($1, 'sexual', now() - make_interval(days => $2::int))`, [uid, daysAgo]);

  it('allows posting at 2 strikes and refuses at 3', async () => {
    const a = await makeUser(db);
    await strike(a);
    await strike(a);
    expect(await as(db, a, () => insertPost(a))).toHaveLength(1);
    await strike(a);
    await expect(as(db, a, () => insertPost(a))).rejects.toThrow(/row-level security/);
    const s = await as(db, a, () => rows(db, 'select * from public.account_status()'));
    expect(s[0]).toMatchObject({ strikes: 3, suspended: true });
  });

  it('ends 7 days after the third strike', async () => {
    const a = await makeUser(db);
    await strike(a, 20);
    await strike(a, 10);
    await strike(a, 8);
    expect(await as(db, a, () => insertPost(a))).toHaveLength(1);
  });

  it('ignores voided and expired strikes', async () => {
    const a = await makeUser(db);
    await strike(a);
    await strike(a);
    await rows(db, `insert into public.strikes (user_id, reason, voided) values ($1, 'x', true)`, [a]);
    await rows(db, `insert into public.strikes (user_id, reason, expires_at) values ($1, 'x', now() - interval '1 day')`, [a]);
    expect(await as(db, a, () => insertPost(a))).toHaveLength(1);
  });

  it('still lets a suspended user like and comment', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const p = await makePost(db, b);
    await strike(a);
    await strike(a);
    await strike(a);
    await as(db, a, () => rows(db, 'insert into public.likes (user_id, post_id) values ($1, $2)', [a, p]));
    expect(await rows(db, 'select 1 from public.likes where user_id = $1', [a])).toHaveLength(1);
  });
});

describe('who can comment and message', () => {
  it('respects commentWho', async () => {
    const owner = await makeUser(db);
    const other = await makeUser(db);
    const p = await makePost(db, owner);
    const comment = () => as(db, other, () => rows(db, `insert into public.comments (post_id, author_id, body) values ($1, $2, 'nice')`, [p, other]));

    await rows(db, `update public.settings set choices = choices || '{"commentWho":"Off"}' where user_id = $1`, [owner]);
    await expect(comment()).rejects.toThrow(/row-level security/);
    await rows(db, `update public.settings set choices = choices || '{"commentWho":"People you follow"}' where user_id = $1`, [owner]);
    await expect(comment()).rejects.toThrow(/row-level security/);
    await as(db, owner, () => rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [owner, other]));
    await comment();
  });

  it('allows one level of replies only', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a);
    const top = await as(db, a, async () => (await rows(db, `insert into public.comments (post_id, author_id, body) values ($1, $2, 'top') returning id`, [p, a]))[0].id);
    const reply = await as(db, a, async () => (await rows(db, `insert into public.comments (post_id, author_id, parent_id, body) values ($1, $2, $3, 'r') returning id`, [p, a, top]))[0].id);
    await expect(
      as(db, a, () => rows(db, `insert into public.comments (post_id, author_id, parent_id, body) values ($1, $2, $3, 'rr')`, [p, a, reply])),
    ).rejects.toThrow(/invalid_parent_comment/);
  });

  it('respects dmWho, defaulting to people the recipient follows', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const start = () => as(db, a, () => rows(db, 'select public.start_conversation($1)', [b]));
    await expect(start()).rejects.toThrow(/cannot_message/);
    await as(db, b, () => rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [b, a]));
    await start();
    await rows(db, `update public.settings set choices = choices || '{"dmWho":"No one"}' where user_id = $1`, [b]);
    const conv = (await as(db, a, () => rows(db, 'select public.start_conversation($1) as id', [b])))[0].id;
    await expect(
      as(db, a, () => rows(db, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hi')`, [conv, a])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('minors in discovery', () => {
  it('hides minors from adults they do not follow, in scrolls, explore and user search', async () => {
    const teen = await makeUser(db, { age: 15, username: 'teen.discover' });
    const adult = await makeUser(db, { age: 30 });
    const friend = await makeUser(db, { age: 30 });
    const peer = await makeUser(db, { age: 16 });
    await rows(db, `update public.settings set prefs = prefs || '{"isPrivate":false}' where user_id = $1`, [teen]);
    const p = await makePost(db, teen, { kind: 'scroll', caption: 'teen clip' });
    await rows(db, `insert into public.follows (follower_id, followee_id) values ($1, $2)`, [teen, friend]);

    const sees = (viewer: string) =>
      as(db, viewer, async () => ({
        scrolls: (await rows(db, 'select id from public.scrolls_feed(null, 30) where id = $1', [p])).length,
        explore: (await rows(db, `select id from public.explore('teen clip', null, 60) where id = $1`, [p])).length,
        users: (await rows(db, `select id from public.search_users('teen.discover')`)).length,
      }));

    expect(await sees(adult)).toEqual({ scrolls: 0, explore: 0, users: 0 });
    expect(await sees(friend)).toEqual({ scrolls: 1, explore: 1, users: 1 });
    expect(await sees(peer)).toEqual({ scrolls: 1, explore: 1, users: 1 });
  });
});

describe('moderation', () => {
  const apply = (post: string, verdict: object) =>
    rows(db, 'select public.apply_moderation($1, $2) as r', [post, JSON.stringify(verdict)]).then((r) => r[0].r);

  it('publishes on-topic content', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    expect((await apply(p, { on_topic: true, violation: null, confidence: 0.9, reason: '' })).status).toBe('live');
  });

  it('removes off-topic content with no strike', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    expect((await apply(p, { on_topic: false, violation: null, confidence: 0.9, reason: '' })).status).toBe('off_topic');
    expect(await rows(db, 'select 1 from public.strikes where user_id = $1', [a])).toEqual([]);
  });

  it('rejects a violation with one strike, and a retry adds no second strike', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    const v = { on_topic: true, violation: 'hate_bullying', confidence: 0.8, reason: '' };
    expect(await apply(p, v)).toMatchObject({ status: 'rejected', strikes: 1 });
    expect(await apply(p, v)).toMatchObject({ status: 'rejected', applied: false });
    expect(await rows(db, 'select 1 from public.strikes where user_id = $1', [a])).toHaveLength(1);
  });

  it('removes csam, suspends, and queues for reporting', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    expect(await apply(p, { on_topic: false, violation: 'csam', confidence: 0.5, reason: '' })).toMatchObject({ status: 'removed', severe: true, suspended: true });
    expect(await rows(db, 'select 1 from public.safety_escalations where post_id = $1', [p])).toHaveLength(1);
  });

  it('gives no strike for the text filter or a bad file', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    expect((await apply(p, { on_topic: true, violation: 'text_filter' })).status).toBe('rejected');
    expect(await rows(db, 'select 1 from public.strikes where user_id = $1', [a])).toEqual([]);
  });

  it('lets an appeal overturn: post goes live and the strike is voided', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    await apply(p, { on_topic: true, violation: 'sexual', confidence: 0.6, reason: '' });
    await as(db, a, () => rows(db, 'select public.request_review($1)', [p]));
    expect((await rows(db, 'select status from public.posts where id = $1', [p]))[0].status).toBe('under_review');
    await expect(as(db, a, () => rows(db, 'select public.request_review($1)', [p]))).rejects.toThrow(/not_reviewable/);
    const appeal = (await rows(db, 'select id from public.appeals where post_id = $1', [p]))[0].id;
    await rows(db, 'select public.admin_resolve_appeal($1, true)', [appeal]);
    expect((await rows(db, 'select status from public.posts where id = $1', [p]))[0].status).toBe('live');
    expect((await rows(db, 'select voided from public.strikes where post_id = $1', [p]))[0].voided).toBe(true);
    expect((await rows(db, 'select current from public.streaks where user_id = $1', [a]))[0].current).toBe(1);
  });

  it('keeps the strike when the author discards the rejected post', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'checking' });
    await apply(p, { on_topic: true, violation: 'sexual', confidence: 0.9, reason: '' });
    await as(db, a, () => rows(db, 'delete from public.posts where id = $1', [p]));
    expect(await rows(db, 'select post_id from public.strikes where user_id = $1', [a])).toEqual([{ post_id: null }]);
  });

  it('will not let the author delete a removed post', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { status: 'removed' });
    await as(db, a, () => rows(db, 'delete from public.posts where id = $1', [p]));
    expect(await rows(db, 'select 1 from public.posts where id = $1', [p])).toHaveLength(1);
  });
});

describe('feeds and notifications', () => {
  it('home feed has followed people and you, not strangers', async () => {
    const me = await makeUser(db);
    const friend = await makeUser(db);
    const stranger = await makeUser(db);
    await as(db, me, () => rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [me, friend]));
    const mine = await makePost(db, me);
    const theirs = await makePost(db, friend);
    const other = await makePost(db, stranger);
    const ids = (await as(db, me, () => rows(db, 'select id from public.home_feed(null, 50)'))).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([mine, theirs]));
    expect(ids).not.toContain(other);
  });

  it('notifies on like, comment and mention, and honors the toggle', async () => {
    const me = await makeUser(db);
    const fan = await makeUser(db);
    const third = await makeUser(db, { username: 'third.person' });
    const p = await makePost(db, me);
    await as(db, fan, () => rows(db, 'insert into public.likes (user_id, post_id) values ($1, $2)', [fan, p]));
    await as(db, fan, () => rows(db, `insert into public.comments (post_id, author_id, body) values ($1, $2, 'hey @third.person')`, [p, fan]));
    const types = async (u: string) => (await rows(db, 'select type from public.notifications where user_id = $1 order by type', [u])).map((r) => r.type);
    expect(await types(me)).toEqual(['comment', 'like']);
    expect(await types(third)).toEqual(['mention']);

    await as(db, fan, () => rows(db, 'delete from public.likes where user_id = $1 and post_id = $2', [fan, p]));
    expect(await types(me)).toEqual(['comment']);

    await rows(db, `update public.settings set prefs = prefs || '{"nLikes":false}' where user_id = $1`, [me]);
    await as(db, fan, () => rows(db, 'insert into public.likes (user_id, post_id) values ($1, $2)', [fan, p]));
    expect(await types(me)).toEqual(['comment']);
  });

  it('respects who sees your streak', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const see = () => as(db, b, () => rows(db, 'select 1 from public.streaks where user_id = $1', [a]));
    expect(await see()).toHaveLength(1); // Everyone by default.
    await rows(db, `update public.settings set choices = choices || '{"streakWho":"Followers"}' where user_id = $1`, [a]);
    expect(await see()).toEqual([]);
    await rows(db, `update public.settings set choices = choices || '{"streakWho":"Only me"}' where user_id = $1`, [a]);
    expect(await see()).toEqual([]);
  });

  it('cascades account deletion through everything', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const p = await makePost(db, a);
    await as(db, b, () => rows(db, 'insert into public.likes (user_id, post_id) values ($1, $2)', [b, p]));
    await rows(db, 'delete from auth.users where id = $1', [a]);
    for (const t of ['profiles where id', 'posts where author_id', 'settings where user_id', 'streaks where user_id']) {
      expect(await rows(db, `select 1 from public.${t} = $1`, [a])).toEqual([]);
    }
    expect(await rows(db, 'select 1 from public.likes where post_id = $1', [p])).toEqual([]);
  });
});

describe('seed.sql', () => {
  it('loads cleanly', async () => {
    const fresh = await freshDb();
    await fresh.exec(seedSql());
    const r = await rows(fresh, `select count(*)::int as n from public.posts where status = 'live'`);
    expect(r[0].n).toBeGreaterThan(0);
  }, 60_000);
});

describe('blocked accounts list', () => {
  it('shows the blocker who they blocked, and nobody else', async () => {
    const a = await makeUser(db, { username: 'blocker.one' });
    const b = await makeUser(db, { username: 'blocked.one' });
    await as(db, a, () => rows(db, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [a, b]));
    expect((await as(db, a, () => rows(db, 'select username from public.blocked_accounts()'))).map((r) => r.username)).toEqual(['blocked.one']);
    expect(await as(db, b, () => rows(db, 'select username from public.blocked_accounts()'))).toEqual([]);
  });
});

describe('exposure', () => {
  it('gives signed-out users nothing', async () => {
    await db.exec('set role anon');
    try {
      await expect(rows(db, 'select id from public.profiles')).rejects.toThrow(/permission denied/);
      await expect(rows(db, 'select id from public.post_cards')).rejects.toThrow(/permission denied/);
      await expect(rows(db, 'select public.username_available($1)', ['x'])).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });

  it('keeps the appeals view and appeal resolution away from users', async () => {
    const a = await makeUser(db);
    await expect(as(db, a, () => rows(db, 'select * from public.admin_open_appeals'))).rejects.toThrow(/permission denied/);
    await expect(as(db, a, () => rows(db, `select public.admin_resolve_appeal(gen_random_uuid(), true)`))).rejects.toThrow(/permission denied/);
  });

  it('never lets a user read another user\'s moderation notes or settings', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    await expect(as(db, a, () => rows(db, 'select moderation from public.posts'))).rejects.toThrow(/permission denied/);
    expect(await as(db, a, () => rows(db, 'select prefs from public.settings where user_id = $1', [b]))).toEqual([]);
    await as(db, a, () => rows(db, `update public.settings set prefs = '{}' where user_id = $1`, [b]));
    expect((await rows(db, 'select prefs from public.settings where user_id = $1', [b]))[0].prefs.autoFreeze).toBe(true);
  });
});
