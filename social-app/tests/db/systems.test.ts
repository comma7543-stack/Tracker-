// Hashtags and search, push, the admin queue, rate limits, analytics and the video worker.
import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makePost, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const ids = (r: Record<string, any>[]) => r.map((x) => x.id);
const follow = (a: string, b: string) => rows(db, `insert into public.follows (follower_id, followee_id, status) values ($1, $2, 'accepted')`, [a, b]);
const goLive = (p: string) => rows(db, `select public.apply_moderation($1, '{"on_topic":true,"violation":null}')`, [p]);

describe('hashtags and search', () => {
  it('reads tags from captions, in English and Korean, case-insensitively', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a, { caption: 'Leg day #LegDay #헬스 #legday and #5x5' });
    const tags = (await rows(db, 'select tag from public.post_tags where post_id = $1 order by tag', [p])).map((r) => r.tag);
    expect(tags).toEqual(['5x5', 'legday', '헬스']);
  });

  it('finds posts by tag through explore and tag_posts, and counts trending by people', async () => {
    const viewer = await makeUser(db);
    const a = await makeUser(db);
    const b = await makeUser(db);
    const p1 = await makePost(db, a, { caption: 'morning #zone2run' });
    const p2 = await makePost(db, b, { caption: 'also #Zone2Run' });
    await makePost(db, a, { caption: 'again #zone2run' });
    expect(ids(await as(db, viewer, () => rows(db, `select id from public.explore('#zone2run', null, 40)`)))).toEqual(expect.arrayContaining([p1, p2]));
    expect(await as(db, viewer, () => rows(db, `select id from public.tag_posts('zone2run', 0, 40)`))).toHaveLength(3);
    const trending = await as(db, viewer, () => rows(db, 'select * from public.trending_tags(30)'));
    expect(trending.find((t) => t.tag === 'zone2run')?.posts).toBe(2);
  });

  it('keeps hidden posts out of tag results', async () => {
    const viewer = await makeUser(db);
    await makePost(db, await makeUser(db), { caption: '#secretplan', status: 'checking' });
    expect(await as(db, viewer, () => rows(db, `select id from public.tag_posts('secretplan', 0, 40)`))).toHaveLength(0);
  });

  it('treats % and _ in a search as plain characters', async () => {
    const viewer = await makeUser(db);
    await makeUser(db, { username: 'abc_def' });
    await makeUser(db, { username: 'abcxdef' });
    const found = await as(db, viewer, () => rows(db, `select username from public.search_users('abc_d', 10)`));
    expect(found.map((r) => r.username)).toEqual(['abc_def']);
    const all = await as(db, viewer, () => rows(db, `select username from public.search_users('%', 10)`));
    expect(all).toHaveLength(0);
  });

  it('notifies people mentioned in a caption once the post goes live', async () => {
    const a = await makeUser(db);
    const named = await makeUser(db, { username: 'named.person' });
    const p = await makePost(db, a, { caption: 'with @named.person today', status: 'checking' });
    expect(await rows(db, `select 1 from public.notifications where user_id = $1 and type = 'mention'`, [named])).toHaveLength(0);
    await goLive(p);
    expect(await rows(db, `select 1 from public.notifications where user_id = $1 and type = 'mention' and post_id = $2`, [named, p])).toHaveLength(1);
  });
});

