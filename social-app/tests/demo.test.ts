// Runs the demo backend through the real Supabase client, so a mismatch in
// how it answers shows up here rather than as an empty screen on a phone.
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoFetch, demoMediaUrl, demoRpcNames } from '../lib/demo';

const sb = createClient('https://demo.invalid', 'x', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: demoFetch },
});
const ME = '00000000-0000-4000-8000-000000000001';

describe('demo backend', () => {
  it('signs in and returns a session', async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email: 'a@b.co', password: 'x' });
    expect(error).toBeNull();
    expect(data.session?.user.id).toBe(ME);
  });

  it('serves the feeds, paging without repeats', async () => {
    const first = (await sb.rpc('home_feed', { p_before: null, p_limit: 3 })).data as { id: string; created_at: string; username: string }[];
    expect(first).toHaveLength(3);
    expect(first[0].username).toBe('minjun.lifts');
    const next = (await sb.rpc('home_feed', { p_before: first[2].created_at, p_limit: 3 })).data as { id: string }[];
    expect(next.length).toBeGreaterThan(0);
    expect(next.some((p) => first.some((f) => f.id === p.id))).toBe(false);
    expect((await sb.rpc('scrolls_feed', { p_before: null, p_limit: 10 })).data).toHaveLength(3);
  });

  it('handles single rows, filters and or', async () => {
    const me = await sb.from('profiles').select('id, username').eq('id', ME).maybeSingle();
    expect(me.data?.username).toBe('alex.lifts');
    const scrolls = await sb.from('post_cards').select('*').eq('author_id', ME).eq('status', 'live').or('kind.eq.scroll,also_scroll.eq.true');
    expect(scrolls.data).toEqual([]);
    const stories = await sb.from('post_cards').select('*').eq('kind', 'story').gt('expires_at', new Date().toISOString()).order('created_at');
    expect(stories.data).toHaveLength(3);
    const some = await sb.from('profiles').select('id').in('id', [ME]);
    expect(some.data).toHaveLength(1);
  });

  it('counts unread notifications', async () => {
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    expect(count).toBe(2);
  });

  it('likes toggle and are not doubled', async () => {
    const likes = async () => (await sb.from('post_cards').select('*').eq('id', 'p1').maybeSingle()).data;
    const before = (await likes()).like_count;
    await sb.from('likes').upsert({ user_id: ME, post_id: 'p1' }, { ignoreDuplicates: true });
    await sb.from('likes').upsert({ user_id: ME, post_id: 'p1' }, { ignoreDuplicates: true });
    expect((await likes()).like_count).toBe(before + 1);
    expect((await likes()).liked_by_me).toBe(true);
    await sb.from('likes').delete().eq('user_id', ME).eq('post_id', 'p1');
    expect((await likes()).like_count).toBe(before);
  });

  it('a new post goes live through moderation and extends the streak', async () => {
    await sb.from('posts').insert({ id: 'new1', author_id: ME, kind: 'post', media_path: 'file:///a.jpg', media_type: 'photo', caption: 'Ran', subtag: 'Running', topic: 'Fitness', also_scroll: false });
    const { data } = await sb.functions.invoke('moderate-post', { body: { post_id: 'new1' } });
    expect(data.status).toBe('live');
    const streak = await sb.from('streaks').select('*').eq('user_id', ME).maybeSingle();
    expect(streak.data?.current).toBe(10);
  });

  it('caption words pick the moderation result', async () => {
    const outcome = async (id: string, caption: string) => {
      await sb.from('posts').insert({ id, author_id: ME, kind: 'post', caption, subtag: 'Gym', media_path: 'x.jpg', media_type: 'photo' });
      return (await sb.functions.invoke('moderate-post', { body: { post_id: id } })).data;
    };
    expect((await outcome('o1', 'off topic')).status).toBe('off_topic');
    expect((await outcome('o2', 'slow')).status).toBe('checking');
    expect((await outcome('o3', 'reject')).strikes).toBe(2);
  });

  it('enforces the daily limit like the real database', async () => {
    const add = () => sb.from('posts').insert({ author_id: ME, kind: 'post', caption: 'x', subtag: 'Gym', media_path: 'x.jpg', media_type: 'photo' });
    const used = (await sb.rpc('posting_limits')).data[0].posts_used;
    for (let i = used; i < 5; i += 1) expect((await add()).error).toBeNull();
    expect((await add()).error?.message).toBe('daily_limit_reached');
    await sb.from('posts').insert({ id: 'story1', author_id: ME, kind: 'story', caption: 'reject', subtag: 'Gym', media_path: 'x.jpg', media_type: 'photo' });
    expect((await sb.functions.invoke('moderate-post', { body: { post_id: 'story1' } })).data.status).toBe('live');
  });

  it('offers photos only between people who follow each other', async () => {
    expect((await sb.rpc('can_send_photos', { p_conversation: 'conv1' })).data).toBe(true);
    expect((await sb.rpc('can_send_photos', { p_conversation: 'conv2' })).data).toBe(false);
  });

  it('shows goals, but not on a private account you do not support', async () => {
    const others = (await sb.from('profiles').select('id, is_private')).data as { id: string; is_private: boolean }[];
    const goal = async (priv: boolean) => (await sb.rpc('profile_goal', { p_user: others.find((p) => p.id !== ME && p.is_private === priv)?.id })).data;
    expect((await sb.rpc('profile_goal', { p_user: ME })).data).toBeTruthy();
    expect(await goal(false)).toBeTruthy();
    expect(await goal(true)).toBeNull();
  });

  it('serves supporter lists, and locks a hidden one', async () => {
    const all = (await sb.from('profiles').select('id, username')).data as { id: string; username: string }[];
    const id = (name: string) => all.find((p) => p.username === name)?.id;
    const minjun = (await sb.rpc('profile_people', { p_user: id('minjun.lifts'), p_list: 'supporters' })).data as { username: string }[];
    expect(minjun.map((p) => p.username)).toContain('alex.lifts');
    expect((await sb.rpc('profile_stats', { p_user: id('dan.reads') })).data[0].lists_visible).toBe(false);
    expect((await sb.rpc('profile_people', { p_user: id('dan.reads'), p_list: 'supporters' })).data).toEqual([]);
  });

  it('saves one setting without touching the rest', async () => {
    await sb.rpc('set_pref', { p_key: 'showLists', p_value: false });
    await sb.rpc('set_choice', { p_key: 'lang', p_value: 'ko' });
    const row = (await sb.from('settings').select('prefs, choices').eq('user_id', ME).maybeSingle()).data;
    expect(row?.prefs).toMatchObject({ showLists: false, nLikes: true });
    expect(row?.choices).toMatchObject({ lang: 'ko', theme: 'white' });
    await sb.rpc('set_pref', { p_key: 'showLists', p_value: true });
  });

  it('locks an old goal, and finishes it only with accepted proof', async () => {
    expect((await sb.from('profiles').update({ goal: 'Something else' }).eq('id', ME)).error?.message).toBe('goal_locked');
    const proof = async (id: string, caption: string, proven: boolean) => {
      await sb.from('posts').insert({ id, author_id: ME, kind: 'story', caption, subtag: 'Gym', media_path: 'x.mp4', media_type: 'video', goal_proof: true });
      return (await sb.functions.invoke('moderate-post', { body: { post_id: id, demo_proven: proven } })).data;
    };
    // The caption must not matter.
    expect((await proof('pr1', 'goal done', false)).goal_finished).toBe(false);
    const done = await proof('pr2', 'training', true);
    expect(done.goal_finished).toBe(true);
    const cert = await sb.from('goal_certificates').select('*').eq('id', done.certificate_id).maybeSingle();
    expect(cert.data?.goal).toBe('Deadlift 200kg');
    expect((await sb.from('profiles').update({ goal: 'Next one' }).eq('id', ME)).error).toBeNull();
    expect((await sb.from('profiles').update({ goal: 'Fixed typo' }).eq('id', ME)).error).toBeNull();
  });

  it('marks an edited comment', async () => {
    await sb.from('comments').update({ body: 'Changed' }).eq('id', 'c1');
    const row = (await sb.from('comment_cards').select('*').eq('id', 'c1').maybeSingle()).data;
    expect(row).toMatchObject({ body: 'Changed' });
    expect(row?.edited_at).toBeTruthy();
  });

  it('removes a reported photo', async () => {
    await sb.rpc('report_photo', { p_message: 'm0' });
    const m = await sb.from('messages').select('*').eq('id', 'm0').maybeSingle();
    expect(m.data?.photo_removed_at).toBeTruthy();
  });

  it('messages reach the inbox', async () => {
    await sb.from('messages').insert({ conversation_id: 'conv2', sender_id: ME, body: 'On my way' });
    const rows = (await sb.rpc('inbox')).data as { conversation_id: string; last_body: string }[];
    expect(rows[0]).toMatchObject({ conversation_id: 'conv2', last_body: 'On my way' });
  });

  it('a sign-up code leads to onboarding, which restores the profile', async () => {
    await sb.auth.signInWithOtp({ email: 'a@b.co' });
    await sb.auth.verifyOtp({ email: 'a@b.co', token: '123456', type: 'email' });
    expect((await sb.from('profiles').select('id').eq('id', ME).maybeSingle()).data).toBeNull();
    await sb.rpc('complete_signup', { p_full_name: 'New', p_username: 'new.user', p_dob: '2010-01-01', p_terms_version: 'x', p_timezone: 'UTC' });
    expect((await sb.from('profiles').select('username').eq('id', ME).maybeSingle()).data?.username).toBe('new.user');
    // A second copy of the profile would read as an error and restart sign-up.
    await sb.rpc('complete_signup', { p_full_name: 'New', p_username: 'new.user', p_dob: '2010-01-01', p_terms_version: 'x', p_timezone: 'UTC' });
    expect((await sb.from('profiles').select('id').eq('id', ME).maybeSingle()).error).toBeNull();
  });

  it('points media at placeholders, and local files at themselves', () => {
    expect(demoMediaUrl('p1.jpg')).toContain('picsum.photos');
    expect(demoMediaUrl('p3.mp4')).toMatch(/\.mp4$/);
    expect(demoMediaUrl('p3.mp4.frames/0.jpg')).toContain('picsum.photos');
    expect(demoMediaUrl('file:///a.jpg')).toBe('file:///a.jpg');
    expect(demoMediaUrl('file:///a.mov.frames/0.jpg')).toContain('picsum.photos');
  });

  it('answers every RPC the app calls', () => {
    const api = readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8');
    const called = [...api.matchAll(/rpc\('(\w+)'/g)].map((m) => m[1]);
    const missing = called.filter((name) => !demoRpcNames().includes(name));
    expect(missing).toEqual([]);
  });

  it('serves For you, suggestions and tags', async () => {
    const forYou = (await sb.rpc('for_you_feed', { p_offset: 0, p_limit: 20 })).data as { username: string }[];
    expect(forYou.map((p) => p.username)).toContain('kai.codes');
    const people = (await sb.rpc('suggested_people', { p_limit: 20 })).data as { username: string }[];
    expect(people.map((p) => p.username)).toEqual(expect.arrayContaining(['kai.codes', 'ari.writes']));
    const tags = (await sb.rpc('trending_tags', { p_limit: 12 })).data as { tag: string }[];
    expect(tags[0].tag).toBe('buildinpublic');
    expect((await sb.rpc('tag_posts', { p_tag: 'buildinpublic', p_offset: 0, p_limit: 40 })).data).toHaveLength(2);
  });

  it('lets the demo account work the review queue', async () => {
    const queue = (await sb.rpc('admin_reports')).data as { report_id: string }[];
    expect(queue.length).toBeGreaterThan(0);
    await sb.rpc('admin_resolve_report', { p_report: queue[0].report_id, p_action: 'dismiss' });
    expect(((await sb.rpc('admin_reports')).data as unknown[]).length).toBe(queue.length - 1);
  });
});
