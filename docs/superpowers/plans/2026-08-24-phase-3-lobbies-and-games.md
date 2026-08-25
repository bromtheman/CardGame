# Phase 3: Lobbies & Game Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players create lobbies (zone biomes + per-zone base HP + deck), see them appear live, join with a deck, and the host starts a real game: decks validated, snapshotted, shuffled, hands dealt, `games`/`game_players` rows created atomically — plus the Phase 2 backlog items (create-card quota, deck-builder not-found state).

**Architecture:** New `lobbies`, `games`, `game_players` tables (RLS per spec §4) and a `start_game_tx` SECURITY DEFINER RPC for the atomic start (service-role-only). A `lobby-action` edge function arbitrates JOIN/LEAVE/START (join races solved with a conditional update). Initial game state is built by pure tested code in `shared/engine/gameInit.ts` — card data is SNAPSHOTTED into game state so later card/deck edits never corrupt running games. Realtime: the three tables join the `supabase_realtime` publication; the frontend subscribes and invalidates TanStack Query caches.

**Tech Stack:** Existing stack + Supabase Realtime (postgres_changes).

**Spec:** `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` — §3.1 (setup: roles, first-player roll, hand 5, CP 3), §3.2 (materials formula), §4 (`lobbies`, `games`, `game_players`, RLS), §5 (`lobby-action`), §6 (realtime), §7 (`/lobbies`, `/games`). Read it first.

## Global Constraints

- Supabase ref `wpgsjnjnvykxavaxibld`, remote-only via MCP tools. Committed migrations and remote applies stay IDENTICAL.
- All tunables in `shared/gameSettings.ts`. New: `MAX_CUSTOM_CARDS_PER_PLAYER`, `MAX_ZONE_BASE_HP`. Zone count stays 3 (`ZONE_COUNT`).
- RLS: `to authenticated`, `(select auth.uid())` wrapping, index every RLS/FK column. `games`/`game_players` have NO client write policies (edge function + RPC only). `lobbies`: client insert/delete by host only; join/leave/start arbitrated server-side.
- Shared modules: relative imports carry explicit `.ts` extensions (Deno). Edge functions get synced shared copies via the manifest-driven `npm run functions:sync` + drift test (this phase generalizes the Phase 2 mechanism to multiple functions via `supabase/functions/shared-manifest.json`).
- Edge functions deploy with `verify_jwt: false` (own `getUser()` auth + CORS), service-role client for writes.
- Card data in game state is a SNAPSHOT taken at game start; live `cards` rows are never referenced by a running game.
- Test accounts (disposable, fixed passwords on purpose): `jacob.finn+ftdtest2@streetfeastapp.com` / `FtdPhase2Test!2026` (exists) and `jacob.finn+ftdtest3@streetfeastapp.com` / `FtdPhase3Test!2026` / username `test_admiral` (created in Task 6's verification).
- TDD for all shared logic; frontend gate `cd frontend && npm run build`; root gate `npm test`.
- Context7 before writing against supabase-js Realtime channel APIs (they changed across v2 minors).
- Commit per task with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Windows; Bash tool (Git Bash). No pushes (controller finishes).

---

### Task 1: Migration — lobbies, games, game_players, start RPC, realtime

**Files:**
- Create: `supabase/migrations/20260825000005_create_lobbies_and_games.sql`
- Modify: `frontend/src/lib/database.types.ts` (regenerated)

**Interfaces:**
- Produces: the three tables below (Tasks 4-8 build on them), RPC `public.start_game_tx(p_lobby_id uuid, p_game jsonb, p_player_a_state jsonb, p_player_b_state jsonb) returns uuid` (service-role only; Task 4's function calls it via the admin client's `.rpc()`), realtime publication membership, regenerated `Database` types.

- [ ] **Step 1: Write the migration file** (exact content):

```sql
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
```

- [ ] **Step 2: Apply remotely** — MCP `apply_migration`, name `create_lobbies_and_games`.

- [ ] **Step 3: Verify** — `list_tables` shows all three with RLS. `execute_sql`: `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename;` → includes game_players, games, lobbies. `select proname from pg_proc where proname = 'start_game_tx';` → present. `get_advisors` (security) → no new criticals.

- [ ] **Step 4: Regenerate types** — `generate_typescript_types` → save verbatim; `cd frontend && npm run build` still clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ frontend/src/lib/database.types.ts && git commit -m "feat(db): lobbies, games, game_players with RLS, atomic start RPC, realtime"
```

---

### Task 2: `shared/lobbySettings.ts` — settings schema (TDD)

**Files:**
- Create: `shared/lobbySettings.ts`
- Modify: `shared/gameSettings.ts` (add `ZONE_COUNT = 3`, `MAX_ZONE_BASE_HP = 10_000_000`, `MAX_CUSTOM_CARDS_PER_PLAYER = 50`)
- Test: `shared/lobbySettings.test.ts`

**Interfaces:**
- Produces (Tasks 4, 6 import): 

```ts
export interface ZoneSetting { biome: ZoneType; baseHp: number }
export interface LobbySettings {
  zones: ZoneSetting[] // length ZONE_COUNT
  deckRules?: Partial<DeckRules> // optional per-lobby overrides (spec §4); no UI yet
}
export const DEFAULT_LOBBY_SETTINGS: LobbySettings // 3 × { biome: 'water', baseHp: DEFAULT_BASE_HP }
export function validateLobbySettings(value: unknown): { settings: LobbySettings } | { errors: string[] }
```

- [ ] **Step 1: Write failing tests** — `shared/lobbySettings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOBBY_SETTINGS, validateLobbySettings } from './lobbySettings'

describe('DEFAULT_LOBBY_SETTINGS', () => {
  it('is 3 water zones at 1000 HP', () => {
    expect(DEFAULT_LOBBY_SETTINGS.zones).toEqual([
      { biome: 'water', baseHp: 1000 },
      { biome: 'water', baseHp: 1000 },
      { biome: 'water', baseHp: 1000 },
    ])
  })
})

describe('validateLobbySettings', () => {
  it('accepts the default and mixed biomes', () => {
    expect(validateLobbySettings(DEFAULT_LOBBY_SETTINGS)).toEqual({
      settings: DEFAULT_LOBBY_SETTINGS,
    })
    const mixed = {
      zones: [
        { biome: 'water', baseHp: 500 },
        { biome: 'beach', baseHp: 1000 },
        { biome: 'land', baseHp: 2000 },
      ],
    }
    expect(validateLobbySettings(mixed)).toEqual({ settings: mixed })
  })
  it('rejects wrong zone counts, bad biomes, bad hp, junk', () => {
    expect('errors' in validateLobbySettings({ zones: [] })).toBe(true)
    expect('errors' in validateLobbySettings({
      zones: [
        { biome: 'space', baseHp: 1000 },
        { biome: 'water', baseHp: 1000 },
        { biome: 'water', baseHp: 1000 },
      ],
    })).toBe(true)
    expect('errors' in validateLobbySettings({
      zones: [
        { biome: 'water', baseHp: 0 },
        { biome: 'water', baseHp: 1000 },
        { biome: 'water', baseHp: 1000 },
      ],
    })).toBe(true)
    expect('errors' in validateLobbySettings({
      zones: [
        { biome: 'water', baseHp: 1.5 },
        { biome: 'water', baseHp: 1000 },
        { biome: 'water', baseHp: 1000 },
      ],
    })).toBe(true)
    expect('errors' in validateLobbySettings(null)).toBe(true)
    expect('errors' in validateLobbySettings('x')).toBe(true)
  })
  it('accepts and rejects deckRules overrides', () => {
    const withRules = { ...DEFAULT_LOBBY_SETTINGS, deckRules: { deckSize: 30, uniqueCopyLimit: 3 } }
    expect(validateLobbySettings(withRules)).toEqual({ settings: withRules })
    expect('errors' in validateLobbySettings({
      ...DEFAULT_LOBBY_SETTINGS, deckRules: { deckSize: 0 },
    })).toBe(true)
    expect('errors' in validateLobbySettings({
      ...DEFAULT_LOBBY_SETTINGS, deckRules: { bogusKey: 5 },
    })).toBe(true)
  })
})
```

- [ ] **Step 2: `npm test`** → RED (module not found).

- [ ] **Step 3: Implement.** Append to `shared/gameSettings.ts`:

```ts
export const ZONE_COUNT = 3
export const MAX_ZONE_BASE_HP = 10_000_000
export const MAX_CUSTOM_CARDS_PER_PLAYER = 50
```

`shared/lobbySettings.ts`:

```ts
import { DEFAULT_BASE_HP, MAX_ZONE_BASE_HP, ZONE_COUNT, ZONE_TYPES } from './gameSettings.ts'
import type { DeckRules } from './engine/deckValidation.ts'
import type { ZoneType } from './types.ts'

