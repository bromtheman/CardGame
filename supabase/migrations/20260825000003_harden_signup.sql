-- Phase 1 final-review hardening: lock down the trigger function and give
-- signup failures readable messages instead of raw constraint errors.

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'username', ''),
      'player_' || substr(replace(new.id::text, '-', ''), 1, 8)
    )
  );
  return new;
exception
  when unique_violation then
    raise exception 'Username is already taken';
  when check_violation then
    raise exception 'Username must be 3-20 letters, numbers, or underscores';
end;
$$;
