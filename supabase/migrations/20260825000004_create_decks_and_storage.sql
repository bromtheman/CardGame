create table public.decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  faction text not null check (faction in ('DWG','GT','LH','OW','SS','WF')),
  cards jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index decks_owner_id_idx on public.decks (owner_id);

alter table public.decks enable row level security;

create policy "decks_select_own" on public.decks
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "decks_insert_own" on public.decks
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "decks_update_own" on public.decks
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "decks_delete_own" on public.decks
  for delete to authenticated using ((select auth.uid()) = owner_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger decks_set_updated_at
  before update on public.decks
  for each row execute function public.set_updated_at();

-- Card image storage: public read, 2 MB, images only.
-- Deliberately NO policies on storage.objects: the MCP role cannot create
-- them (table owned by supabase_storage_admin), so clients get no direct
-- write access. All uploads go through the create-card edge function's
-- service-role client, which bypasses RLS. Public reads need no policy
-- (public bucket, served via the public-object endpoint).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 2097152,
        array['image/jpeg','image/png','image/webp']);
