// Password reset from a username. Always answers the same, so it can't be used to
// find out who has an account. Phone-only accounts must reset by typing their
// number on the Forgot screen: the app can't be told the number here.
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// A few per username and caller every 15 minutes, so this can't be used to flood
// someone's inbox. Over the limit it still answers ok, to give nothing away.
const allowed = async (key: string, max: number) => {
  const { data, error } = await admin.rpc('note_login_attempt', { p_key: key, p_max: max });
  return !error && data === true;
};

Deno.serve(async (req) => {
  const { username } = await req.json().catch(() => ({}));
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ok = typeof username === 'string'
    && (await allowed(`reset-u:${username.toLowerCase()}`, 3)) && (await allowed(`reset-ip:${ip}`, 10));
  if (ok && typeof username === 'string') {
    const { data: profile } = await admin.from('profiles').select('id').eq('username', username.toLowerCase()).maybeSingle();
    if (profile) {
      const { data } = await admin.auth.admin.getUserById(profile.id);
      if (data?.user?.email) {
        const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
        await anon.auth.resetPasswordForEmail(data.user.email, { redirectTo: 'appname://auth-callback' });
      }
    }
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
