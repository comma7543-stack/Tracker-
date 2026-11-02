// Deletes the caller's files, then their auth user. Foreign keys cascade through
// every table, and deleting the user ends their sessions on all devices.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function removeFolder(bucket: string, folder: string) {
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    if (error) throw error;
    if (!data.length) return;
    // Storage reports subfolders (video frames) as entries with no id.
    for (const sub of data.filter((f) => f.id === null)) await removeFolder(bucket, `${folder}/${sub.name}`);
    const files = data.filter((f) => f.id !== null).map((f) => `${folder}/${f.name}`);
    if (files.length) {
      const { error: removeError } = await admin.storage.from(bucket).remove(files);
      if (removeError) throw removeError;
    }
  }
}

Deno.serve(async (req) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  const { data } = await admin.auth.getUser(token);
  const user = data?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  try {
    await removeFolder('media', user.id);
    await removeFolder('avatars', user.id);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  } catch (e) {
    console.error('delete_account_failed', user.id, e);
    return json({ error: 'delete_failed' }, 500);
  }
  return json({ ok: true });
});
