# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the repo, Supabase schema (profiles/cards/hero_powers with RLS), seed all built-in cards and hero powers from the old BE repo, and ship a working email/password auth flow in a themed React shell.

**Architecture:** Monorepo: `frontend/` (Vite + React 18 + TS SPA), `shared/` (pure TS constants/types, no deps), `supabase/` (SQL migrations applied to the remote project via Supabase MCP tools, plus a seed pipeline that transforms the old BE's card JS files into upsert SQL). Server state via TanStack Query; auth via supabase-js.

**Tech Stack:** Vite 7, React 18, TypeScript 5 (strict), Tailwind CSS v4, react-router v7, @tanstack/react-query v5, @supabase/supabase-js v2, tsx + vitest + uuid (seed tooling).

**Spec:** `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` — read it first; this plan implements its §2 (repo layout), §4 (profiles, cards, hero_powers, RLS), and the Phase-1 line of §9.

## Global Constraints

- Supabase project ref: `wpgsjnjnvykxavaxibld` (name "FtD Card Game", us-west-2). URL: `https://wpgsjnjnvykxavaxibld.supabase.co`. Use the Supabase MCP tools (`apply_migration`, `execute_sql`, `get_advisors`, `get_publishable_keys`, `generate_typescript_types`) — there is no local Supabase stack.
- Old BE repo (seed data source): `https://github.com/joey101937/ftd-cg-backend.git`. Old FE repo (assets): `https://github.com/joey101937/ftd-cg-frontend.git`. A clone may already exist at `C:/Users/JFinn/AppData/Local/Temp/claude/C--Users-JFinn-FtDCardGame/c0e08782-aefb-4fab-9490-16ed4a33e343/scratchpad/{be-repo,fe-repo}`; if missing, clone fresh to any temp dir.
- **Before writing code against Tailwind v4, supabase-js, TanStack Query, or Vite config APIs, look up current docs via Context7** (user requirement — these APIs changed recently).
- DB identifiers snake_case; TypeScript camelCase; SCREAMING_SNAKE for constants. All tunable game numbers live ONLY in `shared/gameSettings.ts`.
- Every RLS policy: scope `to authenticated`, wrap auth functions as `(select auth.uid())`. Index every column referenced by RLS or FKs.
- `cards` and `hero_powers` have NO client write policies — writes happen via service role only (Studio / future edge functions).
- Migration SQL files are committed to `supabase/migrations/` AND applied remotely via MCP `apply_migration` with the same name — keep them in lockstep.
- Node 20.19+ required (Vite 7). npm as package manager. Two install roots: repo root (tooling) and `frontend/`.
- Shell commands below are Git Bash syntax (this is a Windows machine — the Bash tool runs Git Bash).
- Commit after every task with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **User action (not ours):** email confirmation on/off is a dashboard setting (Authentication → Sign In / Up → "Confirm email"). The UI must handle BOTH cases (Task 9).

---

### Task 1: Repo hygiene and tooling scaffold

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `netlify.toml`, `README.md`

**Interfaces:**
- Produces: root `npm test` (vitest over `shared/` and `supabase/seed/`), `npm run seed:build` (used by Task 6).

- [ ] **Step 1: Write the files**

`.gitignore`:
```gitignore
node_modules/
dist/
*.local
.env
.env.*
!.env.example
.DS_Store
```

`package.json`:
```json
{
  "name": "ftd-card-game",
  "private": true,
  "type": "module",
  "scripts": {
    "seed:build": "tsx supabase/seed/cli.ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "uuid": "^11.0.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json` (root — covers `shared/` and `supabase/seed/`; `frontend/` has its own):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowJs": true,
    "types": ["node"]
  },
  "include": ["shared", "supabase/seed"],
  "exclude": ["node_modules", "frontend"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'supabase/seed/**/*.test.ts'],
    passWithNoTests: true,
  },
})
```

`netlify.toml`:
```toml
[build]
  base = "frontend"
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

`README.md`:
```markdown
# FTD Card Game

Turn-based card game companion for From The Depths. Design spec:
`docs/superpowers/specs/2026-08-24-ftd-card-game-design.md`.

## Layout
- `frontend/` — Vite + React SPA
- `shared/` — pure TS game constants/types (imported by frontend and edge functions)
- `supabase/` — migrations, seed pipeline, (later) edge functions

## Setup
1. `npm install` (root tooling), then `cd frontend && npm install`
2. Copy `frontend/.env.example` to `frontend/.env.local` and fill in the Supabase URL + publishable key
3. `cd frontend && npm run dev`

## Tests
`npm test` (root: shared + seed pipeline)
```

- [ ] **Step 2: Install and verify**

