import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makePost, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const setGoal = (uid: string, goal: string) =>
  as(db, uid, () => rows(db, 'update public.profiles set goal = $1 where id = $2', [goal, uid]));
const goalOf = async (uid: string) => (await rows(db, 'select goal from public.profiles where id = $1', [uid]))[0].goal;
const age = (uid: string) => rows(db, `update public.profiles set goal_set_at = now() - interval '25 hours' where id = $1`, [uid]);

async function withGoal(goal = 'Run a marathon') {
  const uid = await makeUser(db);
  await setGoal(uid, goal);
  return uid;
}
const proof = async (uid: string, kind = 'post') => {
  const id = randomUUID();
  await as(db, uid, () => rows(
    db,
    `insert into public.posts (id, author_id, kind, media_path, media_type, topic, subtag, goal_proof) values ($1, $2, $3, $4, 'video', 'Fitness', 'Running', true)`,
    [id, uid, kind, `${uid}/${id}.mp4`],
  ));
  return id;
};
const judge = async (post: string, verdict: object) =>
  (await rows(db, 'select public.apply_moderation($1, $2) as r', [post, JSON.stringify({ on_topic: true, violation: null, confidence: 0.9, reason: 'ok', ...verdict })]))[0].r;

describe('locking a goal', () => {
  it('can be fixed for 24 hours, without that restarting the clock', async () => {
    const me = await withGoal();
    const first = (await rows(db, 'select goal_set_at from public.profiles where id = $1', [me]))[0].goal_set_at;
    await setGoal(me, 'Run a half marathon');
    expect(await goalOf(me)).toBe('Run a half marathon');
    expect((await rows(db, 'select goal_set_at from public.profiles where id = $1', [me]))[0].goal_set_at).toEqual(first);
  });

  it('locks after 24 hours, including clearing it', async () => {
    const me = await withGoal();
    await age(me);
    await expect(setGoal(me, 'Something easier')).rejects.toThrow(/goal_locked/);
    await expect(setGoal(me, '')).rejects.toThrow(/goal_locked/);
    expect(await goalOf(me)).toBe('Run a marathon');
  });

  it('still lets the rest of the profile change', async () => {
    const me = await withGoal();
    await age(me);
    await as(db, me, () => rows(db, `update public.profiles set bio = 'New' where id = $1`, [me]));
  });

  it('never lets a person write the clock', async () => {
    const me = await withGoal();
    await expect(as(db, me, () => rows(db, `update public.profiles set goal_set_at = now() where id = $1`, [me]))).rejects.toThrow(/permission denied/);
  });

  it('reports only your own status', async () => {
    const me = await withGoal();
    const [row] = await as(db, me, () => rows(db, 'select * from public.goal_status()'));
    expect(row.goal).toBe('Run a marathon');
    expect(row.set_at).toBeTruthy();
  });
});

