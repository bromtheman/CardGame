create table public.lobbies (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  status text not null default 'open' check (status in ('open','starting','closed')),
  settings jsonb not null default '{}'::jsonb,
  host_deck_id uuid not null references public.decks (id) on delete cascade,
  guest_id uuid references public.profiles (id) on delete set null,
  guest_deck_id uuid references public.decks (id) on delete set null,
  game_id uuid,
  created_at timestamptz not null default now()
);

create index lobbies_host_id_idx on public.lobbies (host_id);
create index lobbies_guest_id_idx on public.lobbies (guest_id);
create index lobbies_status_idx on public.lobbies (status);
create index lobbies_host_deck_id_idx on public.lobbies (host_deck_id);
create index lobbies_guest_deck_id_idx on public.lobbies (guest_deck_id);

alter table public.lobbies enable row level security;

-- Readable by every signed-in player: lobby names/settings are not sensitive,
-- and realtime postgres_changes respects RLS — a narrower policy would hide
-- open→closed transitions from third-party browsers, leaving stale lists.
create policy "lobbies_select_authenticated" on public.lobbies
  for select to authenticated using (true);

create policy "lobbies_insert_as_host" on public.lobbies
  for insert to authenticated
  with check (
    (select auth.uid()) = host_id
    and status = 'open'
    and guest_id is null
    and guest_deck_id is null
    and game_id is null
  );

-- Hosts clean up their own lobbies (open = cancel; closed = tidy up after a
-- game). 'starting' is excluded so the START mutex can't be yanked away.
create policy "lobbies_delete_own" on public.lobbies
  for delete to authenticated
  using ((select auth.uid()) = host_id and status in ('open', 'closed'));

create table public.games (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid,
  player_a uuid not null references public.profiles (id),
  player_b uuid not null references public.profiles (id),
  status text not null default 'active' check (status in ('active','complete','abandoned')),
  winner_id uuid references public.profiles (id),
  turn_number numeric not null default 1.0,
  active_player uuid not null references public.profiles (id),
  settings jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index games_player_a_idx on public.games (player_a);
create index games_player_b_idx on public.games (player_b);
create index games_winner_id_idx on public.games (winner_id);
create index games_active_player_idx on public.games (active_player);

alter table public.games enable row level security;

create policy "games_select_participants" on public.games
  for select to authenticated
  using ((select auth.uid()) = player_a or (select auth.uid()) = player_b);

create trigger games_set_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

create table public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  hand jsonb not null default '[]'::jsonb,
  deck jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create index game_players_player_id_idx on public.game_players (player_id);

alter table public.game_players enable row level security;

create policy "game_players_select_own" on public.game_players
  for select to authenticated
  using ((select auth.uid()) = player_id);

create trigger game_players_set_updated_at
  before update on public.game_players
  for each row execute function public.set_updated_at();

-- Atomic game start: one transaction inserts the game and both private
-- states and closes the lobby. Service-role only (called by lobby-action).
create or replace function public.start_game_tx(
  p_lobby_id uuid,
  p_game jsonb,
  p_player_a_state jsonb,
  p_player_b_state jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
begin
  insert into public.games (id, lobby_id, player_a, player_b, active_player, settings, state)
  values (
    (p_game->>'id')::uuid,
    p_lobby_id,
    (p_game->>'playerA')::uuid,
    (p_game->>'playerB')::uuid,
    (p_game->>'activePlayer')::uuid,
    p_game->'settings',
    p_game->'state'
  )
  returning id into v_game_id;

  insert into public.game_players (game_id, player_id, hand, deck)
  values
    (v_game_id, (p_game->>'playerA')::uuid,
     p_player_a_state->'hand', p_player_a_state->'deck'),
    (v_game_id, (p_game->>'playerB')::uuid,
     p_player_b_state->'hand', p_player_b_state->'deck');

  update public.lobbies
     set status = 'closed', game_id = v_game_id
   where id = p_lobby_id;

  return v_game_id;
end;
$$;

revoke all on function public.start_game_tx(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_game_tx(uuid, jsonb, jsonb, jsonb)
  to service_role;

-- Late FK: lobbies.game_id references games (created above in this file);
-- set-null on game deletion so no dangling handoff links survive.
alter table public.lobbies
  add constraint lobbies_game_id_fkey
  foreign key (game_id) references public.games (id) on delete set null;
create index lobbies_game_id_idx on public.lobbies (game_id);

-- Realtime: push changes for the lobby browser and (Phase 4) live games.
alter publication supabase_realtime add table public.lobbies;
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