describe('push', () => {
  it('queues a push for a like only when the person has a phone registered', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db, { username: 'big.fan' });
    const p = await makePost(db, owner);
    await rows(db, 'insert into public.likes (user_id, post_id) values ($1, $2)', [fan, p]);
    expect(await rows(db, 'select 1 from public.push_outbox where user_id = $1', [owner])).toHaveLength(0);

    await as(db, owner, () => rows(db, `select public.register_push_token('ExponentPushToken[aaaaaaaaaa]', 'ios')`));
    await rows(db, 'insert into public.comments (post_id, author_id, body) values ($1, $2, $3)', [p, fan, 'nice work']);
    const [row] = await rows(db, 'select body, data from public.push_outbox where user_id = $1', [owner]);
    expect(row.body).toBe('big.fan commented: nice work');
    expect(row.data.type).toBe('comment');
  });

  it('writes Korean for Korean users and respects the message setting', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db, { username: 'sender.kr' });
    await as(db, a, () => rows(db, `select public.register_push_token('ExponentPushToken[bbbbbbbbbb]', 'android')`));
    await rows(db, `update public.settings set choices = choices || '{"lang": "ko", "dmWho": "Everyone"}' where user_id = $1`, [a]);
    const conv = (await as(db, b, () => rows(db, 'select public.start_conversation($1) as id', [a])))[0].id;
    await as(db, b, () => rows(db, 'insert into public.messages (conversation_id, sender_id, body) values ($1, $2, $3)', [conv, b, '안녕']));
    expect((await rows(db, 'select body from public.push_outbox where user_id = $1', [a]))[0].body).toBe('sender.kr: 안녕');

    await rows(db, `update public.settings set prefs = prefs || '{"nDms": false}' where user_id = $1`, [a]);
    await as(db, b, () => rows(db, 'insert into public.messages (conversation_id, sender_id, body) values ($1, $2, $3)', [conv, b, 'again']));
    expect(await rows(db, 'select 1 from public.push_outbox where user_id = $1', [a])).toHaveLength(1);
  });

  it('hands out each row once, and drops dead tokens', async () => {
    const a = await makeUser(db);
    const fan = await makeUser(db);
    await as(db, a, () => rows(db, `select public.register_push_token('ExponentPushToken[cccccccccc]', 'ios')`));
    await follow(fan, a);
    await rows(db, 'set role service_role');
    try {
      const batch = await rows(db, 'select * from public.claim_push_batch(500)');
      const mine = batch.filter((r) => r.token === 'ExponentPushToken[cccccccccc]');
      expect(mine).toHaveLength(1);
      expect(await rows(db, 'select * from public.claim_push_batch(500)')).toHaveLength(0);
      await rows(db, 'select public.finish_push_batch($1, $2)', [[mine[0].outbox_id], ['ExponentPushToken[cccccccccc]']]);
    } finally {
      await rows(db, 'reset role');
    }
    expect(await rows(db, `select 1 from public.push_tokens where token = 'ExponentPushToken[cccccccccc]'`)).toHaveLength(0);
  });

  it('can only be drained by the service role, and tokens are private', async () => {
    const a = await makeUser(db);
    await expect(as(db, a, () => rows(db, 'select * from public.claim_push_batch(10)'))).rejects.toThrow(/permission denied/);
    await expect(as(db, a, () => rows(db, 'select * from public.push_tokens'))).rejects.toThrow(/permission denied/);
  });
});