Run: `npm install && npm test`
Expected: install succeeds; vitest reports no test files and exits 0 (`passWithNoTests`).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: repo scaffold — tooling, netlify config, README"
```

---

### Task 2: `shared/` constants, types, and username validation

**Files:**
- Create: `shared/gameSettings.ts`, `shared/types.ts`, `shared/validation.ts`
- Test: `shared/validation.test.ts`, `shared/gameSettings.test.ts`

**Interfaces:**
- Produces: `FACTIONS`, `DECK_FACTIONS`, `CARD_TYPES`, `VEHICLE_TYPES`, `ZONE_TYPES`, `KEYWORDS`, `TRIGGERS`, numeric rule constants; types `Faction`, `CardType`, `VehicleType`, `SeedCard`, `SeedHeroPower`; `isValidUsername(name: string): boolean`. Tasks 6 and 9 import these exact names.

- [ ] **Step 1: Write failing tests**

`shared/validation.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { isValidUsername } from './validation'

describe('isValidUsername', () => {
  it('accepts 3-20 chars of letters, digits, underscore', () => {
    expect(isValidUsername('abc')).toBe(true)
    expect(isValidUsername('Sea_Dog_42')).toBe(true)
    expect(isValidUsername('a'.repeat(20))).toBe(true)
  })
  it('rejects too short, too long, bad chars', () => {
    expect(isValidUsername('ab')).toBe(false)
    expect(isValidUsername('a'.repeat(21))).toBe(false)
    expect(isValidUsername('bad name')).toBe(false)
    expect(isValidUsername('bäd')).toBe(false)
    expect(isValidUsername('')).toBe(false)
  })
})
```

`shared/gameSettings.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  DECK_FACTIONS, DECK_SIZE, FACTIONS, KEYWORDS, TRIGGERS, UNIQUE_COPY_LIMIT,
} from './gameSettings'

