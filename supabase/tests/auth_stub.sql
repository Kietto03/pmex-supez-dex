-- Minimal stand-in for Supabase's auth schema so the migration and the RLS tests
-- run on a plain Postgres (see supabase/tests/run.sh). Never applied to Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data  jsonb not null default '{}'
);
-- Same contract as Supabase: the signed-in user's id comes from the JWT "sub" claim
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