describe('admin queue', () => {
  it('is closed to everyone who is not an admin', async () => {
    const a = await makeUser(db);
    for (const fn of ['admin_reports()', 'admin_appeals()', 'admin_counts()', 'admin_metrics()']) {
      await expect(as(db, a, () => rows(db, `select * from public.${fn}`))).rejects.toThrow(/forbidden/);
    }
    expect((await as(db, a, () => rows(db, 'select public.am_i_admin() as v')))[0].v).toBe(false);
  });

  it('shows a report with its content, removes it, and closes every report on it', async () => {
    const admin = await makeUser(db);
    await rows(db, 'insert into public.admins (user_id) values ($1)', [admin]);
    await as(db, admin, () => rows(db, `select public.register_push_token('ExponentPushToken[adminadmin]', 'ios')`));
    const author = await makeUser(db);
    const p = await makePost(db, author, { caption: 'bad thing' });
    const r1 = await makeUser(db);
    const r2 = await makeUser(db);
    await as(db, r1, () => rows(db, `insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'scam')`, [r1, p]));
    await as(db, r2, () => rows(db, `insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')`, [r2, p]));
    expect((await rows(db, 'select body from public.push_outbox where user_id = $1 order by id', [admin]))[0].body).toMatch(/^New report \(post\)/);

    const queue = await as(db, admin, () => rows(db, 'select * from public.admin_reports()'));
    const item = queue.find((q) => q.target_id === p)!;
    expect(item.caption).toBe('bad thing');
    expect(item.open_on_target).toBe(2);

    await as(db, admin, () => rows(db, `select public.admin_resolve_report($1, 'suspend')`, [item.report_id]));
    expect((await rows(db, 'select status from public.posts where id = $1', [p]))[0].status).toBe('removed');
    expect(await rows(db, `select 1 from public.reports where target_id = $1 and status = 'open'`, [p])).toHaveLength(0);
    expect((await rows(db, 'select suspended_until > now() as s from public.profiles where id = $1', [author]))[0].s).toBe(true);
  });

  it('flags reported stories as urgent', async () => {
    const admin = await makeUser(db);
    await rows(db, 'insert into public.admins (user_id) values ($1)', [admin]);
    await as(db, admin, () => rows(db, `select public.register_push_token('ExponentPushToken[admin2admin2]', 'ios')`));
    const story = await makePost(db, await makeUser(db), { kind: 'story' });
    const r = await makeUser(db);
    await as(db, r, () => rows(db, `insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'sexual')`, [r, story]));
    expect((await rows(db, 'select body from public.push_outbox where user_id = $1 order by id desc limit 1', [admin]))[0].body).toMatch(/^Story reported/);
  });

  it('decides appeals and records the admin', async () => {
    const admin = await makeUser(db);
    await rows(db, 'insert into public.admins (user_id) values ($1)', [admin]);
    const author = await makeUser(db);
    const p = await makePost(db, author, { status: 'off_topic' });
    await as(db, author, () => rows(db, 'select public.request_review($1)', [p]));
    const [appeal] = await as(db, admin, () => rows(db, 'select * from public.admin_appeals()'));
    await as(db, admin, () => rows(db, 'select public.admin_decide_appeal($1, true)', [appeal.appeal_id]));
    const [a] = await rows(db, 'select status, reviewer_id from public.appeals where id = $1', [appeal.appeal_id]);
    expect(a).toEqual({ status: 'overturned', reviewer_id: admin });
  });
});

describe('rate limits', () => {
  it('stops a burst of comments, and lets the service role through', async () => {
    const a = await makeUser(db);
    const p = await makePost(db, a);
    const comment = () => as(db, a, () => rows(db, 'insert into public.comments (post_id, author_id, body) values ($1, $2, $3)', [p, a, 'go']));
    for (let i = 0; i < 8; i += 1) await comment();
    await expect(comment()).rejects.toThrow(/rate_limited/);
    await rows(db, 'insert into public.comments (post_id, author_id, body) values ($1, $2, $3)', [p, a, 'admin']);
  });

  it('limits reports and is counted per person', async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const send = (u: string) => as(db, u, () => rows(db, `insert into public.reports (reporter_id, target_type, reason) values ($1, 'problem', 'x')`, [u]));
    for (let i = 0; i < 5; i += 1) await send(a);
    await expect(send(a)).rejects.toThrow(/rate_limited/);
    await send(b);
  });

  it('counts sign-in tries per key in 15 minutes', async () => {
    await rows(db, 'set role service_role');
    try {
      const tries = [];
      for (let i = 0; i < 4; i += 1) tries.push((await rows(db, `select public.note_login_attempt('u:someone', 3) as ok`))[0].ok);
      expect(tries).toEqual([true, true, true, false]);
      expect((await rows(db, `select public.note_login_attempt('u:other', 3) as ok`))[0].ok).toBe(true);
    } finally {
      await rows(db, 'reset role');
    }
  });
});