export interface ZoneSetting {
  biome: ZoneType
  baseHp: number
}

export interface LobbySettings {
  zones: ZoneSetting[]
  deckRules?: Partial<DeckRules>
}

const DECK_RULE_KEYS: (keyof DeckRules)[] = [
  'deckSize', 'uniqueCopyLimit', 'playerCardLimit', 'flierCopyLimit', 'subCopyLimit',
]

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = {
  zones: Array.from({ length: ZONE_COUNT }, () => ({
    biome: ZONE_TYPES.WATER,
    baseHp: DEFAULT_BASE_HP,
  })),
}

export function validateLobbySettings(
  value: unknown,
): { settings: LobbySettings } | { errors: string[] } {
  const errors: string[] = []
  const zones = (value as { zones?: unknown } | null)?.zones
  if (!Array.isArray(zones) || zones.length !== ZONE_COUNT) {
    return { errors: [`Settings must define exactly ${ZONE_COUNT} zones`] }
  }
  const biomes = Object.values(ZONE_TYPES) as string[]
  for (const [i, zone] of zones.entries()) {
    const z = zone as { biome?: unknown; baseHp?: unknown }
    if (typeof z?.biome !== 'string' || !biomes.includes(z.biome)) {
      errors.push(`Zone ${i + 1}: unknown biome`)
    }
    if (
      typeof z?.baseHp !== 'number' ||
      !Number.isInteger(z.baseHp) ||
      z.baseHp < 1 ||
      z.baseHp > MAX_ZONE_BASE_HP
    ) {
      errors.push(`Zone ${i + 1}: base HP must be a whole number between 1 and ${MAX_ZONE_BASE_HP}`)
    }
  }
  const result: LobbySettings = { zones: zones as ZoneSetting[] }
  const deckRules = (value as { deckRules?: unknown }).deckRules
  if (deckRules !== undefined) {
    if (deckRules === null || typeof deckRules !== 'object' || Array.isArray(deckRules)) {
      errors.push('deckRules must be an object')
    } else {
      for (const [key, v] of Object.entries(deckRules)) {
        if (!DECK_RULE_KEYS.includes(key as keyof DeckRules)) {
          errors.push(`deckRules: unknown rule "${key}"`)
        } else if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
          errors.push(`deckRules.${key} must be a positive whole number`)
        }
      }
      if (errors.length === 0) result.deckRules = deckRules as Partial<DeckRules>
    }
  }
  if (errors.length > 0) return { errors }
  return { settings: result }
}
```

- [ ] **Step 4: Sync + full suite.** Run `npm run functions:sync` (the gameSettings additions must reach create-card's synced copy or the drift test fails), then `npm test` → GREEN.

- [ ] **Step 5: Commit** (the synced copy travels in the same commit so the tree stays green)

```bash
git add shared/ supabase/functions/create-card/shared/ && git commit -m "feat(shared): lobby settings schema and validation"
```

---

### Task 3: `shared/engine/gameInit.ts` — initial game state (TDD)

**Files:**
- Create: `shared/engine/gameInit.ts`
- Test: `shared/engine/gameInit.test.ts`

**Interfaces:**
- Produces (Task 4 and Phase 4 import):

```ts
export type Rng = () => number // [0,1)
export function secureRng(): number // crypto.getRandomValues-based
export interface SnapshotCard {
  cardId: string; name: string; isBuiltIn: boolean; ownerId: string | null
  faction: string; type: string; vehicleType: string | null
  blueprintCost: number; materialCost: number; cpCost: number
  cardText: string; imageUrl: string; keywords: string[]; meta: Record<string, unknown>
}
export interface CardInstance extends SnapshotCard { instanceId: string }
export interface ZoneState {
  id: number; biome: string; baseHp: { a: number; b: number }
  cards: { a: CardInstance[]; b: CardInstance[] }; lastActivatedTurn: number | null
}
export interface PublicGameState {
  zones: ZoneState[]
  resources: { a: { materials: number; cp: number }; b: { materials: number; cp: number } }
  counts: { a: { hand: number; deck: number }; b: { hand: number; deck: number } }
  usedHeroPowers: { a: string[]; b: string[] }
  activeBattle: null
  pendingReport: null
  log: string[]
}
export function snapshotCard(row: {
  id: string; name: string; is_built_in: boolean; owner_id: string | null
  faction: string; type: string; vehicle_type: string | null
  blueprint_cost: number; material_cost: number; cp_cost: number
  card_text: string; image_url: string; keywords: unknown; meta: unknown
}): SnapshotCard
export function buildInitialGame(input: {
  gameId: string
  playerA: string // host
  playerB: string // guest
  settings: LobbySettings
  deckA: { cards: Record<string, number>; snapshots: Map<string, SnapshotCard> }
  deckB: { cards: Record<string, number>; snapshots: Map<string, SnapshotCard> }
  instanceId: () => string // uuid source (crypto.randomUUID in prod, counter in tests)
  rng: Rng
}): {
  game: { id: string; playerA: string; playerB: string; activePlayer: string
          settings: LobbySettings; state: PublicGameState }
  aPrivate: { hand: CardInstance[]; deck: CardInstance[] }
  bPrivate: { hand: CardInstance[]; deck: CardInstance[] }
}
```

Rules implemented (spec §3.1-3.2): expand each deck entry into `qty` instances; Fisher-Yates shuffle with `rng`; deal `STARTING_HAND_SIZE` (5) to each hand; first player = `rng() < 0.5 ? playerA : playerB`; zones from settings with both bases at that zone's `baseHp`; CP `STARTING_CP_AMOUNT` (3) both; materials `MATERIALS_PER_TURN × 1` for BOTH players (spec §3.1's "starting materials: turn-1 income" — under §3.2's set-don't-accumulate semantics the second player's value is overwritten at their first turn start anyway, so symmetric funding is equivalent in game terms and displays sanely); counts reflect hands/decks; log gets one entry naming the first player.

- [ ] **Step 1: Write failing tests** — `shared/engine/gameInit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LobbySettings } from '../lobbySettings'
import type { SnapshotCard } from './gameInit'
import { buildInitialGame, snapshotCard } from './gameInit'

function snap(id: string): SnapshotCard {
  return {
    cardId: id, name: `Card ${id}`, isBuiltIn: true, ownerId: null,
    faction: 'DWG', type: 'vehicle', vehicleType: 'ship',
    blueprintCost: 10000, materialCost: 10000, cpCost: 0,
    cardText: '', imageUrl: '', keywords: [], meta: {},
  }
}

function deckOf(ids: string[]): {
  cards: Record<string, number>
  snapshots: Map<string, SnapshotCard>
} {
  return {
    cards: Object.fromEntries(ids.map((id) => [id, 2])),
    snapshots: new Map(ids.map((id) => [id, snap(id)])),
  }
}

const SETTINGS: LobbySettings = {
  zones: [
    { biome: 'water', baseHp: 500 },
    { biome: 'beach', baseHp: 1000 },
    { biome: 'land', baseHp: 2000 },
  ],
}