describe('gameSettings', () => {
  it('has spec defaults', () => {
    expect(DECK_SIZE).toBe(20)
    expect(UNIQUE_COPY_LIMIT).toBe(2)
    expect(DECK_FACTIONS).toEqual(['DWG', 'GT', 'LH', 'OW', 'SS', 'WF'])
  })
  it('deck factions are real factions', () => {
    for (const f of DECK_FACTIONS) expect(Object.values(FACTIONS)).toContain(f)
  })
  it('keywords and triggers match old-BE spellings', () => {
    expect(KEYWORDS.HALF_COST).toBe('halfCost')
    expect(TRIGGERS.ON_PLAY).toBe('onPlayEffect')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./validation` / `./gameSettings`.

- [ ] **Step 3: Implement**

`shared/gameSettings.ts` (verbatim — these values come from spec §3; keyword/trigger strings must match the old BE exactly because seeded card data uses them):
```ts
// Single source of truth for every tunable game rule (spec §3).

export const STARTING_HAND_SIZE = 5
export const STARTING_CP_AMOUNT = 3
export const DECK_SIZE = 20
export const UNIQUE_COPY_LIMIT = 2
export const PLAYER_CARD_LIMIT = 4 // max custom cards per deck
export const FLIER_COPY_LIMIT = 6 // max plane+airship copies per deck
export const SUB_COPY_LIMIT = 6

export const DEFAULT_BASE_HP = 1000
export const MATERIALS_PER_TURN = 50_000 // × floor(turnNumber)
export const BASE_DAMAGE_DIVISOR = 1000 // base dmg = floor(materialCost / this)

export const SPAWN_DISTANCE_DEFAULT_M = 1200
export const SPAWN_DISTANCE_MIN_M = 50
export const SPAWN_DISTANCE_MAX_M = 2000
export const HERO_POWER_DISTANCE_MOD_M = 600
export const IN_BATTLE_RESOURCE_RATE = 0.1

export const SURVIVE_HP_PERCENT = 90
export const REPAIR_WINDOW_MIN_PERCENT = 80
export const REPAIR_COST_RATE = 0.5

export const CUSTOM_CARD_ROUND_TO = 5000 // player cards round UP to this

export const FACTIONS = {
  NEUTRAL: 'NEUTRAL', DWG: 'DWG', SS: 'SS', LH: 'LH', TG: 'TG',
  OW: 'OW', SD: 'SD', WF: 'WF', GT: 'GT',
} as const

// Factions a deck may use as its base (spec §3.1)
export const DECK_FACTIONS = ['DWG', 'GT', 'LH', 'OW', 'SS', 'WF'] as const

export const CARD_TYPES = { VEHICLE: 'vehicle', ABILITY: 'ability' } as const

export const VEHICLE_TYPES = {
  SHIP: 'ship', AIRSHIP: 'airship', TANK: 'tank', PLANE: 'plane', SUB: 'sub',
} as const

export const ZONE_TYPES = { WATER: 'water', BEACH: 'beach', LAND: 'land' } as const

export const KEYWORDS = {
  AIR_SCREEN: 'airScreen', SUB_SCREEN: 'subScreen', BLOCKER: 'blocker',
  SCRAPPY: 'scrappy', TEMPORARY: 'temporary', INOFFENSIVE: 'inoffensive',
  HALF_COST: 'halfCost', FRAGILE: 'fragile', STEALTHY: 'stealthy',
  MOBILE: 'mobile', ROBOTIC: 'robotic',
} as const

export const TRIGGERS = {
  ON_PLAY: 'onPlayEffect', PLAY_ON_ZONE: 'playOnZoneEffect',
  PLAY_ON_VEHICLE: 'playOnVehicleEffect', PLAY_ON_CARD: 'playOnCardEffect',
  ON_DEATH: 'onDeathEffect', ON_BATTLE_EFFECT: 'onBattleEffect',
  ON_BATTLE_VICTORY: 'onBattleVictory', ON_BATTLE_DEFEAT: 'onBattleDefeat',
  ON_ACTIVATE: 'onActivate',
} as const
```

`shared/types.ts`:
```ts
import type { CARD_TYPES, FACTIONS, VEHICLE_TYPES, ZONE_TYPES } from './gameSettings'

export type Faction = (typeof FACTIONS)[keyof typeof FACTIONS]
export type CardType = (typeof CARD_TYPES)[keyof typeof CARD_TYPES]
export type VehicleType = (typeof VEHICLE_TYPES)[keyof typeof VEHICLE_TYPES]
export type ZoneType = (typeof ZONE_TYPES)[keyof typeof ZONE_TYPES]

// Shape of one card object in the old BE's builtInCards/*.js source files.
export interface SeedCard {
  name: string
  isBuiltIn: boolean
  cardText?: string
  materialCost: number
  blueprintCost: number
  cpCost: number
  imageUrl?: string
  playerId: string | null
  vehicleType: VehicleType | null
  type: CardType
  faction: Faction
  blueprintId: string | null
  keywords?: string[]
  meta?: Record<string, unknown>
}

// Shape of one entry in the old BE's heroPowers.js.
export interface SeedHeroPower {
  faction: Faction
  name: string
  text: string
  cpCost: number
}
```

`shared/validation.ts`:
```ts
export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/

export function isValidUsername(name: string): boolean {
  return USERNAME_REGEX.test(name)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/ && git commit -m "feat: shared game constants, seed types, username validation"
```

---

### Task 3: Migration — profiles, signup trigger, username_available RPC

**Files:**
- Create: `supabase/migrations/20260824000001_create_profiles.sql`

**Interfaces:**
- Produces: `public.profiles` (id, username, created_at); `public.username_available(check_name text) → boolean` (callable by `anon` — Task 9's signup pre-check uses it via `supabase.rpc('username_available', { check_name })`).

- [ ] **Step 1: Write the migration file** (exact content):

```sql
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null
    check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

-- case-insensitive uniqueness
create unique index profiles_username_lower_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Auto-create a profile row on signup. Username comes from signup metadata;
-- falls back to a generated name so a missing field never breaks signup.
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
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Signup-time availability check, callable before authentication.
create or replace function public.username_available(check_name text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(check_name)
  );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
```

- [ ] **Step 2: Apply to remote**

Use MCP `apply_migration` with name `create_profiles` and the file's exact content.
Expected: success.

- [ ] **Step 3: Verify**

Use MCP `execute_sql`: `select public.username_available('some_free_name');` → `true`.
Use MCP `list_tables` → `profiles` present with RLS enabled.
Use MCP `get_advisors` (type security) → no new criticals about `profiles` (a warning that `username_available` is SECURITY DEFINER is expected and acceptable — it exposes only a boolean).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ && git commit -m "feat(db): profiles table, signup trigger, username_available RPC"
```

---

### Task 4: Migration — cards and hero_powers

**Files:**
- Create: `supabase/migrations/20260824000002_create_cards_and_hero_powers.sql`

**Interfaces:**
- Produces: `public.cards` and `public.hero_powers` exactly as below — Task 6 generates INSERTs against these columns; Task 8's generated TS types cover them. Note: the hero power description column is `power_text` (not `text`, which is a SQL type name).

- [ ] **Step 1: Write the migration file** (exact content):

```sql
create table public.cards (
  id uuid primary key,
  name text not null,
  is_built_in boolean not null default false,
  owner_id uuid references public.profiles (id) on delete cascade,
  faction text not null
    check (faction in ('NEUTRAL','DWG','SS','LH','TG','OW','SD','WF','GT')),
  type text not null check (type in ('vehicle','ability')),
  vehicle_type text
    check (vehicle_type in ('ship','airship','tank','plane','sub')),
  blueprint_cost integer not null default 0,
  material_cost integer not null default 0,
  cp_cost integer not null default 0,
  card_text text not null default '',
  image_url text not null default '',
  keywords jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint vehicle_requires_vehicle_type
    check (type <> 'vehicle' or vehicle_type is not null),
  constraint built_in_has_no_owner
    check (not is_built_in or owner_id is null)
);

create index cards_owner_id_idx on public.cards (owner_id);
create index cards_faction_idx on public.cards (faction);

alter table public.cards enable row level security;

-- Read-only for clients; ALL writes go through service role (Studio/edge functions).
create policy "cards_select_authenticated" on public.cards
  for select to authenticated using (true);

create table public.hero_powers (
  id uuid primary key,
  name text not null,
  faction text not null
    check (faction in ('NEUTRAL','DWG','SS','LH','TG','OW','SD','WF','GT')),
  power_text text not null,
  cp_cost integer not null default 1,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.hero_powers enable row level security;

create policy "hero_powers_select_authenticated" on public.hero_powers
  for select to authenticated using (true);
```

- [ ] **Step 2: Apply to remote**

MCP `apply_migration`, name `create_cards_and_hero_powers`, exact file content.

- [ ] **Step 3: Verify**

MCP `list_tables` → both tables, RLS enabled. MCP `get_advisors` (security) → no new criticals.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ && git commit -m "feat(db): cards and hero_powers tables with read-only RLS"
```

---

### Task 5: Import seed source data from old BE repo

**Files:**
- Create: `supabase/seed/source/gameSettings.js`, `supabase/seed/source/heroPowers.js`, `supabase/seed/source/builtInCards/*.js` (6 files), `supabase/seed/source/README.md`

- [ ] **Step 1: Obtain the old BE repo**

If `C:/Users/JFinn/AppData/Local/Temp/claude/C--Users-JFinn-FtDCardGame/c0e08782-aefb-4fab-9490-16ed4a33e343/scratchpad/be-repo` exists, use it. Otherwise:
```bash
git clone --depth 1 https://github.com/joey101937/ftd-cg-backend.git /tmp/be-repo
```

- [ ] **Step 2: Copy files verbatim** (preserving relative layout so imports resolve):

```bash
SRC=<path-to-be-repo>/src/gameConstants
mkdir -p supabase/seed/source/builtInCards
cp "$SRC/gameSettings.js" "$SRC/heroPowers.js" supabase/seed/source/
cp "$SRC"/builtInCards/*.js supabase/seed/source/builtInCards/
```

Expected files in `builtInCards/`: `DWG-built-in.js`, `SS-built-in.js`, `LH-Built-in.js`, `OW-Built-in.js`, `WF-built-in.js`, `GT-built-in.js` (mixed casing is in the source — keep it). Do NOT edit their contents.

`supabase/seed/source/README.md`:
```markdown
Card/hero-power source data copied verbatim from
https://github.com/joey101937/ftd-cg-backend (src/gameConstants).
Do not hand-edit; these files are read by ../transform.ts.
Note: files export multiple arrays with mixed names (e.g. LH-Built-in.js
exports TG_ROBOTICS and lhVehicles); the card's own `faction` field is
authoritative, not the filename.
```

- [ ] **Step 3: Verify the transform inputs load**

Run: `npx tsx -e "const m = await import('./supabase/seed/source/builtInCards/DWG-built-in.js'); console.log(m.dwgVehicles.length)"`
Expected: a number ≥ 20 printed (the file imports `../gameSettings` — works because of the preserved layout).

- [ ] **Step 4: Commit**

```bash
git add supabase/seed/source/ && git commit -m "chore(seed): import built-in card and hero power data from old BE repo"
```

---

### Task 6: Seed transform — old BE JS → upsert SQL (TDD)

**Files:**
- Create: `supabase/seed/transform.ts` (library), `supabase/seed/cli.ts` (entry)
- Test: `supabase/seed/transform.test.ts`
- Generated (committed): `supabase/seed/seed_data.sql`

**Interfaces:**
- Consumes: `SeedCard`, `SeedHeroPower`, `FACTIONS` from `shared/` (Task 2); source files (Task 5).
- Produces: `loadSeedData(): Promise<{cards: SeedCard[], heroPowers: SeedHeroPower[]}>`, `cardId(faction: string, name: string): string`, `heroPowerId(faction: string, name: string): string`, `buildSeedSql(cards: SeedCard[], heroPowers: SeedHeroPower[]): string`. Task 7 applies `seed_data.sql`.

- [ ] **Step 1: Write failing tests**

`supabase/seed/transform.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { FACTIONS } from '../../shared/gameSettings'
import type { SeedCard } from '../../shared/types'
import { buildSeedSql, cardId, heroPowerId, loadSeedData } from './transform'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function fakeCard(over: Partial<SeedCard> = {}): SeedCard {
  return {
    name: 'Test', isBuiltIn: true, cardText: '', materialCost: 1000,
    blueprintCost: 1000, cpCost: 0, imageUrl: '', playerId: null,
    vehicleType: 'ship', type: 'vehicle', faction: 'DWG', blueprintId: null,
    ...over,
  }
}

describe('deterministic ids', () => {
  it('are stable and distinct', () => {
    expect(cardId('DWG', 'Marauder')).toBe(cardId('DWG', 'Marauder'))
    expect(cardId('DWG', 'Marauder')).toMatch(UUID_RE)
    expect(cardId('DWG', 'Marauder')).not.toBe(cardId('SS', 'Marauder'))
    expect(cardId('DWG', 'Marauder')).not.toBe(heroPowerId('DWG', 'Marauder'))
  })
})

describe('loadSeedData', () => {
  it('loads all factions including LH (old seeder skipped it)', async () => {
    const { cards, heroPowers } = await loadSeedData()
    expect(cards.length).toBeGreaterThanOrEqual(100)
    for (const f of ['DWG', 'SS', 'LH', 'OW', 'WF', 'GT']) {
      expect(cards.some((c) => c.faction === f)).toBe(true)
    }
    for (const c of cards) {
      expect(Object.values(FACTIONS)).toContain(c.faction)
      expect(c.name.length).toBeGreaterThan(0)
    }
    expect(heroPowers.length).toBe(7)
    expect(heroPowers.filter((h) => h.faction === 'NEUTRAL').length).toBe(4)
  })
  it('has no conflicting duplicate (faction, name) pairs', async () => {
    const { cards } = await loadSeedData()
    const seen = new Map<string, SeedCard>()
    for (const c of cards) {
      const key = `${c.faction}:${c.name}`
      expect(seen.has(key)).toBe(false)
      seen.set(key, c)
    }
  })
})

describe('buildSeedSql', () => {
  it('escapes quotes and serializes jsonb', () => {
    const sql = buildSeedSql(
      [fakeCard({ name: "O'Brien", cardText: "the enemy's loss", keywords: ['scrappy'] })],
      [],
    )
    expect(sql).toContain("O''Brien")
    expect(sql).toContain("the enemy''s loss")
    expect(sql).toContain('["scrappy"]')
    expect(sql).toContain('on conflict (id) do update')
  })
  it('keeps vehicle_type null for ability cards', () => {
    const sql = buildSeedSql([fakeCard({ type: 'ability', vehicleType: null })], [])
    // value order is fixed: ... faction, type, vehicle_type, ... so a null
    // vehicle_type on an ability card renders as: 'ability', null
    expect(sql).toContain("'ability', null")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `./transform` not found.

- [ ] **Step 3: Implement `supabase/seed/transform.ts`**

```ts
import { readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { v5 as uuidv5 } from 'uuid'
import type { SeedCard, SeedHeroPower } from '../../shared/types'

// Fixed namespace: changing it changes every seeded id. Never change it.
const FTD_NAMESPACE = 'a1b0c7e2-4f3d-4b6a-9e8c-2d5f7a9b1c3e'

export const cardId = (faction: string, name: string): string =>
  uuidv5(`card:${faction}:${name}`, FTD_NAMESPACE)

export const heroPowerId = (faction: string, name: string): string =>
  uuidv5(`hero:${faction}:${name}`, FTD_NAMESPACE)

const SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'source')

export async function loadSeedData(): Promise<{
  cards: SeedCard[]
  heroPowers: SeedHeroPower[]
}> {
  const cardsDir = join(SOURCE_DIR, 'builtInCards')
  const byKey = new Map<string, SeedCard>()
  for (const file of readdirSync(cardsDir).filter((f) => f.endsWith('.js')).sort()) {
    const mod = await import(pathToFileURL(join(cardsDir, file)).href)
    for (const value of Object.values(mod)) {
      if (!Array.isArray(value)) continue
      for (const card of value as SeedCard[]) {
        if (!card?.name || !card?.faction) {
          throw new Error(`Malformed card in ${file}: ${JSON.stringify(card)}`)
        }
        const key = `${card.faction}:${card.name}`
        const existing = byKey.get(key)
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(card)) {
            throw new Error(`Conflicting duplicate card ${key} in ${file}`)
          }
          continue // identical duplicate: keep first
        }
        byKey.set(key, card)
      }
    }
  }
  const cards = [...byKey.values()].sort((a, b) =>
    `${a.faction}:${a.name}`.localeCompare(`${b.faction}:${b.name}`),
  )
  const heroMod = await import(pathToFileURL(join(SOURCE_DIR, 'heroPowers.js')).href)
  const heroPowers = heroMod.allHeroPowers as SeedHeroPower[]
  return { cards, heroPowers }
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
const qj = (v: unknown): string => `${q(JSON.stringify(v ?? null))}::jsonb`

export function buildSeedSql(cards: SeedCard[], heroPowers: SeedHeroPower[]): string {
  const parts: string[] = ['-- GENERATED by supabase/seed/cli.ts. Do not hand-edit.']
  for (const c of cards) {
    const values = [
      q(cardId(c.faction, c.name)),
      q(c.name),
      'true',
      'null',
      q(c.faction),
      q(c.type),
      c.vehicleType == null ? 'null' : q(c.vehicleType),
      String(c.blueprintCost ?? 0),
      String(c.materialCost ?? 0),
      String(c.cpCost ?? 0),
      q(c.cardText ?? ''),
      q(c.imageUrl ?? ''),
      qj(c.keywords ?? []),
      qj(c.meta ?? {}),
    ]
    parts.push(
      `insert into public.cards (id, name, is_built_in, owner_id, faction, type, vehicle_type, blueprint_cost, material_cost, cp_cost, card_text, image_url, keywords, meta)\n` +
        `values (${values.join(', ')})\n` +
        `on conflict (id) do update set name = excluded.name, is_built_in = excluded.is_built_in, owner_id = excluded.owner_id, faction = excluded.faction, type = excluded.type, vehicle_type = excluded.vehicle_type, blueprint_cost = excluded.blueprint_cost, material_cost = excluded.material_cost, cp_cost = excluded.cp_cost, card_text = excluded.card_text, image_url = excluded.image_url, keywords = excluded.keywords, meta = excluded.meta;`,
    )
  }
  for (const h of heroPowers) {
    parts.push(
      `insert into public.hero_powers (id, name, faction, power_text, cp_cost, meta)\n` +
        `values (${q(heroPowerId(h.faction, h.name))}, ${q(h.name)}, ${q(h.faction)}, ${q(h.text)}, ${String(h.cpCost ?? 1)}, '{}'::jsonb)\n` +
        `on conflict (id) do update set name = excluded.name, faction = excluded.faction, power_text = excluded.power_text, cp_cost = excluded.cp_cost, meta = excluded.meta;`,
    )
  }
  return parts.join('\n')
}
```

`supabase/seed/cli.ts`:
```ts
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildSeedSql, loadSeedData } from './transform'

const { cards, heroPowers } = await loadSeedData()
const sql = buildSeedSql(cards, heroPowers)
const out = join(dirname(fileURLToPath(import.meta.url)), 'seed_data.sql')
writeFileSync(out, sql)
console.log(`Wrote ${cards.length} cards + ${heroPowers.length} hero powers to ${out}`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. If `loadSeedData` throws on a *conflicting* duplicate in the real data, do NOT silently dedupe — print both versions, then keep the one with the longer `cardText` and add a code comment naming the card; re-run.

- [ ] **Step 5: Generate and eyeball the SQL**

Run: `npm run seed:build`
Expected: "Wrote N cards + 7 hero powers" with N ≥ 100. Skim `seed_data.sql`: LH and GT cards present, apostrophes doubled, jsonb well-formed.

- [ ] **Step 6: Commit**

```bash
git add supabase/seed/ && git commit -m "feat(seed): deterministic card/hero-power seed SQL generator"
```

---

### Task 7: Apply seed to remote and verify

**Files:** none (remote operation; `seed_data.sql` from Task 6)

- [ ] **Step 1: Apply**

Use MCP `execute_sql` with the full content of `supabase/seed/seed_data.sql`. If the tool rejects it for size, split at statement boundaries into per-faction chunks and apply sequentially (statements are independent upserts — safe to retry).

- [ ] **Step 2: Verify counts and content**

MCP `execute_sql`:
```sql
select faction, count(*) from public.cards group by faction order by faction;
select count(*) from public.hero_powers;
select name, material_cost, keywords from public.cards where faction = 'LH' limit 3;
```
Expected: 6+ factions with LH > 0 and total ≥ 100; hero_powers = 7; LH rows look sane.

- [ ] **Step 3: Re-run idempotency check**

Apply the same SQL once more via `execute_sql`, then re-run the counts — they must be unchanged (upserts, not duplicates).

- [ ] **Step 4: Commit** (nothing to commit if seed_data.sql unchanged; otherwise commit regenerated file)

```bash
git status
```

---

### Task 8: Frontend scaffold — Vite, Tailwind v4, theme, app shell

**Files:**
- Create: `frontend/` (Vite react-ts template), `frontend/.env.example`, `frontend/.env.local` (NOT committed), `frontend/src/lib/supabaseClient.ts`, `frontend/src/lib/database.types.ts` (generated), `frontend/src/theme/index.css`, `frontend/src/components/NavBar.tsx`, `frontend/src/pages/HomePage.tsx`, `frontend/src/App.tsx` (replace), `frontend/src/main.tsx` (replace), assets under `frontend/src/assets/` and `frontend/public/`

**Interfaces:**
- Produces: `supabase` client export; `<NavBar />`; route skeleton `/` — Task 9 adds `/login`, `/signup` and auth context around this shell. Vite alias `@shared` → `../shared`.

- [ ] **Step 1: Scaffold and install** (check Context7 for current Vite/Tailwind v4 setup first)

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install @supabase/supabase-js @tanstack/react-query react-router-dom
npm install tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Configure Vite** — `frontend/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
})
```

Also add to `frontend/tsconfig.app.json` compilerOptions: `"paths": { "@shared/*": ["../shared/*"] }, "baseUrl": "."` and include `"../shared"` in its `include` array.

- [ ] **Step 3: Env + client.** Fetch the project URL via MCP `get_project_url` and the publishable key via MCP `get_publishable_keys` (use the default/current publishable key).

`frontend/.env.example` (committed):
```bash
VITE_SUPABASE_URL=https://wpgsjnjnvykxavaxibld.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=replace-me
```
`frontend/.env.local` (git-ignored): same keys with the real values.

`frontend/src/lib/supabaseClient.ts`:
```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
```

Generate `frontend/src/lib/database.types.ts` via MCP `generate_typescript_types` and save the output verbatim.

- [ ] **Step 4: Assets.** From the old FE repo clone (see Global Constraints; clone fresh if missing): copy `src/Icons/*.svg` → `frontend/src/assets/icons/`, `src/Fonts/Lobster-Regular.ttf` → `frontend/src/assets/fonts/`, `public/ftd-logo-large.png` and `public/appIcon.ico` → `frontend/public/`. Point the favicon at `/appIcon.ico` in `frontend/index.html` and set `<title>FTD Card Game</title>`.

- [ ] **Step 5: Theme.** Replace `frontend/src/index.css` with `frontend/src/theme/index.css` (update the import in `main.tsx`):

```css
@import "tailwindcss";

@font-face {
  font-family: "Lobster";
  src: url("../assets/fonts/Lobster-Regular.ttf") format("truetype");
  font-display: swap;
}

@theme {
  --color-ocean-950: #081a36;
  --color-ocean-900: #0e2954;
  --color-ocean-800: #153870;
  --color-ocean-600: #2b5ea7;
  --color-ocean-300: #7fb2e5;
  --color-parchment-100: #f2e8d5;
  --color-parchment-300: #d9c9a3;
  --color-brass-400: #c9a227;
  --font-display: "Lobster", cursive;
  --shadow-plank: 4px 4px 4px rgba(20, 20, 20, 0.8);
}

body {
  @apply min-h-screen text-parchment-100;
  background: linear-gradient(180deg, var(--color-ocean-800), var(--color-ocean-950));
}
```

- [ ] **Step 6: Shell.**

`frontend/src/components/NavBar.tsx`:
```tsx
import { Link } from 'react-router-dom'

export function NavBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-6 border-b border-ocean-600 bg-ocean-900/80 px-6 py-3 shadow-plank">
      <Link to="/" className="flex items-center gap-3">
        <img src="/ftd-logo-large.png" alt="FTD Card Game" className="h-10" />
        <span className="font-display text-2xl text-parchment-100">FTD Card Game</span>
      </Link>
      <nav className="ml-auto flex items-center gap-4">{right}</nav>
    </header>
  )
}
```

`frontend/src/pages/HomePage.tsx`:
```tsx
export function HomePage() {
  return (
    <main className="mx-auto max-w-3xl p-8 text-center">
      <h1 className="font-display text-4xl">Welcome, Captain</h1>
      <p className="mt-4 text-ocean-300">
        Build a fleet, claim the zones, and settle it in From The Depths.
      </p>
    </main>
  )
}
```

`frontend/src/App.tsx`:
```tsx
import { Route, Routes } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { HomePage } from './pages/HomePage'

export default function App() {
  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </>
  )
}
```

`frontend/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './theme/index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

Delete the template's `App.css` and unused template assets.

- [ ] **Step 7: Verify** — `cd frontend && npm run build` passes, then start the dev server via the Browser pane (`preview_start` with a `.claude/launch.json` entry: runtimeExecutable `npm`, runtimeArgs `["run","dev"]`, port 5173, name `frontend`) and screenshot `/` — navy gradient, logo, Lobster heading render.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(frontend): Vite scaffold, ocean theme, app shell with legacy assets"
```

---

### Task 9: Auth — provider, signup/login pages, protected shell

**Files:**
- Create: `frontend/src/lib/auth.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/SignupPage.tsx`, `frontend/src/components/RequireAuth.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/pages/HomePage.tsx`
- Test: none — username validation is already unit-tested in `shared/` (Task 2); the auth flow itself is verified end-to-end in the browser (Task 10)

**Interfaces:**
- Consumes: `supabase` (Task 8), `isValidUsername` from `@shared/validation`, RPC `username_available` (Task 3).
- Produces: `useAuth(): { session: Session | null; loading: boolean }`; `<RequireAuth>` wrapper.

- [ ] **Step 1: Auth provider** — `frontend/src/lib/auth.tsx`:

```tsx
import { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

type AuthState = { session: Session | null; loading: boolean }
const AuthContext = createContext<AuthState>({ session: null, loading: true })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) =>
      setState({ session: data.session, loading: false }),
    )
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      setState({ session, loading: false }),
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
```

- [ ] **Step 2: Guard** — `frontend/src/components/RequireAuth.tsx`:

```tsx
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="p-8 text-center">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 3: Signup page** — `frontend/src/pages/SignupPage.tsx`. Must: validate username with `isValidUsername`, pre-check `supabase.rpc('username_available', { check_name: username })`, call `supabase.auth.signUp({ email, password, options: { data: { username } } })`, then branch: if `data.session` exists → navigate `/`; else → render "Check your email to confirm your account" (covers confirm-email ON). Show `error.message` from Supabase on failure.

```tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isValidUsername } from '@shared/validation'
import { supabase } from '../lib/supabaseClient'

export function SignupPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isValidUsername(username)) {
      setError('Username must be 3-20 letters, numbers, or underscores.')
      return
    }
    setBusy(true)
    try {
      const { data: free, error: rpcError } = await supabase.rpc('username_available', {
        check_name: username,
      })
      if (rpcError) throw rpcError
      if (!free) {
        setError('That username is taken.')
        return
      }
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      })
      if (signUpError) throw signUpError
      if (data.session) navigate('/')
      else setNeedsConfirm(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (needsConfirm) {
    return (
      <main className="mx-auto max-w-sm p-8 text-center">
        <h1 className="font-display text-3xl">Almost aboard!</h1>
        <p className="mt-4">Check your email to confirm your account, then sign in.</p>
        <Link className="mt-4 inline-block underline" to="/login">Go to sign in</Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="font-display text-3xl text-center">Enlist</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <input className="rounded bg-ocean-900 p-2" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="rounded bg-ocean-900 p-2" placeholder="Email" type="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="rounded bg-ocean-900 p-2" placeholder="Password" type="password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-red-400">{error}</p>}
        <button disabled={busy} className="rounded bg-brass-400 p-2 font-bold text-ocean-950">
          {busy ? 'Enlisting…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-center">
        Already enlisted? <Link className="underline" to="/login">Sign in</Link>
      </p>
    </main>
  )
}
```

- [ ] **Step 4: Login page** — `frontend/src/pages/LoginPage.tsx`: same layout; `supabase.auth.signInWithPassword({ email, password })`; on success navigate `/`; on error show `error.message`. Link to `/signup`.

```tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (signInError) setError(signInError.message)
    else navigate('/')
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="font-display text-3xl text-center">Sign in</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <input className="rounded bg-ocean-900 p-2" placeholder="Email" type="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="rounded bg-ocean-900 p-2" placeholder="Password" type="password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-red-400">{error}</p>}
        <button disabled={busy} className="rounded bg-brass-400 p-2 font-bold text-ocean-950">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-4 text-center">
        New recruit? <Link className="underline" to="/signup">Create account</Link>
      </p>
    </main>
  )
}
```

- [ ] **Step 5: Wire routes + profile display.** `App.tsx`: wrap everything in `<AuthProvider>`; routes `/login`, `/signup` public; `/` inside `<RequireAuth>`. NavBar `right` slot: when signed in, show the username (TanStack Query: `supabase.from('profiles').select('username').eq('id', session.user.id).single()`) and a "Sign out" button calling `supabase.auth.signOut()`.

```tsx
import { Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase } from './lib/supabaseClient'
import { NavBar } from './components/NavBar'
import { RequireAuth } from './components/RequireAuth'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'

function UserMenu() {
  const { session } = useAuth()
  const { data: profile } = useQuery({
    queryKey: ['profile', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('username').eq('id', session!.user.id).single()
      if (error) throw error
      return data
    },
  })
  if (!session) return null
  return (
    <div className="flex items-center gap-3">
      <span className="text-ocean-300">{profile?.username ?? '…'}</span>
      <button className="underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <NavBar right={<UserMenu />} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
      </Routes>
    </AuthProvider>
  )
}
```

- [ ] **Step 6: Verify build**

Run: `cd frontend && npm run build`
Expected: clean TypeScript build.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(frontend): email/password auth with signup username flow"
```

---

### Task 10: End-to-end verification and push

**Files:** none new

- [ ] **Step 1: Browser E2E.** Via the Browser pane dev server: visit `/` → redirected to `/login`. Sign up a test account (e.g. username `test_captain`, email `jacob.finn+ftdtest1@streetfeastapp.com`, throwaway password). If confirm-email is ON in the dashboard you'll see the "check your email" screen — report that to the user and verify login with a manually-confirmed account instead (MCP `execute_sql`: `update auth.users set email_confirmed_at = now() where email = '...';`). Confirm: home page shows the username in the nav; sign out returns to `/login`; sign back in works.

- [ ] **Step 2: DB verification.** MCP `execute_sql`: `select username from public.profiles;` → the test username exists (trigger worked).

- [ ] **Step 3: Advisors sweep.** MCP `get_advisors` for BOTH `security` and `performance`. Fix anything CRITICAL/ERROR-level introduced by our migrations before proceeding; report warnings.

- [ ] **Step 4: Push**

```bash
git push -u origin main
```
Expected: branch published to https://github.com/bromtheman/CardGame.

- [ ] **Step 5: Report.** Summarize to the user: what's live, the test account credentials' email (not password), whether confirm-email is on, and any advisor warnings left.

---

## Self-review notes (completed)

- Spec coverage: §2 layout (Tasks 1–2, 8), §4 profiles/cards/hero_powers + storage-bucket *deferred to Phase 2 where custom-card upload lands* (bucket is not needed before then), §9 Phase-1 line fully covered. Lobbies/games/decks tables intentionally deferred to Phases 2–3 per spec phasing.
- Type consistency: `power_text` column used in Task 4 SQL and Task 6 generator; `SeedCard`/`SeedHeroPower` defined Task 2, consumed Task 6; `username_available(check_name)` name matches between Task 3 SQL and Task 9 RPC call; `VITE_SUPABASE_PUBLISHABLE_KEY` matches between env and client.
- Placeholders: none — every code step carries full content.
