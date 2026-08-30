-- Recovered from the remote migration history (version 20260827155256), which
-- had no local file: it was applied through MCP `apply_migration` and never
-- written back to the repo. Content is the exact statement recorded in
-- supabase_migrations.schema_migrations, so replaying it on a fresh preview
-- branch reproduces production.
alter table public.profiles
  add column is_admin boolean not null default false;

revoke update on public.profiles from anon, authenticated;
grant update (username) on public.profiles to authenticated;
