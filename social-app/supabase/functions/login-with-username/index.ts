// Password login needs an email or phone. Doing the lookup here means the app
// never learns another user's contact details. Every failure looks the same.
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const invalid = () => json({ error: 'invalid_login' }, 401);

// Supabase's auth rate limit sees this function's IP, not the caller's, so tries are
// counted here: 10 per username and 30 per caller address every 15 minutes.
const allowed = async (key: string, max: number) => {
  const { data, error } = await admin.rpc('note_login_attempt', { p_key: key, p_max: max });
  return !error && data === true;
};

const callerIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';

Deno.serve(async (req) => {
  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== 'string' || typeof password !== 'string') return invalid();
  // Both are counted on every try, so a blocked address can't keep guessing by switching names.
  const [byName, byIp] = await Promise.all([allowed(`u:${username.toLowerCase()}`, 10), allowed(`ip:${callerIp(req)}`, 30)]);
  if (!byName || !byIp) return json({ error: 'too_many_tries' }, 429);

  const { data: profile } = await admin.from('profiles').select('id').eq('username', username.toLowerCase()).maybeSingle();
  if (!profile) return invalid();
  const { data: found } = await admin.auth.admin.getUserById(profile.id);
  const user = found?.user;
  if (!user) return invalid();

  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data, error } = user.email
    ? await anon.auth.signInWithPassword({ email: user.email, password })
    : await anon.auth.signInWithPassword({ phone: user.phone!, password });
  if (error || !data.session) return invalid();

  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
