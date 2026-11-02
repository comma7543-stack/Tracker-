import { beforeAll, describe, expect, it } from 'vitest';
import { as, Db, freshDb, makeUser, rows } from './harness';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);

const setGoal = (uid: string, goal: string) =>
  as(db, uid, () => rows(db, 'update public.profiles set goal = $1 where id = $2', [goal, uid]));
const see = async (viewer: string, owner: string) =>
  (await as(db, viewer, () => rows(db, 'select public.profile_goal($1) as goal', [owner])))[0].goal;

describe('goals on profiles', () => {
  it('saves the goal from sign-up', async () => {
    const id = '00000000-0000-4000-8000-0000000abcde';
    await rows(db, 'insert into auth.users (id) values ($1)', [id]);
    await as(db, id, () => rows(db, `select public.complete_signup('New', 'goal.user', '1990-01-01', 'test', 'UTC', '  Run a marathon ')`));
    expect(await see(id, id)).toBe('Run a marathon');
  });

  it('shows a public account goal to anyone, and none when empty', async () => {
    const owner = await makeUser(db);
    const stranger = await makeUser(db);
    expect(await see(stranger, owner)).toBeNull();
    await setGoal(owner, 'Bench 100kg');
    expect(await see(stranger, owner)).toBe('Bench 100kg');
  });

  it('shows a private account goal only to approved supporters', async () => {
    const owner = await makeUser(db);
    const fan = await makeUser(db);
    await rows(db, 'update public.profiles set is_private = true, goal = $1 where id = $2', ['Read 50 books', owner]);
    expect(await see(fan, owner)).toBeNull();
    await as(db, fan, () => rows(db, 'insert into public.follows (follower_id, followee_id) values ($1, $2)', [fan, owner]));
    expect(await see(fan, owner)).toBeNull();
    await rows(db, `update public.follows set status = 'accepted' where follower_id = $1`, [fan]);
    expect(await see(fan, owner)).toBe('Read 50 books');
    expect(await see(owner, owner)).toBe('Read 50 books');
  });

  it('hides the goal from blocked people', async () => {
    const owner = await makeUser(db);
    const other = await makeUser(db);
    await setGoal(owner, 'Learn to swim');
    await rows(db, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [owner, other]);
    expect(await see(other, owner)).toBeNull();
  });

  it('cannot be read around the private-account rule, or set for someone else', async () => {
    const owner = await makeUser(db);
    const other = await makeUser(db);
    await expect(as(db, other, () => rows(db, 'select goal from public.profiles where id = $1', [owner]))).rejects.toThrow(/permission denied/);
    await setGoal(owner, 'Mine');
    await as(db, other, () => rows(db, `update public.profiles set goal = 'Hacked' where id = $1`, [owner]));
    expect(await see(owner, owner)).toBe('Mine');
  });

  it('caps the length', async () => {
    const owner = await makeUser(db);
    await expect(setGoal(owner, 'x'.repeat(101))).rejects.toThrow(/goal_length/);
  });
});
