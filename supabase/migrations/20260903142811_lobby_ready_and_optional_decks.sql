-- Deck choice moves into the lobby (spec R-2), so the host no longer has one
-- at insert time. Ready flags (R-7) make consent explicit, and the two clears
-- in lobby-action (SET_DECK clears your own, UPDATE_SETTINGS clears the
-- guest's) are what deliver R-8: you cannot be started into a board you did
-- not agree to.
alter table public.lobbies alter column host_deck_id drop not null;
alter table public.lobbies add column host_ready  boolean not null default false;
alter table public.lobbies add column guest_ready boolean not null default false;

-- R-1 wants each seat to show the opponent's faction, and the client cannot
-- read it from decks: decks_select_own is owner-only, so the opponent's deck
-- row is invisible. Widening that policy is not an option — RLS cannot
-- restrict by COLUMN, so "let them read the faction" would expose the whole
-- row, cards included, which is the opponent's entire decklist. SET_DECK
-- copies the faction here instead, onto a table every signed-in player may
-- already read. Written only beside its own *_deck_id, in the same statement,
-- so the pair cannot disagree.
alter table public.lobbies add column host_faction  text;
alter table public.lobbies add column guest_faction text;

-- Replaced only to add the ready-flag checks: a lobby must not be born
-- pre-readied by a hand-crafted insert. Every other condition is carried over
-- from the original policy unchanged.
drop policy "lobbies_insert_as_host" on public.lobbies;

create policy "lobbies_insert_as_host" on public.lobbies
  for insert to authenticated
  with check (
    (select auth.uid()) = host_id
    and status = 'open'
    and guest_id is null
    and guest_deck_id is null
    and game_id is null
    and host_ready = false
    and guest_ready = false
  );