function counterIds() {
  let n = 0
  return () => `inst-${n++}`
}

function build(rngValues: number[]) {
  let i = 0
  const rng = () => rngValues[i++ % rngValues.length]
  return buildInitialGame({
    gameId: 'game-1', playerA: 'alice', playerB: 'bob',
    settings: SETTINGS,
    deckA: deckOf(Array.from({ length: 10 }, (_, k) => `a${k}`)),
    deckB: deckOf(Array.from({ length: 10 }, (_, k) => `b${k}`)),
    instanceId: counterIds(), rng,
  })
}

describe('buildInitialGame', () => {
  it('deals 5, leaves 15, tracks counts', () => {
    const { game, aPrivate, bPrivate } = build([0.9])
    expect(aPrivate.hand).toHaveLength(5)
    expect(aPrivate.deck).toHaveLength(15)
    expect(bPrivate.hand).toHaveLength(5)
    expect(bPrivate.deck).toHaveLength(15)
    expect(game.state.counts).toEqual({
      a: { hand: 5, deck: 15 }, b: { hand: 5, deck: 15 },
    })
  })

  it('gives every copy a unique instanceId and preserves snapshots', () => {
    const { aPrivate } = build([0.1])
    const all = [...aPrivate.hand, ...aPrivate.deck]
    expect(new Set(all.map((c) => c.instanceId)).size).toBe(20)
    expect(all.filter((c) => c.cardId === 'a0')).toHaveLength(2)
    expect(all[0].name).toMatch(/^Card /)
  })

  it('builds zones from settings with both bases at zone HP', () => {
    const { game } = build([0.9])
    expect(game.state.zones.map((z) => z.biome)).toEqual(['water', 'beach', 'land'])
    expect(game.state.zones.map((z) => z.baseHp)).toEqual([
      { a: 500, b: 500 }, { a: 1000, b: 1000 }, { a: 2000, b: 2000 },
    ])
    expect(game.state.zones.every((z) => z.cards.a.length === 0 && z.cards.b.length === 0)).toBe(true)
  })

  it('rolls first player from rng and funds both with turn-1 income', () => {
    const a = build([0.2]) // < 0.5 → playerA
    expect(a.game.activePlayer).toBe('alice')
    expect(a.game.state.resources.a).toEqual({ materials: 50000, cp: 3 })
    expect(a.game.state.resources.b).toEqual({ materials: 50000, cp: 3 })
    const b = build([0.7]) // ≥ 0.5 → playerB
    expect(b.game.activePlayer).toBe('bob')
  })

  it('shuffles deterministically with the injected rng', () => {
    const one = build([0.11, 0.42, 0.73, 0.05, 0.88])
    const two = build([0.11, 0.42, 0.73, 0.05, 0.88])
    expect(one.aPrivate.deck.map((c) => c.cardId)).toEqual(two.aPrivate.deck.map((c) => c.cardId))
  })
})

describe('snapshotCard', () => {
  it('maps a cards row to camelCase and normalizes jsonb', () => {
    const s = snapshotCard({
      id: 'x', name: 'N', is_built_in: false, owner_id: 'u1',
      faction: 'NEUTRAL', type: 'vehicle', vehicle_type: 'ship',
      blueprint_cost: 1, material_cost: 2, cp_cost: 3,
      card_text: 't', image_url: 'i', keywords: ['scrappy'], meta: { a: 1 },
    })
    expect(s).toEqual({
      cardId: 'x', name: 'N', isBuiltIn: false, ownerId: 'u1',
      faction: 'NEUTRAL', type: 'vehicle', vehicleType: 'ship',
      blueprintCost: 1, materialCost: 2, cpCost: 3,
      cardText: 't', imageUrl: 'i', keywords: ['scrappy'], meta: { a: 1 },
    })
    expect(snapshotCard({
      id: 'y', name: 'M', is_built_in: true, owner_id: null,
      faction: 'DWG', type: 'ability', vehicle_type: null,
      blueprint_cost: 0, material_cost: 0, cp_cost: 1,
      card_text: '', image_url: '', keywords: null, meta: null,
    }).keywords).toEqual([])
  })
})
```

- [ ] **Step 2: `npm test`** → RED.

- [ ] **Step 3: Implement** — `shared/engine/gameInit.ts`:

```ts
import {
  MATERIALS_PER_TURN, STARTING_CP_AMOUNT, STARTING_HAND_SIZE,
} from '../gameSettings.ts'
import type { LobbySettings } from '../lobbySettings.ts'

export type Rng = () => number

export function secureRng(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] / 2 ** 32
}

export interface SnapshotCard {
  cardId: string
  name: string
  isBuiltIn: boolean
  ownerId: string | null
  faction: string
  type: string
  vehicleType: string | null
  blueprintCost: number
  materialCost: number
  cpCost: number
  cardText: string
  imageUrl: string
  keywords: string[]
  meta: Record<string, unknown>
}

export interface CardInstance extends SnapshotCard {
  instanceId: string
}

export interface ZoneState {
  id: number
  biome: string
  baseHp: { a: number; b: number }
  cards: { a: CardInstance[]; b: CardInstance[] }
  lastActivatedTurn: number | null
}

export interface PublicGameState {
  zones: ZoneState[]
  resources: { a: { materials: number; cp: number }; b: { materials: number; cp: number } }
  counts: { a: { hand: number; deck: number }; b: { hand: number; deck: number } }
  usedHeroPowers: { a: string[]; b: string[] }
  activeBattle: null
  pendingReport: null
  log: string[]
}

export function snapshotCard(row: {
  id: string
  name: string
  is_built_in: boolean
  owner_id: string | null
  faction: string
  type: string
  vehicle_type: string | null
  blueprint_cost: number
  material_cost: number
  cp_cost: number
  card_text: string
  image_url: string
  keywords: unknown
  meta: unknown
}): SnapshotCard {
  return {
    cardId: row.id,
    name: row.name,
    isBuiltIn: row.is_built_in,
    ownerId: row.owner_id,
    faction: row.faction,
    type: row.type,
    vehicleType: row.vehicle_type,
    blueprintCost: row.blueprint_cost,
    materialCost: row.material_cost,
    cpCost: row.cp_cost,
    cardText: row.card_text,
    imageUrl: row.image_url,
    keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    meta:
      row.meta !== null && typeof row.meta === 'object' && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {},
  }
}

function shuffleMutating<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

function expandDeck(
  deck: { cards: Record<string, number>; snapshots: Map<string, SnapshotCard> },
  instanceId: () => string,
): CardInstance[] {
  const instances: CardInstance[] = []
  for (const [cardId, qty] of Object.entries(deck.cards)) {
    const snapshot = deck.snapshots.get(cardId)
    if (!snapshot) throw new Error(`Missing snapshot for card ${cardId}`)
    for (let i = 0; i < qty; i++) {
      instances.push({ ...snapshot, instanceId: instanceId() })
    }
  }
  return instances
}

