import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const follow = async (a: string, b: string) => {
  await rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [a, b]);
  await rows(db, `update public.follows set status = 'accepted' where follower_id = $1 and followee_id = $2`, [a, b]);
};

/** Two people with a conversation. Friends follow each other. */
async function pair(opts: { ageA?: number; ageB?: number; friends?: boolean } = {}) {
  const a = await makeUser(db, { age: opts.ageA ?? 30 });
  const b = await makeUser(db, { age: opts.ageB ?? 30 });
  if (opts.friends !== false) {
    await follow(a, b);
    await follow(b, a);
  }
  const [{ id }] = await rows(db, 'insert into public.conversations (dm_key) values ($1) returning id', [`${a}:${b}`]);
  await rows(db, 'insert into public.conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3)', [id, a, b]);
  return { a, b, conv: id as string };
}

const sendPhoto = (uid: string, conv: string, path = `${conv}/x.jpg`) =>
  as(db, uid, () => rows(db, 'insert into public.messages (conversation_id, sender_id, photo_path) values ($1, $2, $3) returning id', [conv, uid, path]));
const allowed = async (uid: string, conv: string) =>
  (await as(db, uid, () => rows(db, 'select public.can_send_photos($1) as ok', [conv])))[0].ok;
const upload = (uid: string, name: string) =>
  as(db, uid, () => rows(db, `insert into storage.objects (bucket_id, name) values ('message-photos', $1)`, [name]));
const canSee = async (uid: string, name: string) =>
  (await as(db, uid, () => rows(db, `select name from storage.objects where bucket_id = 'message-photos' and name = $1`, [name]))).length === 1;

describe('who can send photos', () => {
  it('lets two adults who follow each other', async () => {
    const { a, conv } = await pair();
    expect(await allowed(a, conv)).toBe(true);
    await sendPhoto(a, conv);
    await upload(a, `${conv}/y.jpg`);
  });

  it.each([
    ['a teen sending to an adult', 16, 30],
    ['an adult sending to a teen', 30, 16],
    ['two teens', 15, 15],
  ])('never allows %s, even as friends', async (_n, ageA, ageB) => {
    const { a, conv } = await pair({ ageA, ageB });
    expect(await allowed(a, conv)).toBe(false);
    await expect(sendPhoto(a, conv)).rejects.toThrow(/photo_not_allowed/);
    await expect(upload(a, `${conv}/z.jpg`)).rejects.toThrow();
  });

  it('refuses adults who only follow one way', async () => {
    const { a, b, conv } = await pair({ friends: false });
    await follow(b, a);
    expect(await allowed(a, conv)).toBe(false);
    await expect(sendPhoto(a, conv)).rejects.toThrow();
  });

  it('refuses a blocked friend', async () => {
    const { a, b, conv } = await pair();
    await rows(db, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [b, a]);
    await expect(sendPhoto(a, conv)).rejects.toThrow();
  });

  it('refuses a path outside the conversation, and strangers uploading to it', async () => {
    const { a, conv } = await pair();
    const other = await pair();
    await expect(sendPhoto(a, conv, `${other.conv}/x.jpg`)).rejects.toThrow(/photo_not_allowed/);
    await expect(sendPhoto(a, conv, `${conv}/../x.jpg`)).rejects.toThrow(/photo_not_allowed/);
    await expect(upload(a, `${other.conv}/x.jpg`)).rejects.toThrow();
  });

  it('still needs a body or a photo', async () => {
    const { a, conv } = await pair();
    await expect(as(db, a, () => rows(db, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, '')`, [conv, a]))).rejects.toThrow();
  });

  it('leaves text messages between teens working', async () => {
    const { a, conv } = await pair({ ageA: 15, ageB: 15 });
    await as(db, a, () => rows(db, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hi')`, [conv, a]));
  });
});

describe('reporting a photo', () => {
  async function sent() {
    const p = await pair();
    const name = `${p.conv}/x.jpg`;
    const [{ id }] = await sendPhoto(p.a, p.conv, name);
    await rows(db, `insert into storage.objects (bucket_id, name) values ('message-photos', $1)`, [name]);
    return { ...p, id: id as string, name };
  }
  const report = (uid: string, id: string) => as(db, uid, () => rows(db, 'select public.report_photo($1)', [id]));

  it('shows the photo only to the two people in the chat', async () => {
    const { a, b, name } = await sent();
    const stranger = await makeUser(db);
    expect(await canSee(a, name)).toBe(true);
    expect(await canSee(b, name)).toBe(true);
    expect(await canSee(stranger, name)).toBe(false);
  });

  it('removes it for both people at once, and files one report', async () => {
    const { a, b, id, name } = await sent();
    await report(b, id);
    expect(await canSee(a, name)).toBe(false);
    expect(await canSee(b, name)).toBe(false);
    const [m] = await as(db, a, () => rows(db, 'select photo_removed_at from public.messages where id = $1', [id]));
    expect(m.photo_removed_at).not.toBeNull();
    await report(b, id);
    expect(await rows(db, `select id from public.reports where target_id = $1`, [id])).toHaveLength(1);
  });

  it('lets only the recipient report', async () => {
    const { a, id } = await sent();
    const stranger = await makeUser(db);
    await expect(report(a, id)).rejects.toThrow(/not_allowed/);
    await expect(report(stranger, id)).rejects.toThrow(/not_allowed/);
  });

  it('never lets anyone undo a removal directly', async () => {
    const { a, b, id } = await sent();
    await report(b, id);
    await expect(as(db, a, () => rows(db, 'update public.messages set photo_removed_at = null where id = $1', [id]))).rejects.toThrow(/permission denied/);
  });
});
