// Password reset from a username. Always answers the same, so it can't be used to
// find out who has an account. Phone-only accounts must reset by typing their
// number on the Forgot screen: the app can't be told the number here.
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  const { username } = await req.json().catch(() => ({}));
  if (typeof username === 'string') {
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