export function buildInitialGame(input: {
  gameId: string
  playerA: string
  playerB: string
  settings: LobbySettings
  deckA: { cards: Record<string, number>; snapshots: Map<string, SnapshotCard> }
  deckB: { cards: Record<string, number>; snapshots: Map<string, SnapshotCard> }
  instanceId: () => string
  rng: Rng
}) {
  const deckAInstances = shuffleMutating(expandDeck(input.deckA, input.instanceId), input.rng)
  const deckBInstances = shuffleMutating(expandDeck(input.deckB, input.instanceId), input.rng)
  const aPrivate = {
    hand: deckAInstances.slice(0, STARTING_HAND_SIZE),
    deck: deckAInstances.slice(STARTING_HAND_SIZE),
  }
  const bPrivate = {
    hand: deckBInstances.slice(0, STARTING_HAND_SIZE),
    deck: deckBInstances.slice(STARTING_HAND_SIZE),
  }
  const activePlayer = input.rng() < 0.5 ? input.playerA : input.playerB
  const activeIsA = activePlayer === input.playerA
  const state: PublicGameState = {
    zones: input.settings.zones.map((zone, i) => ({
      id: i + 1,
      biome: zone.biome,
      baseHp: { a: zone.baseHp, b: zone.baseHp },
      cards: { a: [], b: [] },
      lastActivatedTurn: null,
    })),
    // Both sides get turn-1 income at setup; the second player's value is
    // reset (not accumulated) at their first turn start, so this is purely
    // a display symmetry, not an economic change.
    resources: {
      a: { materials: MATERIALS_PER_TURN, cp: STARTING_CP_AMOUNT },
      b: { materials: MATERIALS_PER_TURN, cp: STARTING_CP_AMOUNT },
    },
    counts: {
      a: { hand: aPrivate.hand.length, deck: aPrivate.deck.length },
      b: { hand: bPrivate.hand.length, deck: bPrivate.deck.length },
    },
    usedHeroPowers: { a: [], b: [] },
    activeBattle: null,
    pendingReport: null,
    log: [`Game started — first turn: ${activeIsA ? 'player A' : 'player B'}`],
  }
  return {
    game: {
      id: input.gameId,
      playerA: input.playerA,
      playerB: input.playerB,
      activePlayer,
      settings: input.settings,
      state,
    },
    aPrivate,
    bPrivate,
  }
}
```

- [ ] **Step 4: `npm test`** → GREEN.

- [ ] **Step 5: Commit**

```bash
git add shared/engine/ && git commit -m "feat(shared): initial game state builder with deck snapshot and deal"
```

---

### Task 4: Manifest-driven function sync + `lobby-action` edge function

**Files:**
- Create: `supabase/functions/shared-manifest.json`, `supabase/functions/lobby-action/index.ts`, `supabase/functions/lobby-action/shared/**` (synced)
- Modify: `scripts/sync-function-shared.mjs` (manifest-driven), `supabase/seed/functionSharedSync.test.ts` (manifest-driven)

**Interfaces:**
- Consumes: Tasks 1-3 outputs; `validateDeck` (Phase 2).
- Produces: deployed `lobby-action`: POST JSON `{ action: 'JOIN'|'LEAVE'|'START', lobbyId: string, deckId?: string }` → JOIN `200 {lobby}`, LEAVE `200 {ok:true}`, START `200 {gameId}`, failures `400/401/403/409 {errors:[...]}`. Task 6's pages invoke it.

- [ ] **Step 1: Manifest** — `supabase/functions/shared-manifest.json`:

```json
{
  "create-card": ["gameSettings.ts", "types.ts", "customCards.ts"],
  "lobby-action": [
    "gameSettings.ts",
    "types.ts",
    "lobbySettings.ts",
    "engine/deckValidation.ts",
    "engine/gameInit.ts"
  ]
}
```

- [ ] **Step 2: Rewrite `scripts/sync-function-shared.mjs`** (manifest-driven, preserves subdirectories):

```js
// Copies shared modules into each function per shared-manifest.json.
// Run: npm run functions:sync
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(
  readFileSync(join(root, 'supabase', 'functions', 'shared-manifest.json'), 'utf8'),
)
for (const [fn, files] of Object.entries(manifest)) {
  for (const f of files) {
    const dest = join(root, 'supabase', 'functions', fn, 'shared', f)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(root, 'shared', f), dest)
    console.log(`synced ${fn}/shared/${f}`)
  }
}
```

- [ ] **Step 3: Rewrite the drift test** — `supabase/seed/functionSharedSync.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest: Record<string, string[]> = JSON.parse(
  readFileSync(join(ROOT, 'supabase', 'functions', 'shared-manifest.json'), 'utf8'),
)

describe('function shared-module sync', () => {
  for (const [fn, files] of Object.entries(manifest)) {
    for (const f of files) {
      it(`${fn}/shared/${f} matches shared/${f}`, () => {
        const source = readFileSync(join(ROOT, 'shared', f), 'utf8')
        const synced = readFileSync(
          join(ROOT, 'supabase', 'functions', fn, 'shared', f),
          'utf8',
        )
        expect(synced).toBe(source)
      })
    }
  }
})
```

Run `npm test` → the 5 lobby-action entries FAIL (missing) → `npm run functions:sync` → GREEN (8 sync tests total).

- [ ] **Step 4: Function** — `supabase/functions/lobby-action/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { DEFAULT_DECK_RULES, validateDeck } from './shared/engine/deckValidation.ts'
import type { DeckCardInfo } from './shared/engine/deckValidation.ts'
import { buildInitialGame, secureRng, snapshotCard } from './shared/engine/gameInit.ts'
import type { SnapshotCard } from './shared/engine/gameInit.ts'
import { validateLobbySettings } from './shared/lobbySettings.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { errors: ['POST only'] })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { errors: ['Server misconfigured: missing Supabase environment'] })
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData, error: userError } = await authClient.auth.getUser()
  if (userError || !userData.user) return json(401, { errors: ['Not signed in'] })
  const userId = userData.user.id

  let body: { action?: unknown; lobbyId?: unknown; deckId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { errors: ['Invalid JSON body'] })
  }
  const action = typeof body.action === 'string' ? body.action : ''
  const lobbyId = typeof body.lobbyId === 'string' ? body.lobbyId : ''
  const deckId = typeof body.deckId === 'string' ? body.deckId : ''
  if (!lobbyId) return json(400, { errors: ['lobbyId required'] })

  const admin = createClient(supabaseUrl, serviceKey)

  if (action === 'JOIN') {
    if (!deckId) return json(400, { errors: ['deckId required to join'] })
    const { data: deck } = await admin
      .from('decks').select('id, owner_id').eq('id', deckId).maybeSingle()
    if (!deck || deck.owner_id !== userId) {
      return json(403, { errors: ['That deck is not yours'] })
    }
    // Atomic claim: only succeeds while the seat is empty and the lobby open.
    const { data: claimed, error: claimError } = await admin
      .from('lobbies')
      .update({ guest_id: userId, guest_deck_id: deckId })
      .eq('id', lobbyId)
      .eq('status', 'open')
      .is('guest_id', null)
      .neq('host_id', userId)
      .select()
      .maybeSingle()
    if (claimError) return json(500, { errors: [claimError.message] })
    if (!claimed) return json(409, { errors: ['Lobby is full, closed, or your own'] })
    return json(200, { lobby: claimed })
  }

  if (action === 'LEAVE') {
    const { data: left, error: leaveError } = await admin
      .from('lobbies')
      .update({ guest_id: null, guest_deck_id: null })
      .eq('id', lobbyId)
      .eq('status', 'open')
      .eq('guest_id', userId)
      .select()
      .maybeSingle()
    if (leaveError) return json(500, { errors: [leaveError.message] })
    if (!left) return json(409, { errors: ['You are not the guest of that open lobby'] })
    return json(200, { ok: true })
  }

  if (action === 'START') {
    const { data: lobby } = await admin
      .from('lobbies').select('*').eq('id', lobbyId).maybeSingle()
    if (!lobby) return json(404, { errors: ['Lobby not found'] })
    if (lobby.host_id !== userId) return json(403, { errors: ['Only the host can start'] })
    if (lobby.status !== 'open') return json(409, { errors: ['Lobby is not open'] })

    const parsed = validateLobbySettings(lobby.settings)
    if ('errors' in parsed) return json(400, { errors: parsed.errors })

    // Mark starting so concurrent STARTs, JOINs, and LEAVEs can't race. The
    // guest-present conditions live in the WHERE so a guest who left between
    // our read and this lock makes the lock fail instead of starting a game
    // around a stale seat. `locked` is the post-lock authoritative row —
    // everything below reads from it, never from the pre-lock `lobby`.
    const { data: locked } = await admin
      .from('lobbies')
      .update({ status: 'starting' })
      .eq('id', lobbyId)
      .eq('status', 'open')
      .not('guest_id', 'is', null)
      .not('guest_deck_id', 'is', null)
      .select()
      .maybeSingle()
    if (!locked || !locked.guest_id || !locked.guest_deck_id) {
      return json(409, { errors: ['Waiting for an opponent with a deck (or already starting)'] })
    }

    const fail = async (status: number, errors: string[]) => {
      await admin.from('lobbies').update({ status: 'open' }).eq('id', lobbyId)
      return json(status, { errors })
    }

    const { data: decks } = await admin
      .from('decks').select('*').in('id', [locked.host_deck_id, locked.guest_deck_id])
    const hostDeck = decks?.find((d) => d.id === locked.host_deck_id)
    const guestDeck = decks?.find((d) => d.id === locked.guest_deck_id)
    if (!hostDeck || !guestDeck) return fail(409, ['A selected deck no longer exists'])

    const hostCards = (hostDeck.cards ?? {}) as Record<string, number>
    const guestCards = (guestDeck.cards ?? {}) as Record<string, number>
    const cardIds = [...new Set([...Object.keys(hostCards), ...Object.keys(guestCards)])]
    const { data: cardRows } = await admin.from('cards').select('*').in('id', cardIds)
    const infoMap = new Map<string, DeckCardInfo>(
      (cardRows ?? []).map((c) => [c.id, {
        id: c.id, isBuiltIn: c.is_built_in, faction: c.faction,
        vehicleType: c.vehicle_type, ownerId: c.owner_id,
      }]),
    )
    const snapshots = new Map<string, SnapshotCard>(
      (cardRows ?? []).map((c) => [c.id, snapshotCard(c)]),
    )

    // Lobby-overridable deck rules (spec §4): defaults merged with any
    // validated per-lobby overrides, then frozen into the game's settings.
    const deckRules = { ...DEFAULT_DECK_RULES, ...(parsed.settings.deckRules ?? {}) }

    const hostResult = validateDeck(
      { faction: hostDeck.faction, cards: hostCards }, infoMap, locked.host_id, deckRules,
    )
    if (!hostResult.valid) {
      return fail(400, hostResult.errors.map((e) => `Host deck: ${e}`))
    }
    const guestResult = validateDeck(
      { faction: guestDeck.faction, cards: guestCards }, infoMap, locked.guest_id, deckRules,
    )
    if (!guestResult.valid) {
      return fail(400, guestResult.errors.map((e) => `Guest deck: ${e}`))
    }

    const built = buildInitialGame({
      gameId: crypto.randomUUID(),
      playerA: locked.host_id,
      playerB: locked.guest_id,
      settings: parsed.settings,
      deckA: { cards: hostCards, snapshots },
      deckB: { cards: guestCards, snapshots },
      instanceId: () => crypto.randomUUID(),
      rng: secureRng,
    })

    const { data: gameId, error: txError } = await admin.rpc('start_game_tx', {
      p_lobby_id: lobbyId,
      p_game: built.game,
      p_player_a_state: built.aPrivate,
      p_player_b_state: built.bPrivate,
    })
    if (txError) return fail(500, [txError.message])
    return json(200, { gameId })
  }

  return json(400, { errors: [`Unknown action: ${action}`] })
})
```

- [ ] **Step 5: Deploy + smoke check** — `npm run functions:sync && npm test` first, then MCP `deploy_edge_function`: name `lobby-action`, entrypoint `index.ts`, `verify_jwt: false`, files: `index.ts` + the five synced `shared/**` copies (subfolder names as in the repo; the tool accepted subfolders for create-card). Then smoke-check the deployment without any account: `curl -s -X POST https://wpgsjnjnvykxavaxibld.supabase.co/functions/v1/lobby-action -H "Content-Type: application/json" -d '{}'` → expect 401 `{"errors":["Not signed in"]}`, and `curl -s -i -X OPTIONS https://wpgsjnjnvykxavaxibld.supabase.co/functions/v1/lobby-action` → expect 200 with the CORS headers. (Full behavioral verification happens in Task 6 with real accounts and decks.)

- [ ] **Step 6: Commit**

```bash
git add scripts/ supabase/functions/ supabase/seed/functionSharedSync.test.ts package.json && git commit -m "feat(functions): lobby-action (join/leave/start) with manifest-driven shared sync"
```

(Headless verification happens in Task 6 alongside account setup, so the function is exercised with real decks.)

---

### Task 5: Backlog hardening — create-card quota + deck-builder not-found state

**Files:**
- Modify: `supabase/functions/create-card/index.ts`, `frontend/src/pages/DeckBuilderPage.tsx`

**Interfaces:**
- Consumes: `MAX_CUSTOM_CARDS_PER_PLAYER` (Task 2), `useDecksQuery` states.
- Produces: quota-enforcing create-card (re-deployed); builder renders not-found/error instead of eternal "Loading".

- [ ] **Step 1: Quota.** In `create-card/index.ts`, after the auth block and before FormData parsing, insert:

```ts
  const admin = createClient(supabaseUrl, serviceKey)
  const { count } = await admin
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .eq('is_built_in', false)
  if ((count ?? 0) >= MAX_CUSTOM_CARDS_PER_PLAYER) {
    return json(400, {
      errors: [`Custom card limit reached (${MAX_CUSTOM_CARDS_PER_PLAYER}); delete one first`],
    })
  }
```

Add `MAX_CUSTOM_CARDS_PER_PLAYER` to the `./shared/gameSettings.ts` import in that file, and REMOVE the later duplicate `const admin = createClient(...)` line (the admin client now exists earlier). Then `npm run functions:sync && npm test` (the drift test forces the synced gameSettings copy — which now carries the constant — to be refreshed) and re-deploy `create-card` (same parameters as Phase 2, `verify_jwt: false`).

- [ ] **Step 2: Builder not-found.** In `DeckBuilderPage.tsx`, replace `if (!deck) return <main className="p-8 text-center">Loading deck…</main>` with:

```tsx
  const { data: decks, isLoading: decksLoading, error: decksError } = useDecksQuery()
  // (adjust the existing useDecksQuery() destructure at the top of the component)
  if (decksLoading) return <main className="p-8 text-center">Loading deck…</main>
  if (decksError) {
    return <main className="p-8 text-center text-red-400">Failed to load deck: {String(decksError)}</main>
  }
  if (!deck) {
    return (
      <main className="p-8 text-center">
        <p>That deck doesn't exist (or isn't yours).</p>
        <Link className="underline" to="/decks">Back to your fleets</Link>
      </main>
    )
  }
```

(add `Link` to the react-router-dom import).

- [ ] **Step 3: Gates** — `npm test` green; `cd frontend && npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-card/ frontend/src/pages/DeckBuilderPage.tsx && git commit -m "feat: custom-card quota and deck-builder not-found state"
```

---

### Task 6: Headless verification — full lobby lifecycle against the live project

**Files:** none in the repo (scratchpad scripts + MCP)

Load MCP: `execute_sql`, `get_advisors`, `list_edge_functions`, `query_logs` (project_id `wpgsjnjnvykxavaxibld`; `query_logs` is your debugger if a function call fails unexpectedly). The scratchpad supabase-js clients need `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` — read them from `frontend/.env.local`.

- [ ] **Step 1: Second account.** Sign up with the username in the metadata (the profiles trigger reads it): `supabase.auth.signUp({ email: 'jacob.finn+ftdtest3@streetfeastapp.com', password: 'FtdPhase3Test!2026', options: { data: { username: 'test_admiral' } } })`; confirm via `execute_sql` (`update auth.users set email_confirmed_at = now() where email = ...`); sign in.
- [ ] **Step 2: Decks.** For BOTH test users (ftdtest2 signs in with `FtdPhase2Test!2026`): insert a deck (faction DWG) and fill with 10 built-in DWG cards × 2 copies = **exactly 20 copies**. The live data has only **9** DWG ships, so take 9 ships + 1 airship (2 airship copies is far below FLIER_COPY_LIMIT 6): `select id from cards where is_built_in and faction = 'DWG' and vehicle_type in ('ship','airship') order by vehicle_type desc, name limit 10` (desc puts ships first, then one airship). Sanity-check you got 10 ids before building the deck.
- [ ] **Step 3: Lobby flow.** As ftdtest2 (host): insert a lobby (name 'E2E Harbor', settings `{"zones":[{"biome":"water","baseHp":500},{"biome":"beach","baseHp":1000},{"biome":"land","baseHp":2000}]}`, host_deck_id). As ftdtest3: confirm the open lobby is visible via select; JOIN via `lobby-action` (deckId) → 200. Then, in this exact order: (a) ftdtest3 LEAVE → 200; (b) host START → 409 waiting-for-opponent; (c) ftdtest3 JOIN again → 200; (d) ftdtest3 START → 403 only-host; (e) ftdtest2 JOIN on their own lobby → 409.
- [ ] **Step 4: START.** As host: START → 200 {gameId}. Assert via each user's client: `games` row visible to both (status active, turn_number 1.0, settings zones match, version 1); `state.zones` biomes/HP match settings; `state.counts` = 5/15 both sides; own `game_players` row has 5-card hand + 15-card deck with `instanceId`s; **opponent's row invisible** (select by game_id returns only own row). Lobby now `closed` with `game_id` set, and NOT in ftdtest3's open-lobby list. A signed-out client sees 0 lobbies/games.
- [ ] **Step 5: Quota spot-check.** As ftdtest3, `execute_sql` a count of their custom cards, then call `create-card` once **without an image** (name + vehicleType + blueprintCost only — no storage object to orphan) → should succeed (far below 50) — confirms the redeployed function still works post-quota.
- [ ] **Step 6: Cleanup.** `execute_sql`: delete the E2E game (`delete from public.games where id = '<gameId>';` — cascades to game_players), the lobby row, both E2E decks, and any custom card created in Step 5.
- [ ] **Step 7: Advisors** — both types; no new criticals; note WARN/INFO deltas (new unused-index INFOs for fresh indexes are expected).
- [ ] **Step 8:** Nothing to commit (verify `git status` clean); full report.

---

### Task 7: Frontend — realtime helper + lobby browser

**Files:**
- Create: `frontend/src/lib/realtime.ts`, `frontend/src/lib/games.ts`, `frontend/src/pages/LobbiesPage.tsx`
- Modify: `frontend/src/App.tsx` (route `/lobbies`), `frontend/src/components/NavBar.tsx` ("Lobbies" link before Decks)

**Interfaces:**
- Produces: `useRealtimeInvalidate(channelKey, table, queryKeys, filter?)` and the games hooks (`GameRow`, `useGamesQuery`, `useGameQuery`, `useMyGamePlayerQuery`, `useUsernames`) — Task 8 reuses ALL of these; `/lobbies` page.

- [ ] **Step 0: Games hooks** — create `frontend/src/lib/games.ts` (LobbiesPage consumes `useGamesQuery`; Task 8's pages consume the rest):

```ts
import { useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'

export type GameRow = Database['public']['Tables']['games']['Row']
export type GamePlayerRow = Database['public']['Tables']['game_players']['Row']

export function useGamesQuery() {
  return useQuery({
    queryKey: ['games'],
    queryFn: async (): Promise<GameRow[]> => {
      const { data, error } = await supabase
        .from('games').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useGameQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['game', id],
    enabled: !!id,
    queryFn: async (): Promise<GameRow | null> => {
      const { data, error } = await supabase
        .from('games').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useMyGamePlayerQuery(gameId: string | undefined) {
  return useQuery({
    queryKey: ['gamePlayer', gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<GamePlayerRow | null> => {
      const { data, error } = await supabase
        .from('game_players').select('*').eq('game_id', gameId!).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useUsernames(ids: (string | null | undefined)[]) {
  const clean = [...new Set(ids.filter((x): x is string => !!x))].sort()
  return useQuery({
    queryKey: ['usernames', clean],
    enabled: clean.length > 0,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from('profiles').select('id, username').in('id', clean)
      if (error) throw error
      return new Map(data.map((p) => [p.id, p.username]))
    },
  })
}
```

- [ ] **Step 1: Realtime helper** — `frontend/src/lib/realtime.ts` (check Context7 for current channel API):

```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient'

// Subscribes to postgres_changes on one table and invalidates the given
// query keys on any event. Payloads are treated as change signals only —
// consumers refetch through their queries.
export function useRealtimeInvalidate(
  channelKey: string,
  table: string,
  queryKeys: unknown[][],
  filter?: string,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => {
          for (const key of queryKeys) queryClient.invalidateQueries({ queryKey: key })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, table, filter, queryClient])
}
```

- [ ] **Step 2: LobbiesPage** — `frontend/src/pages/LobbiesPage.tsx`. Structure (full component, ~200 lines):

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { DEFAULT_LOBBY_SETTINGS, validateLobbySettings } from '@shared/lobbySettings'
import type { LobbySettings } from '@shared/lobbySettings'
import { ZONE_TYPES } from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import type { Database } from '../lib/database.types'
import { useDecksQuery } from '../lib/decks'
import { useGamesQuery } from '../lib/games'
import { useRealtimeInvalidate } from '../lib/realtime'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

type LobbyRow = Database['public']['Tables']['lobbies']['Row']

// Compact settings readout so browsers see what they'd be joining.
function zoneSummary(settings: unknown): string {
  const parsed = validateLobbySettings(settings)
  if ('errors' in parsed) return 'custom settings'
  return parsed.settings.zones
    .map((z) => `${z.biome} ${shortHandNumber(z.baseHp)}`)
    .join(' / ')
}

async function lobbyAction(body: { action: string; lobbyId: string; deckId?: string }) {
  const { data, error } = await supabase.functions.invoke('lobby-action', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const parsed = await error.context.json().catch(() => null)
      throw new Error(parsed?.errors?.join('; ') ?? error.message)
    }
    throw error
  }
  return data
}

export function LobbiesPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: decks } = useDecksQuery()
  const [name, setName] = useState('')
  const [deckId, setDeckId] = useState('')
  const [settings, setSettings] = useState<LobbySettings>(DEFAULT_LOBBY_SETTINGS)
  const [joinDeckId, setJoinDeckId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: lobbies } = useQuery({
    queryKey: ['lobbies'],
    queryFn: async (): Promise<LobbyRow[]> => {
      const { data, error: qError } = await supabase
        .from('lobbies').select('*').order('created_at', { ascending: false })
      if (qError) throw qError
      return data
    },
  })
  // Lobby events also refresh games so a guest sees the freshly created
  // game (their lobby flips open→closed at START) without polling.
  useRealtimeInvalidate('lobbies-browser', 'lobbies', [['lobbies'], ['games']])
  useRealtimeInvalidate('lobbies-games', 'games', [['games']])
  const { data: games } = useGamesQuery()

  const me = session?.user.id
  // Only open/starting lobbies count as "mine in progress" — closed rows are
  // history and must never take over this page.
  const myLobby = (lobbies ?? []).find(
    (l) =>
      (l.host_id === me || l.guest_id === me) &&
      (l.status === 'open' || l.status === 'starting'),
  )
  const activeGames = (games ?? []).filter((g) => g.status === 'active')
  const openLobbies = (lobbies ?? []).filter((l) => l.status === 'open' && l.host_id !== me)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const createLobby = () => run(async () => {
    if (!me || !deckId) throw new Error('Pick a deck first')
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 40) throw new Error('Name must be 1-40 characters')
    const checked = validateLobbySettings(settings)
    if ('errors' in checked) throw new Error(checked.errors.join('; '))
    const { error: insertError } = await supabase.from('lobbies').insert({
      host_id: me, name: trimmed, host_deck_id: deckId,
      settings: settings as unknown as Database['public']['Tables']['lobbies']['Insert']['settings'],
    })
    if (insertError) throw insertError
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
  })

  const join = (lobby: LobbyRow) => run(async () => {
    if (!joinDeckId) throw new Error('Pick a deck to join with')
    await lobbyAction({ action: 'JOIN', lobbyId: lobby.id, deckId: joinDeckId })
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
  })

  const leave = (lobby: LobbyRow) => run(async () => {
    await lobbyAction({ action: 'LEAVE', lobbyId: lobby.id })
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
  })

  const cancel = (lobby: LobbyRow) => run(async () => {
    const { error: deleteError } = await supabase.from('lobbies').delete().eq('id', lobby.id)
    if (deleteError) throw deleteError
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
  })

  const start = (lobby: LobbyRow) => run(async () => {
    const result = await lobbyAction({ action: 'START', lobbyId: lobby.id })
    navigate(`/game/${result.gameId}`)
  })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-3xl">Harbor</h1>
      {error && <p className="mt-2 text-red-400">{error}</p>}

      {activeGames.length > 0 && (
        <section className="mt-3 flex flex-wrap items-center gap-3 rounded border border-brass-400 bg-ocean-900/60 p-3">
          <span className="font-bold">
            {activeGames.length === 1 ? 'You have an active battle!' : `${activeGames.length} active battles`}
          </span>
          {activeGames.slice(0, 3).map((g) => (
            <button key={g.id} onClick={() => navigate(`/game/${g.id}`)}
              className="rounded bg-brass-400 px-3 py-1 font-bold text-ocean-950">
              Enter game
            </button>
          ))}
        </section>
      )}

      {myLobby ? (
        <section className="mt-4 rounded border border-brass-400 bg-ocean-900/60 p-4">
          <h2 className="font-display text-2xl">{myLobby.name}</h2>
          <p className="text-sm text-ocean-300">{zoneSummary(myLobby.settings)}</p>
          <p className="mt-1 text-ocean-300">
            {myLobby.guest_id && myLobby.guest_deck_id
              ? myLobby.host_id === me ? 'Opponent ready!' : 'Waiting for the host to start…'
              : 'Waiting for an opponent…'}
          </p>
          <div className="mt-3 flex gap-3">
            {myLobby.host_id === me && (
              <>
                <button disabled={busy || !myLobby.guest_id || !myLobby.guest_deck_id}
                  onClick={() => start(myLobby)}
                  className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
                  {busy ? 'Working…' : 'Start game'}
                </button>
                <button disabled={busy} onClick={() => cancel(myLobby)} className="text-red-400 underline">
                  Cancel lobby
                </button>
              </>
            )}
            {myLobby.guest_id === me && (
              <button disabled={busy} onClick={() => leave(myLobby)} className="text-red-400 underline">
                Leave lobby
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="mt-4 rounded border border-ocean-600 bg-ocean-900/60 p-4">
          <h2 className="font-display text-xl">Open a lobby</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="rounded bg-ocean-950 p-2" placeholder="Lobby name" value={name}
              onChange={(e) => setName(e.target.value)} />
            <select className="rounded bg-ocean-950 p-2" value={deckId}
              onChange={(e) => setDeckId(e.target.value)}>
              <option value="">Your deck…</option>
              {(decks ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.faction})</option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {settings.zones.map((zone, i) => (
              <label key={i} className="text-sm text-ocean-300">
                Zone {i + 1}
                <select className="mt-1 block rounded bg-ocean-950 p-2" value={zone.biome}
                  onChange={(e) => setSettings((s) => ({
                    zones: s.zones.map((z, j) => (j === i ? { ...z, biome: e.target.value as typeof z.biome } : z)),
                  }))}>
                  {Object.values(ZONE_TYPES).map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <input type="number" className="mt-1 block w-24 rounded bg-ocean-950 p-2"
                  value={zone.baseHp}
                  onChange={(e) => setSettings((s) => ({
                    zones: s.zones.map((z, j) => (j === i ? { ...z, baseHp: Number(e.target.value) } : z)),
                  }))} />
              </label>
            ))}
          </div>
          <button disabled={busy} onClick={createLobby}
            className="mt-3 rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
            Create lobby
          </button>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-display text-xl">Open lobbies</h2>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-ocean-300">Join with:</span>
          <select className="rounded bg-ocean-950 p-2" value={joinDeckId}
            onChange={(e) => setJoinDeckId(e.target.value)}>
            <option value="">Your deck…</option>
            {(decks ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.faction})</option>
            ))}
          </select>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {openLobbies.map((l) => (
            <li key={l.id} className="flex items-center gap-4 rounded border border-ocean-600 bg-ocean-900/60 p-3">
              <span className="flex-1">
                <span className="font-display text-lg">{l.name}</span>
                <span className="ml-3 text-sm text-ocean-300">{zoneSummary(l.settings)}</span>
              </span>
              <button disabled={busy || !!myLobby} onClick={() => join(l)}
                className="rounded bg-brass-400 px-3 py-1 font-bold text-ocean-950 disabled:opacity-50">
                Join
              </button>
            </li>
          ))}
          {openLobbies.length === 0 && <p className="text-ocean-300">No open lobbies — start one!</p>}
        </ul>
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Route + nav** — `/lobbies` behind RequireAuth; NavBar link "Lobbies" first (order: Lobbies, Decks, Cards, {right}).

- [ ] **Step 4: Gates** — frontend build clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/ && git commit -m "feat(frontend): realtime lobby browser with create/join/start"
```

---

### Task 8: Frontend — My Games list + game stub page

**Files:**
- Create: `frontend/src/pages/GamesPage.tsx`, `frontend/src/pages/GameStubPage.tsx`
- Modify: `frontend/src/App.tsx` (routes `/games`, `/game/:id`), `frontend/src/components/NavBar.tsx` ("Games" link)

**Interfaces:**
- Consumes: the games hooks from `frontend/src/lib/games.ts` and `useRealtimeInvalidate` (both created in Task 7).
- Produces: `/games`; `/game/:id` stub (Phase 4's board replaces the stub).

- [ ] **Step 2: GamesPage** — list `useGamesQuery()`: opponent username (via `useUsernames`), status, turn number, "Your turn" badge when `active_player === session.user.id`, link `/game/:id`; realtime via `useRealtimeInvalidate('games-list', 'games', [['games']])`; loading/error/empty states.

```tsx
import { Link } from 'react-router-dom'
import { useGamesQuery, useUsernames } from '../lib/games'
import { useRealtimeInvalidate } from '../lib/realtime'
import { useAuth } from '../lib/auth'

export function GamesPage() {
  const { session } = useAuth()
  const { data: games, isLoading, error } = useGamesQuery()
  const me = session?.user.id
  const { data: names } = useUsernames(
    (games ?? []).flatMap((g) => [g.player_a, g.player_b]),
  )
  useRealtimeInvalidate('games-list', 'games', [['games']])

  if (isLoading) return <main className="p-8 text-center">Loading games…</main>
  if (error) return <main className="p-8 text-center text-red-400">Failed to load games: {String(error)}</main>

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl">Your battles</h1>
      <ul className="mt-4 flex flex-col gap-3">
        {(games ?? []).map((g) => {
          const opponent = g.player_a === me ? g.player_b : g.player_a
          return (
            <li key={g.id}>
              <Link to={`/game/${g.id}`}
                className="flex items-center gap-4 rounded border border-ocean-600 bg-ocean-900/60 p-4">
                <span className="flex-1">
                  vs <span className="font-bold">{names?.get(opponent) ?? '…'}</span>
                </span>
                <span className="text-ocean-300">turn {String(g.turn_number)}</span>
                <span className="text-ocean-300">{g.status}</span>
                {g.status === 'active' && g.active_player === me && (
                  <span className="rounded bg-brass-400 px-2 py-0.5 text-sm font-bold text-ocean-950">
                    Your turn
                  </span>
                )}
              </Link>
            </li>
          )
        })}
        {(games ?? []).length === 0 && <p className="text-ocean-300">No battles yet — visit the Harbor.</p>}
      </ul>
    </main>
  )
}
```

- [ ] **Step 3: GameStubPage** — `frontend/src/pages/GameStubPage.tsx`: read-only pre-board view. Renders: turn + whose turn (via usernames), the 3 zones (biome label, both base HPs, in-zone card counts), both players' resources and hand/deck counts from `state`, own hand as a horizontal scroll of `PhysicalCard`s built from the `CardInstance` snapshots (map snapshot → a `CardRow`-shaped object for `PhysicalCard`: `{ id: instanceId, name, is_built_in: isBuiltIn, owner_id: ownerId, faction, type, vehicle_type: vehicleType, blueprint_cost: blueprintCost, material_cost: materialCost, cp_cost: cpCost, card_text: cardText, image_url: imageUrl, keywords, meta, created_at: '' }` — cast `as CardRow` at the mapping only), realtime invalidation for both queries (`useRealtimeInvalidate('game-' + id, 'games', [['game', id]], 'id=eq.' + id)` and `useRealtimeInvalidate('gp-' + id, 'game_players', [['gamePlayer', id]], 'game_id=eq.' + id)`), a not-found state, and a banner: "The interactive board arrives in Phase 4 — this is the live game state." Type the `state` access defensively: `const state = game.state as unknown as PublicGameState` (import type from `@shared/engine/gameInit`).

```tsx
import { useParams } from 'react-router-dom'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import { PhysicalCard } from '../components/PhysicalCard'
import type { CardRow } from '../lib/cards'
import { useGameQuery, useMyGamePlayerQuery, useUsernames } from '../lib/games'
import { useRealtimeInvalidate } from '../lib/realtime'
import { useAuth } from '../lib/auth'

function instanceToCardRow(c: CardInstance): CardRow {
  return {
    id: c.instanceId, name: c.name, is_built_in: c.isBuiltIn, owner_id: c.ownerId,
    faction: c.faction, type: c.type, vehicle_type: c.vehicleType,
    blueprint_cost: c.blueprintCost, material_cost: c.materialCost, cp_cost: c.cpCost,
    card_text: c.cardText, image_url: c.imageUrl,
    keywords: c.keywords, meta: c.meta, created_at: '',
  } as CardRow
}

export function GameStubPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const { data: game, isLoading } = useGameQuery(id)
  const { data: mine } = useMyGamePlayerQuery(id)
  const { data: names } = useUsernames([game?.player_a, game?.player_b])
  useRealtimeInvalidate(`game-${id}`, 'games', [['game', id]], `id=eq.${id}`)
  useRealtimeInvalidate(`gp-${id}`, 'game_players', [['gamePlayer', id]], `game_id=eq.${id}`)

  if (isLoading) return <main className="p-8 text-center">Loading game…</main>
  if (!game) {
    return <main className="p-8 text-center">Game not found (or you're not in it).</main>
  }
  const state = game.state as unknown as PublicGameState
  const me = session?.user.id
  const mySide = game.player_a === me ? 'a' : 'b'
  const theirSide = mySide === 'a' ? 'b' : 'a'
  const hand = ((mine?.hand ?? []) as unknown as CardInstance[])

  return (
    <main className="mx-auto max-w-6xl p-6">
      <p className="rounded bg-ocean-900/80 p-2 text-center text-sm text-ocean-300">
        The interactive board arrives in Phase 4 — this is the live game state.
      </p>
      <h1 className="mt-3 font-display text-2xl">
        {names?.get(game.player_a) ?? '…'} vs {names?.get(game.player_b) ?? '…'} — turn{' '}
        {String(game.turn_number)},{' '}
        {game.active_player === me ? 'your turn' : `${names?.get(game.active_player) ?? '…'}'s turn`}
      </h1>
      <div className="mt-4 grid grid-cols-3 gap-4">
        {state.zones?.map((z) => (
          <div key={z.id} className="rounded border border-ocean-600 bg-ocean-900/50 p-3 text-center">
            <p className="font-display text-lg capitalize">{z.biome}</p>
            <p className="text-sm text-ocean-300">Their base: {z.baseHp[theirSide]} HP</p>
            <p className="text-sm text-ocean-300">Your base: {z.baseHp[mySide]} HP</p>
            <p className="mt-1 text-sm">
              Ships — you: {z.cards[mySide].length}, them: {z.cards[theirSide].length}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-6 text-ocean-300">
        <span>Your materials: {state.resources?.[mySide].materials}</span>
        <span>Your CP: {state.resources?.[mySide].cp}</span>
        <span>Their hand: {state.counts?.[theirSide].hand}</span>
        <span>Their deck: {state.counts?.[theirSide].deck}</span>
        <span>Your deck: {state.counts?.[mySide].deck}</span>
      </div>
      <h2 className="mt-6 font-display text-xl">Your hand</h2>
      <div className="mt-2 flex gap-4 overflow-x-auto pb-4">
        {hand.map((c) => (
          <div key={c.instanceId} className="shrink-0 scale-90 origin-top-left">
            <PhysicalCard card={instanceToCardRow(c)} />
          </div>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Routes + nav** — `/games` and `/game/:id` behind RequireAuth; NavBar "Games" link (order: Lobbies, Games, Decks, Cards, {right}).

- [ ] **Step 5: Gates** — frontend build clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/ && git commit -m "feat(frontend): games list and live game state stub page"
```

---

### Task 9: Final gates + advisors

- [ ] **Step 1:** Root `npm test` — expect 45: 30 prior + 6 gameInit + 4 lobbySettings + 5 new sync-manifest entries (report exact numbers if they differ) — and `cd frontend && npm run build` clean.
- [ ] **Step 2:** `get_advisors` both types — no new criticals; report deltas.
- [ ] **Step 3:** `git status` clean; full report. NO push (controller finishes).

---

## Self-review notes (completed)

- Spec coverage: §4 lobbies/games/game_players schemas + RLS (T1), §5 lobby-action JOIN/LEAVE/START incl. deck re-validation + first-player roll + shuffle + deal (T3-T4), §6 realtime on all three tables + refetch-on-signal pattern (T1, T7-T8), §7 `/lobbies` + `/games` pages (T7-T8), §3.1/3.2 setup numbers (T3, from gameSettings). Phase 2 backlog: quota + not-found (T5). The Phase 4 board explicitly NOT built — the stub renders state read-only.
- Type consistency: `start_game_tx` param names match the function's `.rpc()` call; `built.game` field names (playerA/activePlayer/settings/state) match the RPC's jsonb extraction keys; `LobbySettings` shape shared by validator, builder, and the lobby form; snapshot camelCase → CardRow mapping localized to `instanceToCardRow`.
- Decisions (recorded): per-zone HP (3 independent inputs); guest deck FK `on delete set null` with START rejecting a missing guest deck; host deck FK `on delete cascade` (deleting your deck scuttles your lobby — loud and simple; realtime removes it from lists); lobby status `starting` is the start mutex — its lock UPDATE also requires guest_id/guest_deck_id non-null (closes the LEAVE/START race) and everything after the lock reads the `locked` row; BOTH players get turn-1 materials at init (equivalent under §3.2's set-don't-accumulate semantics; symmetric display); lobbies are SELECT-visible to all authenticated users (names/settings not sensitive; required for RLS-respecting realtime to reach third-party browsers); closed lobbies host-deletable; `lobbies.game_id` has an FK (set-null on game deletion); `deckRules` overrides are plumbed through settings → START → frozen game settings but have no UI yet; the Harbor page never page-replaces — active games surface as a banner from the games query; custom-card quota 50 (NEW policy number, not from spec — flag to the user at finish).
- Placeholders: none; all code steps carry full content. This plan was adversarially verified (3 lenses, 19 findings — 3 blocking, 5 important, 11 minor — all resolved or consciously recorded in this revision).
