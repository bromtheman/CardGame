-- PracticeAI, the practice-game opponent (docs/superpowers/specs/2026-09-16-ai-opponent-design.md).
--
-- 1. profiles.is_bot marks the one bot account. The row itself is created by
--    hand (auth user + the handle_new_user trigger) — see docs/claude/supabase.md,
--    "PracticeAI bootstrap". lobby-action's ADD_BOT looks the bot up by this
--    flag and answers 503 until it is set.
alter table public.profiles add column is_bot boolean not null default false;

-- 2. start_game_tx: read turn_number / status / winner_id from p_game, with the
--    old defaults when the keys are absent. A practice game whose bot was
--    rolled first is inserted AFTER its opening turn (spec §4.2), and before
--    this the RPC hard-defaulted turn_number to 1.0 and dropped that turn.
--    Same signature, so this replaces the function in place and keeps its
--    grants (service_role only).
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
  insert into public.games (id, lobby_id, player_a, player_b, active_player, settings, state,
                            turn_number, status, winner_id)
  values (
    (p_game->>'id')::uuid,
    p_lobby_id,
    (p_game->>'playerA')::uuid,
    (p_game->>'playerB')::uuid,
    (p_game->>'activePlayer')::uuid,
    p_game->'settings',
    p_game->'state',
    coalesce((p_game->>'turnNumber')::numeric, 1.0),
    coalesce(p_game->>'status', 'active'),
    nullif(p_game->>'winnerId', '')::uuid
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
