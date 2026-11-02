-- Server-side settings the owner fills in once from the SQL editor (see
-- supabase/sql/setup_services.sql). Private schema plus no grants: users can't read
-- the push secret or the function URLs.

create table private.app_config (
  key text primary key,
  value text not null
);
revoke all on private.app_config from public, anon, authenticated;

create function private.config(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from private.app_config where key = p_key
$$;

revoke all on function private.config(text) from public, anon, authenticated;
