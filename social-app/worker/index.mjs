// The video worker. Runs anywhere Node and ffmpeg run: a small cloud server
// (Fly.io, Render, Railway) or a computer that stays on. See worker/README.md.
//
// Every few seconds it takes videos waiting in 'checking', re-encodes them on the
// server (stripping GPS and all metadata), replaces the phone's frames with its own,
// then asks moderate-post to check the post. Once an hour it deletes the files of
// stories that expired over a day ago.
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processVideo } from './process.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MODERATION_SWEEP_SECRET } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MODERATION_SWEEP_SECRET) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and MODERATION_SWEEP_SECRET.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PROOF_FRAMES = 10; // Same as the app (lib/media.ts).
const FRAMES = 4;
const POLL_MS = 5000;

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function handle(post) {
  const dir = await mkdtemp(join(tmpdir(), 'video-'));
  try {
    const { data, error } = await admin.storage.from('media').download(post.media_path);
    if (error) throw error;
    const input = join(dir, 'input');
    await writeFile(input, Buffer.from(await data.arrayBuffer()));

    const frames = post.goal_proof ? PROOF_FRAMES : FRAMES;
    const result = await processVideo(input, join(dir, 'out'), frames);
    if (!result.ok) {
      log('rejected', post.id, result.error);
      await admin.rpc('worker_video_done', { p_post: post.id, p_ok: false, p_info: { error: result.error } });
      return;
    }

    // Same path, so nothing else has to change. The bucket allows video/mp4 for any name.
    const up = await admin.storage.from('media').upload(post.media_path, await readFile(result.video), { contentType: 'video/mp4', upsert: true });
    if (up.error) throw up.error;

    // Remove every frame the phone sent, then write the server's.
    const folder = `${post.media_path}.frames`;
    const { data: old } = await admin.storage.from('media').list(folder, { limit: 100 });
    if (old?.length) await admin.storage.from('media').remove(old.map((f) => `${folder}/${f.name}`));
    for (let i = 0; i < result.framePaths.length; i += 1) {
      const f = await admin.storage.from('media').upload(`${folder}/${i}.jpg`, await readFile(result.framePaths[i]), { contentType: 'image/jpeg', upsert: true });
      if (f.error) throw f.error;
    }

    const done = await admin.rpc('worker_video_done', { p_post: post.id, p_ok: true, p_info: { seconds: result.seconds, frames: result.framePaths.length } });
    if (done.error) throw done.error;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/moderate-post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sweep-secret': MODERATION_SWEEP_SECRET, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ worker: true, post_id: post.id }),
    });
    // If this fails, the post stays in 'checking' and the minute sweep picks it up.
    log('processed', post.id, `${result.seconds}s`, 'moderation', res.status);
  } catch (e) {
    // The claim lapses after 10 minutes and another round tries again.
    log('failed', post.id, e instanceof Error ? e.message : String(e));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function cleanStories() {
  const { data, error } = await admin.rpc('worker_expired_stories', { p_limit: 100 });
  if (error || !data?.length) return;
  const paths = data.flatMap((s) => (s.media_type === 'video'
    ? [s.media_path, ...Array.from({ length: PROOF_FRAMES }, (_, i) => `${s.media_path}.frames/${i}.jpg`)]
    : [s.media_path]));
  const { error: rmError } = await admin.storage.from('media').remove(paths);
  if (rmError) return log('story cleanup failed', rmError.message);
  await admin.rpc('worker_mark_files_deleted', { p_posts: data.map((s) => s.id) });
  log('deleted files of', data.length, 'expired stories');
}

let lastClean = 0;
async function loop() {
  for (;;) {
    try {
      const { data, error } = await admin.rpc('worker_claim_videos', { p_limit: 2 });
      if (error) throw error;
      for (const post of data ?? []) await handle(post);
      if (Date.now() - lastClean > 3600_000) { lastClean = Date.now(); await cleanStories(); }
      if (!data?.length) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (e) {
      log('loop error', e instanceof Error ? e.message : String(e));
      await new Promise((r) => setTimeout(r, POLL_MS * 4));
    }
  }
}

log('video worker started');
loop();
