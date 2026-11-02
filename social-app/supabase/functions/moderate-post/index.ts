import { createClient } from 'npm:@supabase/supabase-js@2';
import { moderate, PostToCheck } from '../_shared/moderation.ts';
import { isBad } from '../_shared/profanity.ts';
import { callModel } from '../_shared/providers.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const MAX_ATTEMPTS = 5;
// The most model calls per day across all users. Change it without redeploying:
// npx supabase secrets set MODERATION_DAILY_CHECKS=2000
const DEFAULT_DAILY_CHECKS = 1000;

const dailyChecks = () => {
  const n = Number(Deno.env.get('MODERATION_DAILY_CHECKS'));
  return Deno.env.has('MODERATION_DAILY_CHECKS') && Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CHECKS;
};
const POST_COLS = 'id, author_id, kind, media_path, media_type, caption, topic, subtag, status, moderation, goal_proof, proof_goal, media_ready';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const readFile = async (path: string) => {
  const { data, error } = await admin.storage.from('media').download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
};

const readHead = async (path: string) => {
  const { data, error } = await admin.storage.from('media').createSignedUrl(path, 60);
  if (error) throw error;
  const res = await fetch(data.signedUrl, { headers: { Range: 'bytes=0-31' } });
  if (!res.ok) throw new Error(`read_head_${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

const listFrames = async (mediaPath: string) => {
  const folder = `${mediaPath}.frames`;
  const { data, error } = await admin.storage.from('media').list(folder, { limit: 10, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  return data.map((f) => `${folder}/${f.name}`);
};

const apply = async (postId: string, verdict: object) => {
  const { data, error } = await admin.rpc('apply_moderation', { p_post: postId, p_verdict: verdict });
  if (error) throw error;
  return data as Record<string, unknown>;
};

// TODO(owner's parent + lawyer): finalize before launch. US providers must report
// to the NCMEC CyberTipline and preserve reported content for a set period; Korea
// has its own rules. This pulls the file out of reach and queues the case in
// safety_escalations. Nothing is sent to NCMEC or deleted automatically yet.
async function escalate(post: { id: string; author_id: string; media_path: string }, violation: string) {
  const quarantinePath = `${post.author_id}/${post.id}/${post.media_path.split('/').pop()}`;
  const { error } = await admin.storage.from('media').move(post.media_path, quarantinePath, { destinationBucket: 'quarantine' });
  if (error) console.error('quarantine_failed', post.id, error.message);
  else await admin.from('safety_escalations').update({ quarantine_path: quarantinePath }).eq('post_id', post.id);

  const { data: frames } = await admin.storage.from('media').list(`${post.media_path}.frames`);
  if (frames?.length) await admin.storage.from('media').remove(frames.map((f) => `${post.media_path}.frames/${f.name}`));

  if (violation === 'csam') {
    await admin.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', post.author_id);
    await admin.auth.admin.updateUserById(post.author_id, { ban_duration: '876000h' });
  }
}

// deno-lint-ignore no-explicit-any
async function check(post: any) {
  // The video worker hasn't re-encoded this yet. It calls back here when it has.
  if (post.media_ready === false) return { status: 'checking', waiting: 'processing' };
  try {
    const claim = async () => {
      const { data, error } = await admin.rpc('claim_moderation_check', { p_post: post.id, p_daily_limit: dailyChecks() });
      if (error) throw error;
      return data as 'ok' | 'busy' | 'over_limit';
    };
    const result = await moderate(post as PostToCheck, { isBad, readFile, readHead, listFrames, callModel, claim, apply });
    if (result.severe) {
      const { data } = await admin.from('posts').select('moderation').eq('id', post.id).single();
      await escalate(post, data?.moderation?.violation);
    }
    return {
      status: result.status, strikes: result.strikes, suspended: result.suspended, waiting: result.waiting,
      goal_finished: result.goal_finished, certificate_id: result.certificate_id, goal_reason: result.goal_reason,
    };
  } catch (e) {
    // Fail closed: the post stays in 'checking' and the retry job tries again.
    const attempts = (post.moderation?.attempts ?? 0) + 1;
    const message = e instanceof Error ? e.message : String(e);
    console.error('moderation_failed', post.id, message);
    await admin.from('posts').update({ moderation: { attempts, last_error: message } }).eq('id', post.id).eq('status', 'checking');
    return { status: 'checking' };
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));

  // The video worker, right after it finishes a video. Same secret as the sweep.
  if (body.worker) {
    const secret = Deno.env.get('MODERATION_SWEEP_SECRET');
    if (!secret || req.headers.get('x-sweep-secret') !== secret) return json({ error: 'forbidden' }, 403);
    const { data: post } = await admin.from('posts').select(POST_COLS).eq('id', body.post_id).maybeSingle();
    if (!post) return json({ error: 'not_found' }, 404);
    if (post.status !== 'checking') return json({ status: post.status });
    return json(await check(post));
  }

  if (body.sweep) {
    const secret = Deno.env.get('MODERATION_SWEEP_SECRET');
    if (!secret || req.headers.get('x-sweep-secret') !== secret) return json({ error: 'forbidden' }, 403);
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data } = await admin.from('posts').select(POST_COLS).eq('status', 'checking').lt('created_at', cutoff).limit(20);
    // After MAX_ATTEMPTS a post stays hidden for a person: see README "Stuck posts".
    const due = (data ?? []).filter((p) => (p.moderation?.attempts ?? 0) < MAX_ATTEMPTS);
    let checked = 0;
    for (const post of due) {
      // Over today's ceiling the rest would wait too, so stop reading their files.
      if ((await check(post)).waiting === 'over_limit') break;
      checked += 1;
    }
    return json({ checked });
  }

  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth?.user) return json({ error: 'unauthorized' }, 401);

  const { data: post } = await admin.from('posts').select(POST_COLS).eq('id', body.post_id).maybeSingle();
  if (!post || post.author_id !== auth.user.id) return json({ error: 'not_found' }, 404);
  if (post.status !== 'checking') return json({ status: post.status });

  return json(await check(post));
});
