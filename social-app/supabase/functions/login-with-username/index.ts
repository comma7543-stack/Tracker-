// Password login needs an email or phone. Doing the lookup here means the app
// never learns another user's contact details. Every failure looks the same.
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const invalid = () => json({ error: 'invalid_login' }, 401);

// ponytail: Supabase's auth rate limit sees this function's IP, not the caller's.
// Add a per-username attempt counter before launch.
Deno.serve(async (req) => {
  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== 'string' || typeof password !== 'string') return invalid();

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