describe('proving a goal', () => {
  it('finishes it when the AI is sure, then a new goal can be set', async () => {
    const me = await withGoal();
    await age(me);
    const post = await proof(me);
    const r = await judge(post, { goal_achieved: true, goal_reason: 'Finish line.' });
    expect(r).toMatchObject({ status: 'live', goal_finished: true });
    expect(await goalOf(me)).toBe('');
    const certs = await rows(db, 'select goal, post_id from public.goal_certificates where id = $1', [r.certificate_id]);
    expect(certs[0]).toMatchObject({ goal: 'Run a marathon', post_id: post });
    await setGoal(me, 'Run an ultra');
    expect(await goalOf(me)).toBe('Run an ultra');
  });

  it('works from a story too', async () => {
    const me = await withGoal();
    expect(await judge(await proof(me, 'story'), { goal_achieved: true })).toMatchObject({ goal_finished: true });
  });

  it.each([
    ['the AI says no', { goal_achieved: false, goal_reason: 'Only training.' }],
    ['the AI is unsure', { goal_achieved: true, confidence: 0.5 }],
    ['the post is off topic', { goal_achieved: true, on_topic: false }],
    ['the post breaks a rule', { goal_achieved: true, violation: 'hate_bullying' }],
  ])('keeps the goal when %s', async (_n, verdict) => {
    const me = await withGoal();
    const r = await judge(await proof(me), verdict);
    expect(r.goal_finished).toBe(false);
    expect(await goalOf(me)).toBe('Run a marathon');
  });

  it('ignores a verdict on a post that was not offered as proof', async () => {
    const me = await withGoal();
    const r = await judge(await makePost(db, me, { status: 'checking' }), { goal_achieved: true });
    expect(r.goal_finished).toBe(false);
    expect(await goalOf(me)).toBe('Run a marathon');
  });

  it('does not finish a goal changed after the video was judged', async () => {
    const me = await withGoal();
    const post = await proof(me);
    await setGoal(me, 'Something harder');
    expect((await judge(post, { goal_achieved: true })).goal_finished).toBe(false);
    expect(await goalOf(me)).toBe('Something harder');
  });

  it('needs a goal and a video, and copies the goal itself', async () => {
    const none = await makeUser(db);
    await expect(proof(none)).rejects.toThrow(/no_goal/);
    const me = await withGoal();
    await expect(as(db, me, () => rows(db, `insert into public.posts (author_id, kind, media_path, media_type, topic, subtag, goal_proof) values ($1, 'post', $2, 'photo', 'Fitness', 'Running', true)`, [me, `${me}/x.jpg`]))).rejects.toThrow(/proof_is_video/);
    await expect(as(db, me, () => rows(db, `insert into public.posts (author_id, kind, media_path, media_type, topic, subtag, proof_goal) values ($1, 'post', 'x.mp4', 'video', 'Fitness', 'Running', 'Easy')`, [me]))).rejects.toThrow(/permission denied/);
  });

  it('allows 3 tries a day, stories included, even if they are deleted', async () => {
    const me = await withGoal();
    await proof(me, 'story');
    const second = await proof(me, 'story');
    await proof(me, 'story');
    await as(db, me, () => rows(db, 'delete from public.posts where id = $1', [second]));
    await expect(proof(me, 'story')).rejects.toThrow(/goal_proof_limit/);
  });

  it('never lets a person award themself', async () => {
    const me = await withGoal();
    await expect(as(db, me, () => rows(db, `insert into public.goal_certificates (user_id, goal) values ($1, 'Fake')`, [me]))).rejects.toThrow(/permission denied/);
    await expect(as(db, me, () => rows(db, `select public.apply_moderation(gen_random_uuid(), '{}')`))).rejects.toThrow(/permission denied/);
  });
});

describe('certificates', () => {
  async function earned() {
    const me = await withGoal();
    const r = await judge(await proof(me), { goal_achieved: true });
    return { me, id: r.certificate_id as string };
  }
  const see = (viewer: string, id: string) => as(db, viewer, () => rows(db, 'select goal from public.goal_certificates where id = $1', [id]));

  it('shows on public accounts, and only to approved supporters on private ones', async () => {
    const { me, id } = await earned();
    const stranger = await makeUser(db);
    expect(await see(stranger, id)).toHaveLength(1);
    await rows(db, 'update public.profiles set is_private = true where id = $1', [me]);
    expect(await see(stranger, id)).toEqual([]);
    expect(await see(me, id)).toHaveLength(1);
  });

  it('survives its proof post being deleted', async () => {
    const { me, id } = await earned();
    await rows(db, 'delete from public.posts where author_id = $1', [me]);
    expect((await rows(db, 'select post_id from public.goal_certificates where id = $1', [id]))[0].post_id).toBeNull();
  });
});

describe('editing a comment', () => {
  async function comment() {
    const author = await makeUser(db);
    const post = await makePost(db, author);
    const [{ id }] = await as(db, author, () => rows(db, `insert into public.comments (post_id, author_id, body) values ($1, $2, 'First') returning id`, [post, author]));
    return { author, id: id as string };
  }
  const edit = (uid: string, id: string, body: string) =>
    as(db, uid, () => rows(db, 'update public.comments set body = $1 where id = $2', [body, id]));

  it('marks it edited and keeps what it first said', async () => {
    const { author, id } = await comment();
    await edit(author, id, 'Second');
    await edit(author, id, 'Third');
    const [row] = await rows(db, 'select body, edited_at, original_body from public.comments where id = $1', [id]);
    expect(row.body).toBe('Third');
    expect(row.edited_at).toBeTruthy();
    expect(row.original_body).toBe('First');
  });

  it('only lets the author edit, and hides the original from everyone', async () => {
    const { author, id } = await comment();
    const other = await makeUser(db);
    await edit(other, id, 'Hacked');
    expect((await rows(db, 'select body from public.comments where id = $1', [id]))[0].body).toBe('First');
    await expect(as(db, author, () => rows(db, 'select original_body from public.comments where id = $1', [id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, author, () => rows(db, `update public.comments set author_id = $1 where id = $2`, [other, id]))).rejects.toThrow(/permission denied/);
  });

  it('shows up on the card', async () => {
    const { author, id } = await comment();
    await edit(author, id, 'Second');
    const [card] = await as(db, author, () => rows(db, 'select body, edited_at from public.comment_cards where id = $1', [id]));
    expect(card.body).toBe('Second');
    expect(card.edited_at).toBeTruthy();
  });
});
