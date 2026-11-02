// Sends queued push notifications through Expo. Called by the database right after
// something is queued, and once a minute by the sweep job. Both send the shared
// secret; nothing else can call it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { drain, ExpoMessage, OutboxRow } from '../_shared/push.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function send(messages: ExpoMessage[]) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  // Optional: set when "Enhanced push security" is on in the Expo account.
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(messages) });
  if (!res.ok) throw new Error(`expo_${res.status}`);
  const body = await res.json();
  return body.data ?? [];
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) return json({ error: 'forbidden' }, 403);

  const result = await drain({
    claim: async () => {
      const { data, error } = await admin.rpc('claim_push_batch', { p_limit: 300 });
      if (error) throw error;
      return (data ?? []) as OutboxRow[];
    },
    send,
    finish: async (sent, dead) => {
      const { error } = await admin.rpc('finish_push_batch', { p_sent: sent, p_dead_tokens: dead });
      if (error) console.error('finish_push_failed', error.message);
    },
  });
  return json(result);
});
