-- Battle tokens: how a From The Depths mod reports a fight's outcome back.
--
-- The site generates a `.customBattle` file (shared/customBattle.ts) carrying a
-- `CardGame` block; a mod inside the game reads the outcome and POSTs it to the
-- `battle-report` edge function with the token from that block. The token is
-- the ONLY credential a mod ever holds — it is deliberately not a Supabase
-- session, because it is written in clear text to the player's Downloads folder
-- and travels with a file they may hand to someone else.
--
-- Four things bound it, and all four matter:
--   * single use    (`used_at`, set by redeem_battle_token below)
--   * short lived   (`expires_at`, BATTLE_TOKEN_TTL_MS in shared/battleReport.ts)
--   * one battle    (`battle_key`, a fingerprint the function recomputes from
--                    the live games row — see battleKeyOf)
--   * one verb      it can prefill a report and nothing else. It cannot submit,
--                    approve, or touch game state.
--
-- What it explicitly does NOT do is make a reported result trustworthy. The
-- server cannot verify a fight happened, exactly as it cannot today when a
-- player types HP numbers into the overlay by hand. The integrity property is
-- unchanged and lives entirely in the engine: DECIDE_BATTLE_REPORT refuses
-- `actor === report.submittedBy` (403), so the OTHER captain must approve.
-- Nothing here may ever be extended into an auto-approve.

create table public.battle_tokens (
  -- The token itself is never stored. `battle-report` hashes what it is given
  -- and looks the hash up, so a database leak yields no usable credential.
  token_hash text primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  side text not null check (side in ('a','b')),
  zone_id integer not null,
  battle_key text not null,
  -- The prefill: instanceId -> ending HP percent, plus the reporting metadata
  -- the overlay shows. Written by redeem_battle_token, read back by the
  -- function's `fetch` op. Null until the mod reports.
  reported jsonb,
  reported_at timestamptz,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index battle_tokens_game_id_idx on public.battle_tokens (game_id);
create index battle_tokens_player_id_idx on public.battle_tokens (player_id);
create index battle_tokens_expires_at_idx on public.battle_tokens (expires_at);

alter table public.battle_tokens enable row level security;

-- Deliberately NO policies. RLS is on and nothing is granted, so `anon` and
-- `authenticated` can neither read nor write this table; every access goes
-- through `battle-report`'s service-role client, which bypasses RLS. This is
-- the same shape the rest of the schema already uses for function-owned data
-- (games rows are "written only via functions/RPC"; game_players holds private
-- hands). A SELECT policy here would expose one player's live token hashes and
-- another's prefill to any signed-in client — do not add one.

-- Single-use redemption, atomic. The conditional UPDATE *is* the mutex: two
-- mods racing the same token both run this statement, exactly one matches
-- `used_at is null`, and the loser gets a null back. Same pattern lobby-action
-- uses to claim a lobby seat.
--
-- Redemption and storing the result are one statement on purpose: a token must
-- never be burned without its report landing, and a report must never land
-- twice.
create or replace function public.redeem_battle_token(
  p_token_hash text,
  p_game_id uuid,
  p_battle_key text,
  p_reported jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  update public.battle_tokens
     set used_at = now(),
         reported = p_reported,
         reported_at = now()
   where token_hash = p_token_hash
     and game_id = p_game_id
     and battle_key = p_battle_key
     and used_at is null
     and expires_at > now()
  returning jsonb_build_object(
    'side', side, 'playerId', player_id, 'zoneId', zone_id
  ) into v_row;
  -- Null on every failure — wrong token, wrong game, wrong battle, already
  -- used, expired. The caller answers all five identically so a probe cannot
  -- tell them apart.
  return v_row;
end;
$$;

revoke all on function public.redeem_battle_token(text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.redeem_battle_token(text, uuid, text, jsonb)
  to service_role;
