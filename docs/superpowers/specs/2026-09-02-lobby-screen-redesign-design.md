# Lobby screen redesign — design

Status: approved 2026-09-02. Supersedes the inline lobby card on
`LobbiesPage` described by the Phase 3 lobby flow.

## 1. Problem

The lobby "waiting screen" is a card embedded in the middle of the lobby
browser. It shows a name, a settings summary and one line of prose
("Waiting for an opponent…"). It does not say who is in the lobby, decks
are bound before you ever get there, and only the host is navigated into
the game when it starts — the guest's lobby silently disappears and they
must find an "Enter game" button on the browser page.

Target: a StarCraft II-style lobby. Seats you can read at a glance, deck
choice made in the lobby, a picture of the battlefield you are about to
fight over, and both players dropped onto the board when the host starts.

## 2. Requirements

- R-1 Both players see who occupies each seat, with their faction and
  ready state.
- R-2 Deck selection happens inside the lobby, not on the create or join
  control.
- R-3 Starting the game navigates **both** players to the board with no
  further interaction.
- R-4 The site nav bar is hidden on the lobby route; a command strip
  carries a back link and lobby identity, mirroring the game board.
- R-5 The lobby shows a miniature of the board, zone-for-zone, coloured
  from the host's live settings.
- R-6 The host may edit lobby settings from inside the lobby.
- R-7 Readiness is explicit: each player toggles Ready, and the host can
  only start when both are ready.
- R-8 A player can never be started into settings they did not agree to.
- R-9 The host may kick the guest.
- R-10 Browser rows show host name, occupancy and a board miniature.

Out of scope: lobby chat, spectators, more than two seats, avatars.

## 3. Data model

### 3.1 Migration

`supabase/migrations/<timestamp>_lobby_ready_and_optional_decks.sql`:

```sql
alter table public.lobbies alter column host_deck_id drop not null;
alter table public.lobbies add column host_ready    boolean not null default false;
alter table public.lobbies add column guest_ready   boolean not null default false;
alter table public.lobbies add column host_faction  text;
alter table public.lobbies add column guest_faction text;
```

`host_deck_id` was `NOT NULL`, which is what forces deck choice onto the
create form (R-2). It is not named in any RLS policy, so dropping the
constraint needs no policy change on its own.

### 3.1.1 Why the factions are denormalized

R-1 wants each seat to show the opponent's faction, and the client cannot
read it from `decks`: `decks_select_own` is owner-only, so the opponent's
deck row is invisible. Widening that policy is not an option — RLS cannot
restrict by column, so "let them read the faction" would expose the whole
row, `cards` included, which is the opponent's entire decklist.

So `SET_DECK` copies the deck's faction onto the lobby, which every
signed-in player may already read. Faction is the only field that
crosses; the deck's name and contents are structurally unreachable by the
client rather than merely unrendered. That is what makes §5.3's
"faction yes, deck name no" an enforced property instead of a UI
convention.

These columns are a cache of `decks.faction` and are only ever written
beside their `*_deck_id`, in the same statement, so the pair cannot
disagree.

`lobbies_insert_as_host` is replaced to additionally require
`host_ready = false and guest_ready = false`, so a lobby cannot be born
pre-readied by a hand-crafted insert. Its existing checks
(`auth.uid() = host_id`, `status = 'open'`, `guest_id is null`,
`guest_deck_id is null`, `game_id is null`) are carried over unchanged.

The `lobbies_select_authenticated` and `lobbies_delete_own` policies are
untouched.

### 3.2 Generated types

`frontend/src/lib/database.types.ts` is regenerated after the migration
applies. `host_deck_id` becomes `string | null`; `host_ready` and
`guest_ready` appear as `boolean`.

## 4. Server contract (`lobby-action`)

Every op below is conditioned on `status = 'open'` inside its `WHERE`
clause, so none of them can mutate a lobby that `START` has already
locked to `starting`.