describe('analytics', () => {
  it('stores valid events, drops bad names and clamps clock skew', async () => {
    const a = await makeUser(db);
    const events = [
      { name: 'app_open', props: { cold: true } },
      { name: 'DROP TABLE', props: {} },
      { name: 'post_shared', at: '2001-01-01T00:00:00Z' },
    ];
    await as(db, a, () => rows(db, `select public.log_events($1::jsonb, 'ios', '1.0.0')`, [JSON.stringify(events)]));
    const stored = await rows(db, 'select name, props, at > now() - interval $$1 hour$$ as recent from public.analytics_events where user_id = $1 order by id', [a]);
    expect(stored.map((s) => s.name)).toEqual(['app_open', 'post_shared']);
    expect(stored[0].props).toEqual({ cold: true });
    expect(stored[1].recent).toBe(true);
    await expect(as(db, a, () => rows(db, 'select * from public.analytics_events'))).rejects.toThrow(/permission denied/);
  });

  it('takes crash reports even when signed out', async () => {
    await db.exec(`select set_config('test.uid', '', false); set role anon;`);
    try {
      await rows(db, `select public.log_error('boom', 'at x', '/home', true, 'android', '1.0.0')`);
    } finally {
      await rows(db, 'reset role');
    }
    expect((await rows(db, `select fatal from public.client_errors where message = 'boom'`))[0].fatal).toBe(true);
  });

  it('builds the funnel and retention views', async () => {
    const [funnel] = await rows(db, 'select * from public.admin_funnel');
    expect(Number(funnel.signed_up)).toBeGreaterThan(0);
    expect(await rows(db, 'select * from public.admin_retention')).not.toHaveLength(0);
  });
});

describe('video worker gate', () => {
  it('holds videos for the worker only when it is turned on', async () => {
    const a = await makeUser(db);
    const before = await makePost(db, a, { kind: 'scroll', status: 'checking' });
    expect((await rows(db, 'select media_ready from public.posts where id = $1', [before]))[0].media_ready).toBe(true);

    await rows(db, `insert into private.app_config values ('video_worker', 'on')`);
    try {
      const video = await makePost(db, a, { kind: 'scroll', status: 'checking' });
      const photo = await makePost(db, a, { status: 'checking' });
      const ready = async (p: string) => (await rows(db, 'select media_ready from public.posts where id = $1', [p]))[0].media_ready;
      expect(await ready(video)).toBe(false);
      expect(await ready(photo)).toBe(true);

      await rows(db, 'set role service_role');
      try {
        expect((await rows(db, 'select public.claim_moderation_check($1, 0) as r', [video]))[0].r).toBe('busy');
        const claimed = await rows(db, 'select * from public.worker_claim_videos(10)');
        expect(ids(claimed)).toContain(video);
        expect(ids(await rows(db, 'select * from public.worker_claim_videos(10)'))).not.toContain(video);
        await rows(db, `select public.worker_video_done($1, true, '{"seconds": 12}')`, [video]);
      } finally {
        await rows(db, 'reset role');
      }
      expect(await ready(video)).toBe(true);
    } finally {
      await rows(db, `delete from private.app_config where key = 'video_worker'`);
    }
  });

  it('rejects a file the worker could not read, with no strike', async () => {
    const a = await makeUser(db);
    await rows(db, `insert into private.app_config values ('video_worker', 'on')`);
    const video = await makePost(db, a, { kind: 'scroll', status: 'checking' });
    await rows(db, `delete from private.app_config where key = 'video_worker'`);
    await rows(db, `select public.worker_video_done($1, false, '{"error": "too_long"}')`, [video]);
    expect((await rows(db, 'select status from public.posts where id = $1', [video]))[0].status).toBe('rejected');
    expect(await rows(db, 'select 1 from public.strikes where user_id = $1', [a])).toHaveLength(0);
  });

  it('is closed to users', async () => {
    const a = await makeUser(db);
    await expect(as(db, a, () => rows(db, 'select * from public.worker_claim_videos(1)'))).rejects.toThrow(/permission denied/);
  });
});
