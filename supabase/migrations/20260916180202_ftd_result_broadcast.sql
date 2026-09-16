-- FtD result wake-up: push the "a result has landed" signal to the open overlay.
--
-- Before this, the battle overlay POLLED `battle-report`'s `fetch` op every
-- 15 s (frontend/src/pages/game/ftdReporting.ts), so a result the mod posted
-- in 0.6 s took up to 15 s more to show up in the browser. It polled because
-- `battle_tokens` is deliberately outside the realtime publication and has no
-- RLS policy (see 20260901222000_create_battle_tokens.sql) — the
-- postgres_changes route the rest of the board uses was closed to it, and
-- rightly: its rows are one player's live token hashes.
--
-- Broadcast from the database needs neither. When `redeem_battle_token`
-- stores a report, the trigger below calls `realtime.send` on a PRIVATE,
-- game-scoped topic with a payload that is only a wake-up — game id, battle
-- key, timestamp. No token, no hash, no prefill. The overlay answers by
-- calling `fetch`, which stays the one and only way to read a result, with
-- the same JWT + membership check it always had. So:
--
--   * `battle_tokens` stays unpublished and policy-less.
--   * `battle-report` still changes no game state (it does not even know
--     this trigger exists — the redeem RPC is unchanged).
--   * Who may hear the wake-up is decided by the `realtime.messages` policy
--     at the bottom: the two participants of that game, nobody else.
--
-- `realtime.send` swallows its own failures as a WARNING, so a broken
-- broadcast can never fail a redeem; the overlay keeps a slow poll as the
-- fallback for exactly that case.
--
-- The topic and event strings are also in shared/battleReport.ts
-- (`ftdResultTopic`, `FTD_RESULT_EVENT`); shared/battleReport.test.ts reads
-- this file to keep the two in step. Change one, change both.

create or replace function public.notify_ftd_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'gameId', new.game_id,
      'battleKey', new.battle_key,
      'reportedAt', new.reported_at
    ),
    'ftd_result',
    'game:' || new.game_id::text || ':ftd',
    true  -- private: joining the topic goes through the policy below
  );
  return null;
end;
$$;

-- A trigger function cannot be called directly, but keep the surface explicit
-- like redeem_battle_token's.
revoke all on function public.notify_ftd_result() from public, anon, authenticated;

-- `of reported` + the WHEN clause: exactly once, at the moment a report lands.
-- `issue` retiring older tokens touches only used_at and never fires this.
create trigger battle_tokens_ftd_result
  after update of reported on public.battle_tokens
  for each row
  when (old.reported is null and new.reported is not null)
  execute function public.notify_ftd_result();

-- Who may JOIN `game:<id>:ftd`: the two captains of that game. Realtime
-- evaluates this once per join (it inserts a probe row and rolls it back),
-- with `realtime.topic()` set to the topic being joined and auth.uid() to the
-- joining user. The game id is parsed out of the topic with a strict UUID
-- pattern so the cast can never raise; a topic that does not match yields
-- null, matches no game, and is refused.
--
-- No INSERT policy: clients have nothing to say on this topic. The only sender
-- is the trigger above, which runs as its definer (`postgres`, bypassrls).
create policy "participants receive their game's ftd result"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.games g
    where g.id = substring(
        (select realtime.topic())
        from '^game:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):ftd$'
      )::uuid
      and (select auth.uid()) in (g.player_a, g.player_b)
  )
);