| Op | Caller | Effect |
|---|---|---|
| `JOIN` | any | `deckId` is now **optional**. Claims the guest seat only. The existing atomic claim (`status = 'open'`, `guest_id is null`, `host_id != caller`) is unchanged. |
| `SET_DECK` | host or guest | Requires `deckId`; verifies `decks.owner_id = caller`. Writes the caller's `*_deck_id` **and `*_faction`** (§3.1.1) and clears **the caller's own** ready flag. |
| `SET_READY` | host or guest | Writes the caller's own ready flag. Rejects `ready = true` when that player's deck is unset. |
| `UPDATE_SETTINGS` | host | Runs `validateLobbySettings` server-side; writes `settings` and clears `guest_ready`. |
| `KICK` | host | Clears `guest_id`, `guest_deck_id`, `guest_faction`, `guest_ready`. |
| `LEAVE` | guest | As today, and additionally clears `guest_faction` and `guest_ready`. |
| `START` | host | Unchanged except that the atomic `open → starting` lock gains `host_deck_id is not null`, `host_ready = true` and `guest_ready = true` to its `WHERE`. |

### 4.1 Consent invariant (R-8)

Two clears carry R-8:

- `SET_DECK` clears the caller's own ready flag — you re-affirm after
  changing what you are bringing.
- `UPDATE_SETTINGS` clears `guest_ready` — the guest re-affirms after the
  host changes the battlefield. It does **not** clear `host_ready`: the
  host authored the change, so their consent is implicit.

Races between `SET_READY` and `UPDATE_SETTINGS` are benign in either
order, because `START` re-checks both flags inside the same statement
that takes the mutex. There is no window in which a stale `true` can be
read and then acted on.

`START`'s existing failure path — revert `starting → open` on any error
after the lock — is unchanged and still covers the new preconditions.

## 5. Client

### 5.1 Route

`/lobby/:id`, lazily loaded as a named export like every other page.
`App.tsx` extends its existing nav-hiding test:

```ts
const onGameBoard = useMatch('/game/:id') !== null
const onLobby = useMatch('/lobby/:id') !== null
```

`NavBar` renders when neither matches (R-4). The lobby's own command
strip carries `← Harbor`, the lobby name, the caller's role, and a
status pill, mirroring `GameBoardPage`'s strip.

### 5.2 New modules

- `frontend/src/lib/lobbies.ts` — `useLobbyQuery(id)`, the `lobbyAction`
  invoker moved off `LobbiesPage`, and the pure functions in §5.4.
- `frontend/src/lib/biomeStyles.ts` — `BIOME_TINT` and `BIOME_BORDER`,
  lifted verbatim out of `BoardZone.tsx`, which then imports them.
  Single source of truth so the preview and the real board cannot drift.
- `frontend/src/components/BoardPreview.tsx` — takes `LobbySettings` and
  a size, renders the zones left-to-right in board order using those
  maps (R-5, R-10).
- `frontend/src/pages/LobbyPage.tsx` — the screen itself.

### 5.3 Screen layout

Left column, two seat rows (R-1):

- Your own row carries a deck `<select>` over `useDecksQuery()` and your
  Ready toggle.
- The opponent's row shows their username and their deck's **faction**
  only — never the deck name, which would leak strategy with no way to
  un-see it — plus their ready state. The faction is read off
  `lobbies.*_faction` (§3.1.1), not from `decks`, which the client cannot
  read for another player at all.
- The host's view of the guest row carries a kick control (R-9).
- An empty guest seat reads as an invitation, not an error.

Right column: `BoardPreview` above a settings panel. For the host the
panel holds the zone biome selects, base-HP inputs and resources-per-turn
input moved off the create form (R-6); for the guest the same values
render as static text. Biome selects commit on `change`; number inputs
commit on `blur`, so typing a five-digit HP value sends one request, not
five.

Bottom bar: host gets `Start game` (disabled until both ready) and
`Cancel lobby`; guest gets `Leave`. Both get their Ready toggle in their
seat row. Function errors render inline beside the triggering control,
using the established `FunctionsHttpError` → `errors.join('; ')` pattern.

### 5.4 Navigation and realtime (R-3)

The page subscribes with `useRealtimeInvalidate` on the `lobbies` table,
filtered to `id=eq.<lobbyId>`, invalidating the `['lobby', id]` key. It
feeds the refetched row to a pure function:

```ts
lobbyVerdict(lobby: LobbyRow | null, myId: string, wasSeated: boolean):
  | { kind: 'waiting' }
  | { kind: 'to-game'; gameId: string }
  | { kind: 'ejected'; notice: string }
  | { kind: 'joinable' }
  | { kind: 'unavailable'; notice: string }
```

