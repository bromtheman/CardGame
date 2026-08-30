-- Atomic game-action commit: version-checked public-state update plus both
-- private rows in one transaction. Service-role only (called by game-action).
create or replace function public.apply_action_tx(
  p_game_id uuid,
  p_expected_version integer,
  p_game jsonb,
  p_a_state jsonb,
  p_b_state jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_version integer;
begin
  update public.games
     set status = p_game->>'status',
         winner_id = nullif(p_game->>'winnerId', '')::uuid,
         turn_number = (p_game->>'turnNumber')::numeric,
         active_player = (p_game->>'activePlayer')::uuid,
         state = p_game->'state',
         version = version + 1
   where id = p_game_id
     and version = p_expected_version
  returning version into v_new_version;
  if v_new_version is null then
    return null;
  end if;
  update public.game_players
     set hand = p_a_state->'hand', deck = p_a_state->'deck'
   where game_id = p_game_id and player_id = (p_game->>'playerA')::uuid;
  update public.game_players
     set hand = p_b_state->'hand', deck = p_b_state->'deck'
   where game_id = p_game_id and player_id = (p_game->>'playerB')::uuid;
  return v_new_version;
end;
$$;

revoke all on function public.apply_action_tx(uuid, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_action_tx(uuid, integer, jsonb, jsonb, jsonb)
  to service_role;
