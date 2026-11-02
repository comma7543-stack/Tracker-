// Runs the real migrations in PGlite (Postgres compiled to WASM) so RLS and
// triggers are tested without Docker. Only auth and storage are stubbed.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', 'supabase');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
  create function extensions.crypt(text, text) returns text language sql as $$ select 'hash' $$;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key, instance_id uuid, aud text, role text, email text,
    encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb,
    raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
    confirmation_token text, recovery_token text, email_change_token_new text, email_change text
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  create publication supabase_realtime;
  -- Same default as a Supabase project: everything granted to every role.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export type Db = PGlite;

export async function freshDb(): Promise<Db> {
  const db = await PGlite.create({ extensions: { citext } });
  await db.exec(SUPABASE_STUB);
  const dir = join(ROOT, 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  return db;
}

export const seedSql = () => readFileSync(join(ROOT, 'seed.sql'), 'utf8');

let n = 0;
export async function makeUser(db: Db, opts: { username?: string; age?: number } = {}): Promise<string> {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const age = opts.age ?? 30;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into public.profiles (id, username, full_name, dob, is_private, terms_version, terms_accepted_at)
     values ($1, $2, 'Test User', current_date - make_interval(years => $3::int), $3::int < 18, 'test', now())`,
    [id, opts.username ?? `user_${n}`, age],
  );
  return id;
}

/** Runs fn as the logged-in user, under RLS, then returns to superuser. */
export async function as<T>(db: Db, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('test.uid', '${uid}', false); set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('test.uid', '', false);`);
  }
}

export async function rows(db: Db, sql: string, params: unknown[] = []) {
  return (await db.query<Record<string, any>>(sql, params)).rows;
}

let postN = 0;
/** Inserts as superuser, so tests can pick status and created_at. */
export async function makePost(
  db: Db,
  author: string,
  opts: { status?: string; kind?: string; at?: string; alsoScroll?: boolean; video?: boolean; caption?: string } = {},
): Promise<string> {
  postN += 1;
  const video = opts.video || opts.kind === 'scroll' || opts.alsoScroll;
  const res = await rows(
    db,
    `insert into public.posts (author_id, kind, media_path, media_type, caption, topic, subtag, status, also_scroll, created_at)
     values ($1, $2, $3, $4, $5, 'Fitness', 'Gym', $6, $7, coalesce($8::timestamptz, now())) returning id`,
    [
      author,
      opts.kind ?? 'post',
      `${author}/${postN}.${video ? 'mp4' : 'jpg'}`,
      video ? 'video' : 'photo',
      opts.caption ?? 'leg day',
      opts.status ?? 'live',
      !!opts.alsoScroll,
      opts.at ?? null,
    ],
  );
  return res[0].id;
}