| Row state | Verdict |
|---|---|
| `game_id` set, caller is host or guest | `to-game` |
| caller is host or guest, `game_id` null, `status` is `open` or `starting` | `waiting` |
| caller is neither seat, `status = 'open'`, guest seat free | `joinable` |
| caller is neither seat, otherwise | `unavailable`: "That lobby is full or closed." |
| caller was seated (`wasSeated`) and is no longer | `ejected`: "You were removed from the lobby." |
| `lobby === null` (row deleted) | `ejected`: "The host closed the lobby." |
| `status = 'closed'`, `game_id` null | `ejected`: "That lobby is no longer open." |

Distinguishing `ejected` from `unavailable` needs to know whether the
caller was previously seated. The page holds that as a ref across renders
and passes it in as `wasSeated`, keeping `lobbyVerdict` itself pure.

An effect acts on the verdict: `to-game` navigates to `/game/:gameId`
with `replace: true`; `ejected` navigates to `/lobbies` with the notice
in router state, which `LobbiesPage` renders as a banner.

`to-game` fires for host and guest alike — that is R-3. The host also
navigates directly from `START`'s response as a fast path, but no longer
depends on it: a dropped response leaves the host in the same
self-healing state as the guest.

Actions the caller took themselves navigate immediately from their own
success response and suppress the verdict notice, so a host who cancels
their lobby is not told "The host closed the lobby" and a guest who
leaves is not told they were removed. The verdict path is what catches
the *other* player.

`joinable` means a lobby URL is shareable — an incidental benefit of the
route, not a separate feature.

Also pure and unit-tested: `canStart(lobby)` (both decks set, both ready,
status open) and `seatOf(lobby, myId)`.

### 5.5 Changes to `LobbiesPage`

- The create form loses every settings control and the deck select; it
  becomes a name field and a button that inserts with `host_deck_id: null`
  and navigates to `/lobby/:id`.
- The standalone "Join with:" deck select and its `joinDeckId` state are
  removed. `JOIN` then navigates into the lobby.
- The inline `myLobby` card is removed; an in-progress lobby renders as a
  link into `/lobby/:id`.
- Browser rows gain host username (via `useUsernames`), an occupancy pill
  and a small `BoardPreview` (R-10).
- A notice banner renders `location.state.notice` when present.

## 6. Testing

- `frontend/src/lib/lobbies.test.ts` — `lobbyVerdict` across every row of
  the §5.4 table, and `canStart` with each precondition missing in turn.
  Written before the implementation.
- `frontend/src/lib/biomeStyles.test.ts` — every `ZONE_TYPES` value has a
  tint and a border, so a new biome cannot silently render untinted.
  Mirrors the existing `keywords.test.ts` guard.
- `scripts/smoke-lib.mjs` — **a required repair, not an addition.** Its
  shared `startGame` posts a lobby and calls `START` immediately, so the
  ready gate breaks *every* existing harness (`smoke-wave4/5/6/7.mjs`,
  `smoke-battle-report.mjs`, `mutation-harness.mjs`). Two `SET_READY`
  calls between its JOIN and START fix all of them at once. This is the
  regression gate for §4 and must pass before any new coverage is
  written.
- `scripts/smoke-lobby.mjs` — the new edge-function ops have no local
  Supabase to run against, so a two-account smoke script in the existing
  `smoke-*.mjs` style drives create → join → set decks → ready → start,
  asserting that each precondition rejects when unmet, that the consent
  clears in §4.1 fire correctly, and that `games` gains a row.
- Browser verification with two `qa-login.mjs` sessions, confirming the
  guest reaches the board without clicking.

No `shared/` module changes, so `functions:sync` has nothing to carry;
the engine suite is a regression guard only.

## 7. Deploy sequence

1. Apply the migration.
2. Regenerate `database.types.ts`.
3. `npm run functions:deploy -- lobby-action` from a branch up to date
   with `main`; verify the version incremented, by content.
4. Ship the frontend.

Between steps 3 and 4 a lobby created by the *old* frontend cannot be
started by the *new* function: its ready flags are `false` and the old UI
offers no way to set them. It self-clears — cancel and recreate the
lobby — and is called out here so it is not mistaken for a defect.
