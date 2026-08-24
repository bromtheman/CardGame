# Phase 2: Cards & Decks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the card browser, custom card creation (edge function + Storage), and the deck builder with faction selection and live validation — plus the auth-hardening migration deferred from Phase 1.

**Architecture:** New `decks` table and `card-images` Storage bucket (SQL migrations via MCP). Custom-card rules (cost rounding, auto-keywords) and deck validation live in `shared/` as pure tested functions; the `create-card` edge function and the frontend both consume them (function-side via a committed sync copy with a drift-guard test). Frontend adds `/cards`, `/decks`, `/decks/:id` pages using the Phase 1 shell, TanStack Query, and direct RLS-protected table access for decks.

**Tech Stack:** Existing Phase 1 stack (Vite 8 + React 19 + TS, Tailwind v4, supabase-js v2, TanStack Query v5, vitest) plus Supabase Storage and one Deno edge function.

**Spec:** `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` — §3.1 (deck rules), §3.10 (custom cards), §4 (`decks`, Storage), §5 (`create-card`), §7 (pages, card visuals). Read it first.

## Global Constraints

- Supabase project ref: `wpgsjnjnvykxavaxibld`; remote-only — use MCP tools (`apply_migration`, `execute_sql`, `get_advisors`, `generate_typescript_types`, `deploy_edge_function`). Committed migration files and remotely applied content stay IDENTICAL.
- All tunable numbers live in `shared/gameSettings.ts` ONLY. New this phase: `MAX_CUSTOM_BLUEPRINT_COST`, `CARD_IMAGE_MAX_BYTES`, `CARD_IMAGE_MIME_TYPES`, `DEFAULT_DECK_RULES` values — defined in Task 3/4, never inlined at usage sites.
- RLS: every policy `to authenticated`, auth functions wrapped `(select auth.uid())`, index every RLS/FK column.
- `cards` writes stay server-side only: custom cards insert ONLY via the `create-card` edge function. `decks` is client-writable under owner-only RLS (spec §4).
- Custom cards: faction `NEUTRAL`, `cp_cost` 0, `card_text` '', `meta` {}, no effects (spec §3.10). Material cost = blueprint cost rounded UP to nearest 5k, then halved (floor) for planes. Auto-keywords: plane → halfCost+temporary, airship → fragile.
- Storage bucket `card-images`: public read, 2 MB limit, jpg/png/webp. Clients CANNOT write to Storage directly — the MCP `postgres` role cannot create `storage.objects` policies (verified live: table owned by `supabase_storage_admin`), so ALL uploads flow through the `create-card` edge function's service-role client, into a folder named by the card creator's user id.
- Edge function name: `create-card`, deployed with `verify_jwt: false` — it performs its own `getUser()` auth and must serve CORS preflight; gateway JWT verification is also incompatible with new-style publishable keys. Browser calls still need CORS handling (OPTIONS + headers) in the function.
- Deno rule: every relative import inside `shared/` modules MUST carry an explicit `.ts` extension (`from './gameSettings.ts'`) — Deno cannot resolve extensionless specifiers, and the function's synced copies are byte-identical to the sources. Frontend/vitest tolerate this (`allowImportingTsExtensions`).
- TDD for all `shared/` logic (RED evidence before GREEN). Frontend gate: `cd frontend && npm run build` clean.
- Before writing code against supabase-js Storage/Functions APIs or Deno edge-function patterns, check current docs via Context7 (user mandate).
- Commit per task; every commit message ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Windows machine; Bash tool (Git Bash). Two npm roots (repo root + frontend/).
- Controller-known data facts: seeded built-in `image_url`s are bare filenames that resolve nowhere (placeholder art required); 4 seeded TG-faction cards are undeckable (TG is not a deck faction) — expected, not a bug.

---

### Task 1: Migration — auth hardening (Phase 1 deferred items)

**Files:**
- Create: `supabase/migrations/20260825000003_harden_signup.sql`

**Interfaces:**
- Produces: same `handle_new_user()` behavior with friendly errors; no schema shape changes. Nothing downstream consumes new names.

- [ ] **Step 1: Write the migration file** (exact content):

```sql
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
```

- [ ] **Step 2: Apply remotely** — MCP `apply_migration`, name `harden_signup`, identical content.

- [ ] **Step 3: Verify** — MCP `get_advisors` (security): the two `handle_new_user` SECURITY-DEFINER-executable WARNs from Phase 1 must be gone; remaining expected WARNs: `username_available` exposure (by design) and leaked-password-protection (user dashboard action). MCP `execute_sql`: `select public.username_available('test_captain');` → `false` (existing user still intact).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ && git commit -m "feat(db): harden signup trigger (revoke execute, friendly errors)"
```

---

### Task 2: Migration — decks table + card-images Storage bucket

**Files:**
- Create: `supabase/migrations/20260825000004_create_decks_and_storage.sql`
- Modify: `frontend/src/lib/database.types.ts` (regenerated)

**Interfaces:**
- Produces: `public.decks(id, owner_id, name, faction, cards, created_at, updated_at)` — Tasks 8-9 read/write it directly via RLS; bucket `card-images` — Task 7 uploads to `{auth.uid()}/{uuid}.{ext}`; regenerated `Database` types including `decks`.

- [ ] **Step 1: Write the migration file** (exact content):

```sql
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  faction text not null check (faction in ('DWG','GT','LH','OW','SS','WF')),
  cards jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index decks_owner_id_idx on public.decks (owner_id);

alter table public.decks enable row level security;

create policy "decks_select_own" on public.decks
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "decks_insert_own" on public.decks
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "decks_update_own" on public.decks
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "decks_delete_own" on public.decks
  for delete to authenticated using ((select auth.uid()) = owner_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger decks_set_updated_at
  before update on public.decks
  for each row execute function public.set_updated_at();

-- Card image storage: public read, 2 MB, images only.
-- Deliberately NO policies on storage.objects: the MCP role cannot create
-- them (table owned by supabase_storage_admin), so clients get no direct
-- write access. All uploads go through the create-card edge function's
-- service-role client, which bypasses RLS. Public reads need no policy
-- (public bucket, served via the public-object endpoint).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 2097152,
        array['image/jpeg','image/png','image/webp']);
```

- [ ] **Step 2: Apply remotely** — MCP `apply_migration`, name `create_decks_and_storage`.

- [ ] **Step 3: Verify** — MCP `list_tables` → `decks` with RLS enabled. MCP `execute_sql`: `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'card-images';` → one row matching the migration. `get_advisors` (security) → no new criticals.

- [ ] **Step 4: Regenerate types** — MCP `generate_typescript_types`, save verbatim over `frontend/src/lib/database.types.ts`. Then `cd frontend && npm run build` must still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ frontend/src/lib/database.types.ts && git commit -m "feat(db): decks table with owner RLS, card-images storage bucket"
```

---

### Task 3: `shared/customCards.ts` — cost + keyword rules (TDD)

**Files:**
- Create: `shared/customCards.ts`
- Modify: `shared/gameSettings.ts` (add constants), `shared/types.ts` (import gains `.ts` extension), root `tsconfig.json` (add `"allowImportingTsExtensions": true` to compilerOptions)
- Test: `shared/customCards.test.ts`

**Interfaces:**
- Consumes: `CUSTOM_CARD_ROUND_TO`, `KEYWORDS`, `VEHICLE_TYPES` (Phase 1).
- Produces: `MAX_CUSTOM_BLUEPRINT_COST`, `CARD_IMAGE_MAX_BYTES = 2_097_152`, `CARD_IMAGE_MIME_TYPES` (gameSettings); `roundUpCost(blueprintCost: number): number`, `computeMaterialCost(blueprintCost: number, vehicleType: VehicleType): number`, `autoKeywords(vehicleType: VehicleType): string[]`, `validateCustomCardInput(input: { name: string; vehicleType: string; blueprintCost: number }): string[]` (empty array = valid). Tasks 5 and 7 import these exact names.

- [ ] **Step 1: Write failing tests** — `shared/customCards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  autoKeywords, computeMaterialCost, roundUpCost, validateCustomCardInput,
} from './customCards'

describe('roundUpCost', () => {
  it('rounds up to nearest 5k', () => {
    expect(roundUpCost(40205)).toBe(45000)
    expect(roundUpCost(45000)).toBe(45000)
    expect(roundUpCost(1)).toBe(5000)
  })
})

describe('computeMaterialCost', () => {
  it('is the rounded cost for non-planes', () => {
    expect(computeMaterialCost(40205, 'ship')).toBe(45000)
    expect(computeMaterialCost(40205, 'airship')).toBe(45000)
  })
  it('halves after rounding for planes (Half-Cost rule)', () => {
    expect(computeMaterialCost(40205, 'plane')).toBe(22500)
    expect(computeMaterialCost(5000, 'plane')).toBe(2500)
  })
})

describe('autoKeywords', () => {
  it('plane -> halfCost + temporary; airship -> fragile; others none', () => {
    expect(autoKeywords('plane')).toEqual(['halfCost', 'temporary'])
    expect(autoKeywords('airship')).toEqual(['fragile'])
    expect(autoKeywords('ship')).toEqual([])
    expect(autoKeywords('tank')).toEqual([])
    expect(autoKeywords('sub')).toEqual([])
  })
})

describe('validateCustomCardInput', () => {
  const good = { name: 'My Gunboat', vehicleType: 'ship', blueprintCost: 42000 }
  it('accepts a valid input', () => {
    expect(validateCustomCardInput(good)).toEqual([])
  })
  it('rejects bad name, type, and cost', () => {
    expect(validateCustomCardInput({ ...good, name: '' })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, name: 'x'.repeat(41) })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, vehicleType: 'boat' })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, blueprintCost: 0 })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, blueprintCost: 1.5 })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, blueprintCost: 10_000_001 })).not.toEqual([])
  })
})
```

- [ ] **Step 2: Run `npm test`** — expect FAIL (module not found).

- [ ] **Step 3: Implement.** Add to `shared/gameSettings.ts` (after `CUSTOM_CARD_ROUND_TO`):

```ts
export const MAX_CUSTOM_BLUEPRINT_COST = 10_000_000
export const CARD_IMAGE_MAX_BYTES = 2_097_152 // must match the storage bucket limit
export const CARD_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
```

Also in this step (Deno compatibility — see Global Constraints): change `shared/types.ts` line 1 to `import type { CARD_TYPES, FACTIONS, VEHICLE_TYPES, ZONE_TYPES } from './gameSettings.ts'`, and add `"allowImportingTsExtensions": true` to root `tsconfig.json` compilerOptions (it already has `noEmit`). Frontend `tsconfig.app.json` already allows this.

`shared/customCards.ts` (note the `.ts` extensions — required, this file gets synced into the Deno function):

```ts
import {
  CUSTOM_CARD_ROUND_TO, KEYWORDS, MAX_CUSTOM_BLUEPRINT_COST, VEHICLE_TYPES,
} from './gameSettings.ts'
import type { VehicleType } from './types.ts'

export function roundUpCost(blueprintCost: number): number {
  return Math.ceil(blueprintCost / CUSTOM_CARD_ROUND_TO) * CUSTOM_CARD_ROUND_TO
}

// Spec §3.10: round up to 5k first, then Half-Cost halves it for planes.
export function computeMaterialCost(blueprintCost: number, vehicleType: VehicleType): number {
  const rounded = roundUpCost(blueprintCost)
  return vehicleType === VEHICLE_TYPES.PLANE ? Math.floor(rounded / 2) : rounded
}

export function autoKeywords(vehicleType: VehicleType): string[] {
  if (vehicleType === VEHICLE_TYPES.PLANE) return [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY]
  if (vehicleType === VEHICLE_TYPES.AIRSHIP) return [KEYWORDS.FRAGILE]
  return []
}

export function validateCustomCardInput(input: {
  name: string
  vehicleType: string
  blueprintCost: number
}): string[] {
  const errors: string[] = []
  const name = input.name.trim()
  if (name.length < 1 || name.length > 40) {
    errors.push('Name must be 1-40 characters')
  }
  if (!Object.values(VEHICLE_TYPES).includes(input.vehicleType as VehicleType)) {
    errors.push('Unknown vehicle type')
  }
  if (
    !Number.isInteger(input.blueprintCost) ||
    input.blueprintCost < 1 ||
    input.blueprintCost > MAX_CUSTOM_BLUEPRINT_COST
  ) {
    errors.push(`Blueprint cost must be a whole number between 1 and ${MAX_CUSTOM_BLUEPRINT_COST}`)
  }
  return errors
}
```

- [ ] **Step 4: Run `npm test`** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/ && git commit -m "feat(shared): custom card cost, keyword, and input rules"
```

---

### Task 4: `shared/engine/deckValidation.ts` (TDD)

**Files:**
- Create: `shared/engine/deckValidation.ts`
- Test: `shared/engine/deckValidation.test.ts`

**Interfaces:**
- Consumes: deck-rule constants, `FACTIONS`, `VEHICLE_TYPES` (Phase 1).
- Produces (Task 9 and later Phase 3 game-start validation import these exact names):

```ts
export interface DeckRules {
  deckSize: number; uniqueCopyLimit: number; playerCardLimit: number
  flierCopyLimit: number; subCopyLimit: number
}
export const DEFAULT_DECK_RULES: DeckRules
export interface DeckCardInfo {
  id: string; isBuiltIn: boolean; faction: string
  vehicleType: string | null; ownerId: string | null
}
export interface DeckValidationResult { valid: boolean; errors: string[]; cardCount: number }
export function validateDeck(
  deck: { faction: string; cards: Record<string, number> },
  cardInfo: Map<string, DeckCardInfo>,
  ownerId: string,
  rules?: DeckRules,
): DeckValidationResult
```

- [ ] **Step 1: Write failing tests** — `shared/engine/deckValidation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DeckCardInfo } from './deckValidation'
import { DEFAULT_DECK_RULES, validateDeck } from './deckValidation'

const ME = 'user-1'

function info(id: string, over: Partial<DeckCardInfo> = {}): [string, DeckCardInfo] {
  return [id, { id, isBuiltIn: true, faction: 'DWG', vehicleType: 'ship', ownerId: null, ...over }]
}

// 10 distinct DWG ships x2 copies = a legal 20-card deck
function legalCards(): Record<string, number> {
  const cards: Record<string, number> = {}
  for (let i = 0; i < 10; i++) cards[`dwg-${i}`] = 2
  return cards
}
function legalInfo(): Map<string, DeckCardInfo> {
  return new Map(Array.from({ length: 10 }, (_, i) => info(`dwg-${i}`)))
}

describe('validateDeck', () => {
  it('accepts a legal deck', () => {
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, legalInfo(), ME)
    expect(r).toEqual({ valid: true, errors: [], cardCount: 20 })
  })

  it('enforces exact deck size', () => {
    const cards = legalCards()
    delete cards['dwg-9']
    const r = validateDeck({ faction: 'DWG', cards }, legalInfo(), ME)
    expect(r.valid).toBe(false)
    expect(r.cardCount).toBe(18)
    expect(r.errors.join(' ')).toMatch(/20/)
  })

  it('enforces copy limit and rejects non-positive quantities', () => {
    const cards = legalCards()
    cards['dwg-0'] = 3
    expect(validateDeck({ faction: 'DWG', cards }, legalInfo(), ME).valid).toBe(false)
    cards['dwg-0'] = 0
    expect(validateDeck({ faction: 'DWG', cards }, legalInfo(), ME).valid).toBe(false)
  })

  it('rejects unknown card ids', () => {
    const cards = { ...legalCards(), ghost: 1 }
    const r = validateDeck({ faction: 'DWG', cards }, legalInfo(), ME)
    expect(r.errors.some((e) => e.includes('ghost'))).toBe(true)
  })

  it('rejects off-faction built-ins but allows NEUTRAL', () => {
    const infoMap = legalInfo()
    infoMap.set(...info('dwg-0', { faction: 'SS' }))
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME).valid).toBe(false)
    infoMap.set(...info('dwg-0', { faction: 'NEUTRAL' }))
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME).valid).toBe(true)
  })

  it('limits custom cards to playerCardLimit total copies and requires ownership', () => {
    const infoMap = legalInfo()
    // dwg-0..dwg-2 become my custom cards: 3 ids x2 copies = 6 > limit of 4
    for (let i = 0; i < 3; i++) {
      infoMap.set(...info(`dwg-${i}`, { isBuiltIn: false, faction: 'NEUTRAL', ownerId: ME }))
    }
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME).valid).toBe(false)
    // exactly 4 custom copies is fine (2 ids x2)
    const infoMap2 = legalInfo()
    for (let i = 0; i < 2; i++) {
      infoMap2.set(...info(`dwg-${i}`, { isBuiltIn: false, faction: 'NEUTRAL', ownerId: ME }))
    }
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap2, ME).valid).toBe(true)
    // someone else's custom card is rejected
    const infoMap3 = legalInfo()
    infoMap3.set(...info('dwg-0', { isBuiltIn: false, faction: 'NEUTRAL', ownerId: 'user-2' }))
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap3, ME).valid).toBe(false)
  })

  it('caps flier (plane+airship) and sub copies at their limits', () => {
    const infoMap = legalInfo()
    for (let i = 0; i < 4; i++) infoMap.set(...info(`dwg-${i}`, { vehicleType: i < 2 ? 'plane' : 'airship' }))
    // 4 ids x2 = 8 flier copies > 6
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME).valid).toBe(false)
    const infoMap2 = legalInfo()
    for (let i = 0; i < 4; i++) infoMap2.set(...info(`dwg-${i}`, { vehicleType: 'sub' }))
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap2, ME).valid).toBe(false)
    const infoMap3 = legalInfo()
    for (let i = 0; i < 3; i++) infoMap3.set(...info(`dwg-${i}`, { vehicleType: 'plane' }))
    // 3 ids x2 = 6 flier copies = exactly the limit
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap3, ME).valid).toBe(true)
  })

  it('respects overridden rules', () => {
    const rules = { ...DEFAULT_DECK_RULES, deckSize: 2, uniqueCopyLimit: 2 }
    const r = validateDeck({ faction: 'DWG', cards: { 'dwg-0': 2 } }, legalInfo(), ME, rules)
    expect(r.valid).toBe(true)
  })
})
```

- [ ] **Step 2: Run `npm test`** — expect FAIL (module not found).

- [ ] **Step 3: Implement** — `shared/engine/deckValidation.ts`:

```ts
import {
  DECK_SIZE, FACTIONS, FLIER_COPY_LIMIT, PLAYER_CARD_LIMIT, SUB_COPY_LIMIT,
  UNIQUE_COPY_LIMIT, VEHICLE_TYPES,
} from '../gameSettings.ts'

export interface DeckRules {
  deckSize: number
  uniqueCopyLimit: number
  playerCardLimit: number
  flierCopyLimit: number
  subCopyLimit: number
}

export const DEFAULT_DECK_RULES: DeckRules = {
  deckSize: DECK_SIZE,
  uniqueCopyLimit: UNIQUE_COPY_LIMIT,
  playerCardLimit: PLAYER_CARD_LIMIT,
  flierCopyLimit: FLIER_COPY_LIMIT,
  subCopyLimit: SUB_COPY_LIMIT,
}

export interface DeckCardInfo {
  id: string
  isBuiltIn: boolean
  faction: string
  vehicleType: string | null
  ownerId: string | null
}

export interface DeckValidationResult {
  valid: boolean
  errors: string[]
  cardCount: number
}

export function validateDeck(
  deck: { faction: string; cards: Record<string, number> },
  cardInfo: Map<string, DeckCardInfo>,
  ownerId: string,
  rules: DeckRules = DEFAULT_DECK_RULES,
): DeckValidationResult {
  const errors: string[] = []
  let cardCount = 0
  let customCopies = 0
  let flierCopies = 0
  let subCopies = 0

  for (const [cardId, qty] of Object.entries(deck.cards)) {
    if (!Number.isInteger(qty) || qty < 1) {
      errors.push(`Card ${cardId} has an invalid quantity (${qty})`)
      continue
    }
    cardCount += qty
    if (qty > rules.uniqueCopyLimit) {
      errors.push(`Card ${cardId}: max ${rules.uniqueCopyLimit} copies allowed (${qty} present)`)
    }
    const card = cardInfo.get(cardId)
    if (!card) {
      errors.push(`Unknown card id: ${cardId}`)
      continue
    }
    if (card.isBuiltIn) {
      if (card.faction !== deck.faction && card.faction !== FACTIONS.NEUTRAL) {
        errors.push(`${cardId} is a ${card.faction} card; this deck is ${deck.faction}`)
      }
    } else {
      customCopies += qty
      if (card.ownerId !== ownerId) {
        errors.push(`${cardId} is another player's custom card`)
      }
    }
    if (card.vehicleType === VEHICLE_TYPES.PLANE || card.vehicleType === VEHICLE_TYPES.AIRSHIP) {
      flierCopies += qty
    }
    if (card.vehicleType === VEHICLE_TYPES.SUB) {
      subCopies += qty
    }
  }

  if (cardCount !== rules.deckSize) {
    errors.push(`Deck must contain exactly ${rules.deckSize} cards (currently ${cardCount})`)
  }
  if (customCopies > rules.playerCardLimit) {
    errors.push(`Max ${rules.playerCardLimit} custom card copies allowed (${customCopies} present)`)
  }
  if (flierCopies > rules.flierCopyLimit) {
    errors.push(`Max ${rules.flierCopyLimit} flier copies allowed (${flierCopies} present)`)
  }
  if (subCopies > rules.subCopyLimit) {
    errors.push(`Max ${rules.subCopyLimit} submarine copies allowed (${subCopies} present)`)
  }

  return { valid: errors.length === 0, errors, cardCount }
}
```

- [ ] **Step 4: Run `npm test`** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/engine/ && git commit -m "feat(shared): deck validation engine"
```

---

### Task 5: `create-card` edge function — sync, implement, deploy, verify

**Files:**
- Create: `scripts/sync-function-shared.mjs`, `supabase/functions/create-card/index.ts`, `supabase/functions/create-card/shared/` (synced copies of `gameSettings.ts`, `types.ts`, `customCards.ts`)
- Test: `supabase/seed/functionSharedSync.test.ts` (drift guard; lives with the other root-run tests)
- Modify: root `package.json` (add script)

**Interfaces:**
- Consumes: Task 3 functions.
- Produces: deployed function `create-card` accepting POST **multipart form data** with fields `name`, `vehicleType`, `blueprintCost`, and optional file field `image`, authenticated by the caller's JWT; returns `201 {"card": <row>}` or `400 {"errors": [...]}` / `401 {"errors": [...]}`. The function uploads the image itself (service role) to `card-images/{userId}/{uuid}.{ext}`. Task 7 invokes it via `supabase.functions.invoke('create-card', { body: formData })` — note supabase-js surfaces non-2xx as a thrown `FunctionsHttpError` whose body is only reachable via `error.context.json()`.

- [ ] **Step 1: Sync script** — `scripts/sync-function-shared.mjs`:

```js
// Copies the shared modules the create-card function needs into the function
// directory (Deno deploys can't reach outside it). Run: npm run functions:sync
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'supabase', 'functions', 'create-card', 'shared')
mkdirSync(dest, { recursive: true })
for (const f of ['gameSettings.ts', 'types.ts', 'customCards.ts']) {
  copyFileSync(join(root, 'shared', f), join(dest, f))
  console.log(`synced shared/${f}`)
}
```

Add to root `package.json` scripts: `"functions:sync": "node scripts/sync-function-shared.mjs"`.

- [ ] **Step 2: Drift-guard test (write first, RED)** — `supabase/seed/functionSharedSync.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('function shared-module sync', () => {
  for (const f of ['gameSettings.ts', 'types.ts', 'customCards.ts']) {
    it(`supabase/functions/create-card/shared/${f} matches shared/${f}`, () => {
      const source = readFileSync(join(ROOT, 'shared', f), 'utf8')
      const synced = readFileSync(
        join(ROOT, 'supabase', 'functions', 'create-card', 'shared', f),
        'utf8',
      )
      expect(synced).toBe(source)
    })
  }
})
```

Run `npm test` → these 3 FAIL (files missing). Run `npm run functions:sync` → re-run → PASS.

- [ ] **Step 3: Function** — `supabase/functions/create-card/index.ts` (check Context7 for current Deno/edge patterns first):

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { autoKeywords, computeMaterialCost, validateCustomCardInput } from './shared/customCards.ts'
import { CARD_IMAGE_MAX_BYTES, CARD_IMAGE_MIME_TYPES } from './shared/gameSettings.ts'
import type { VehicleType } from './shared/types.ts'

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

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(400, { errors: ['Body must be multipart form data'] })
  }

  const input = {
    name: String(form.get('name') ?? '').trim(),
    vehicleType: String(form.get('vehicleType') ?? ''),
    blueprintCost: Number(form.get('blueprintCost') ?? NaN),
  }
  const errors = validateCustomCardInput(input)

  const image = form.get('image')
  if (image !== null && !(image instanceof File)) errors.push('image must be a file')
  if (image instanceof File) {
    if (!(CARD_IMAGE_MIME_TYPES as readonly string[]).includes(image.type)) {
      errors.push('Image must be JPEG, PNG, or WebP')
    }
    if (image.size > CARD_IMAGE_MAX_BYTES) errors.push('Image must be under 2 MB')
  }
  if (errors.length > 0) return json(400, { errors })

  const admin = createClient(supabaseUrl, serviceKey)
  let imageUrl = ''
  if (image instanceof File) {
    const ext = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${userId}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await admin.storage
      .from('card-images')
      .upload(path, image, { contentType: image.type })
    if (uploadError) return json(500, { errors: [`Image upload failed: ${uploadError.message}`] })
    imageUrl = admin.storage.from('card-images').getPublicUrl(path).data.publicUrl
  }

  const vehicleType = input.vehicleType as VehicleType
  const { data: card, error: insertError } = await admin
    .from('cards')
    .insert({
      id: crypto.randomUUID(),
      name: input.name,
      is_built_in: false,
      owner_id: userId,
      faction: 'NEUTRAL',
      type: 'vehicle',
      vehicle_type: vehicleType,
      blueprint_cost: input.blueprintCost,
      material_cost: computeMaterialCost(input.blueprintCost, vehicleType),
      cp_cost: 0,
      card_text: '',
      image_url: imageUrl,
      keywords: autoKeywords(vehicleType),
      meta: {},
    })
    .select()
    .single()
  if (insertError) return json(500, { errors: [insertError.message] })
  return json(201, { card })
})
```

- [ ] **Step 4: Deploy** — first re-run `npm run functions:sync && npm test` (deploys can never ship stale copies). Then MCP `deploy_edge_function`: name `create-card`, entrypoint `index.ts`, **`verify_jwt: false`** (the function does its own `getUser()` auth, must serve CORS preflight, and gateway verification breaks with new-style publishable keys), files: `index.ts` plus the three copies named `shared/gameSettings.ts`, `shared/types.ts`, `shared/customCards.ts` (exact repo content). Contingency: if the tool rejects subfolder file names, flatten the copies into the function root, adjust `index.ts` imports and the drift-test paths to match, and re-sync.

- [ ] **Step 5: Verify headlessly** — throwaway script in the scratchpad (NOT the repo), using the URL + publishable key from `frontend/.env.local` (Node 20 has global `FormData`/`File`):
  1. Sign up user `jacob.finn+ftdtest2@streetfeastapp.com`, password `FtdPhase2Test!2026` (fixed on purpose — Task 10 signs in with it; disposable test credential), username `test_shipwright`. Confirm via `execute_sql`: `update auth.users set email_confirmed_at = now() where email = 'jacob.finn+ftdtest2@streetfeastapp.com';` then sign in.
  2. Positive: invoke with FormData {name: 'Verify Boat', vehicleType: 'ship', blueprintCost: 42001} → 201 card with `material_cost` 45000, faction NEUTRAL, `owner_id` = user. Then {name: 'Verify Plane', vehicleType: 'plane', blueprintCost: 40205} → `material_cost` 22500, keywords `['halfCost','temporary']`.
  3. Negative: blueprintCost 0 → error is a `FunctionsHttpError`; read `await error.context.json()` → `{errors: [...]}` with status 400. Signed-out client → 401 the same way (with `verify_jwt: false` the 401 comes from the function's own `getUser()` check, body `{errors: ['Not signed in']}`).
  4. If any call 500s with 'Server misconfigured', the legacy `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` env vars aren't injected (project may have legacy API keys disabled) — report BLOCKED with that finding; the controller decides between enabling legacy keys or switching the function to `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS` parsing.
  5. Clean up: `execute_sql` — `delete from public.cards where is_built_in = false and name in ('Verify Boat','Verify Plane');`

- [ ] **Step 6: Commit**

```bash
git add scripts/ supabase/functions/ supabase/seed/functionSharedSync.test.ts package.json && git commit -m "feat(functions): create-card edge function with shared rule sync"
```

---

### Task 6: Frontend — card visuals and `/cards` browser

**Files:**
- Create: `shared/format.ts`, `shared/format.test.ts`, `frontend/src/components/PhysicalCard.tsx`, `frontend/src/components/KeywordIcons.tsx`, `frontend/src/lib/cards.ts`, `frontend/src/pages/CardsPage.tsx`
- Modify: `frontend/src/App.tsx` (route `/cards`), `frontend/src/components/NavBar.tsx` (add "Cards" link)

**Interfaces:**
- Consumes: `Database` types, Phase 1 icon SVGs (`frontend/src/assets/icons/`).
- Produces: `shortHandNumber(n: number): string` (shared); `CardRow` type = `Database['public']['Tables']['cards']['Row']` exported from `frontend/src/lib/cards.ts` along with `useCardsQuery()` (fetches all cards once, cached) and `cardImageOrFallback(card): { src: string; isFallback: boolean }`; `<PhysicalCard card={CardRow} onClick? />` (280×430 layout). Tasks 7 and 9 reuse ALL of these.

- [ ] **Step 1: `shortHandNumber` TDD.** `shared/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { shortHandNumber } from './format'

describe('shortHandNumber', () => {
  it('formats like the old FE', () => {
    expect(shortHandNumber(999)).toBe('999')
    expect(shortHandNumber(42_000)).toBe('42k')
    expect(shortHandNumber(45_500)).toBe('45.5k')
    expect(shortHandNumber(1_000_000)).toBe('1.00 M')
    expect(shortHandNumber(1_200_000)).toBe('1.20 M')
    expect(shortHandNumber(0)).toBe('0')
  })
})
```

RED → implement `shared/format.ts`:

```ts
export function shortHandNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`
  if (n >= 1_000) {
    const k = n / 1_000
    return Number.isInteger(k) ? `${k}k` : `${parseFloat(k.toFixed(1))}k`
  }
  return String(n)
}
```

→ GREEN.

- [ ] **Step 2: Card data hooks** — `frontend/src/lib/cards.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'

import shipIcon from '../assets/icons/shipSVG.svg'
import planeIcon from '../assets/icons/planeSVG.svg'
import subIcon from '../assets/icons/submarineSVG.svg'
import tankIcon from '../assets/icons/tankSVG.svg'
import airshipIcon from '../assets/icons/airShield1SVG.svg'
import anchorIcon from '../assets/icons/anchorSVG.svg'

export type CardRow = Database['public']['Tables']['cards']['Row']

export function useCardsQuery() {
  return useQuery({
    queryKey: ['cards'],
    queryFn: async (): Promise<CardRow[]> => {
      const { data, error } = await supabase.from('cards').select('*').order('material_cost')
      if (error) throw error
      return data
    },
    staleTime: 5 * 60 * 1000,
  })
}

const FALLBACKS: Record<string, string> = {
  ship: shipIcon, plane: planeIcon, sub: subIcon, tank: tankIcon, airship: airshipIcon,
}

// Built-in image_urls are bare filenames with no hosted art; only real URLs
// render (blob: covers the create-card local preview).
export function cardImageOrFallback(card: CardRow): { src: string; isFallback: boolean } {
  if (card.image_url.startsWith('http') || card.image_url.startsWith('blob:')) {
    return { src: card.image_url, isFallback: false }
  }
  return { src: FALLBACKS[card.vehicle_type ?? ''] ?? anchorIcon, isFallback: true }
}
```

- [ ] **Step 3: Keyword icons** — `frontend/src/components/KeywordIcons.tsx`: map keyword string → icon + tooltip title, rendering a row. Use: blocker→`shieldSVG`, scrappy→`repairSVG`, temporary→`hourglassSVG`, airScreen→`noFlyZoneSVG`, subScreen→`noSubsSVG`, halfCost→`sparkSVG`, mobile→`tireSVG`, stealthy→`crosshairSVG`, robotic→`tire2SVG`, fragile→`torpedoSVG`, inoffensive→`airportSVG`. Unknown keywords render as a small text chip. Each icon 24×24 with `title={keyword}`.

```tsx
import shield from '../assets/icons/shieldSVG.svg'
import repair from '../assets/icons/repairSVG.svg'
import hourglass from '../assets/icons/hourglassSVG.svg'
import noFly from '../assets/icons/noFlyZoneSVG.svg'
import noSubs from '../assets/icons/noSubsSVG.svg'
import spark from '../assets/icons/sparkSVG.svg'
import tire from '../assets/icons/tireSVG.svg'
import tire2 from '../assets/icons/tire2SVG.svg'
import crosshair from '../assets/icons/crosshairSVG.svg'
import torpedo from '../assets/icons/torpedoSVG.svg'
import airport from '../assets/icons/airportSVG.svg'

const ICONS: Record<string, string> = {
  blocker: shield, scrappy: repair, temporary: hourglass, airScreen: noFly,
  subScreen: noSubs, halfCost: spark, mobile: tire, robotic: tire2,
  stealthy: crosshair, fragile: torpedo, inoffensive: airport,
}

export function KeywordIcons({ keywords }: { keywords: string[] }) {
  if (keywords.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {keywords.map((k) =>
        ICONS[k] ? (
          <img key={k} src={ICONS[k]} alt={k} title={k} className="h-6 w-6" />
        ) : (
          <span key={k} title={k} className="rounded bg-ocean-600 px-1 text-xs">{k}</span>
        ),
      )}
    </div>
  )
}
```

- [ ] **Step 4: PhysicalCard** — `frontend/src/components/PhysicalCard.tsx` (280×430 parchment card per spec §7):

```tsx
import { shortHandNumber } from '@shared/format'
import type { CardRow } from '../lib/cards'
import { cardImageOrFallback } from '../lib/cards'
import { KeywordIcons } from './KeywordIcons'

export function PhysicalCard({ card, onClick }: { card: CardRow; onClick?: () => void }) {
  const img = cardImageOrFallback(card)
  const keywords = Array.isArray(card.keywords) ? (card.keywords as string[]) : []
  return (
    <div
      onClick={onClick}
      className={`flex h-[430px] w-[280px] flex-col rounded-xl border-2 border-ocean-950 bg-parchment-100 p-3 text-ocean-950 shadow-plank ${onClick ? 'cursor-pointer transition-transform hover:-translate-y-1' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-display text-lg" title={card.name}>{card.name}</span>
        <span className="text-xs uppercase text-ocean-600">{card.vehicle_type ?? card.type}</span>
      </div>
      <div className="mt-2 flex h-[180px] items-center justify-center overflow-hidden rounded bg-parchment-300 shadow-inner">
        <img
          src={img.src}
          alt={card.name}
          className={img.isFallback ? 'h-24 w-24 opacity-60' : 'h-full w-full object-cover'}
        />
      </div>
      <p className="mt-2 flex-1 overflow-y-auto text-sm leading-snug">{card.card_text}</p>
      <div className="mt-2 flex items-end justify-between">
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-ocean-900 px-3 py-1 font-bold text-parchment-100">
            {shortHandNumber(card.material_cost)}
          </span>
          {card.cp_cost > 0 && (
            <span className="rounded-full bg-brass-400 px-2 py-1 text-sm font-bold text-ocean-950">
              {card.cp_cost} CP
            </span>
          )}
        </span>
        <KeywordIcons keywords={keywords} />
      </div>
      <div className="mt-1 text-right text-xs text-ocean-600">
        {card.is_built_in ? card.faction : 'CUSTOM'}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: CardsPage** — `frontend/src/pages/CardsPage.tsx`: tab strip of the factions present in the data (sorted, from `useCardsQuery()`) plus a **Custom** tab (all `is_built_in === false` cards — spec §3.10 makes them public); grid of `PhysicalCard`s (`flex flex-wrap gap-6 justify-center`); a "Create custom card" button linking to `/cards/new` (page arrives in Task 7 — use `<Link>`; the dead route 404s harmlessly for one task). Loading and error states via the query.

```tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PhysicalCard } from '../components/PhysicalCard'
import { useCardsQuery } from '../lib/cards'

export function CardsPage() {
  const { data: cards, isLoading, error } = useCardsQuery()
  const factions = useMemo(
    () => [...new Set((cards ?? []).filter((c) => c.is_built_in).map((c) => c.faction))].sort(),
    [cards],
  )
  const [tab, setTab] = useState<string | null>(null)
  const active = tab ?? factions[0] ?? null

  if (isLoading) return <main className="p-8 text-center">Loading cards…</main>
  if (error) return <main className="p-8 text-center text-red-400">Failed to load cards: {String(error)}</main>

  const shown = (cards ?? []).filter((c) =>
    active === 'CUSTOM' ? !c.is_built_in : c.is_built_in && c.faction === active,
  )
  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="flex flex-wrap items-center gap-2">
        {[...factions, 'CUSTOM'].map((f) => (
          <button
            key={f}
            onClick={() => setTab(f)}
            className={`rounded px-3 py-1 font-bold ${active === f ? 'bg-brass-400 text-ocean-950' : 'bg-ocean-900 text-parchment-100'}`}
          >
            {f}
          </button>
        ))}
        <Link to="/cards/new" className="ml-auto rounded bg-brass-400 px-3 py-1 font-bold text-ocean-950">
          + Create custom card
        </Link>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-6">
        {shown.map((c) => <PhysicalCard key={c.id} card={c} />)}
        {shown.length === 0 && <p className="text-ocean-300">No cards here yet.</p>}
      </div>
    </main>
  )
}
```

- [ ] **Step 6: Wire route + nav.** `App.tsx`: `<Route path="/cards" element={<RequireAuth><CardsPage /></RequireAuth>} />`. `NavBar.tsx`: inside the existing `<nav className="ml-auto flex items-center gap-4">`, immediately BEFORE `{right}`, add `<Link to="/cards" className="text-parchment-100 hover:text-brass-400">Cards</Link>` (Task 8 adds the Decks link the same way, before the Cards link's sibling `{right}`).

- [ ] **Step 7: Verify** — `npm test` (root) passes; `cd frontend && npm run build` clean; dev-server visual check of `/cards` if the browser pane is available to you, otherwise note it for the controller.

- [ ] **Step 8: Commit**

```bash
git add shared/format.ts shared/format.test.ts frontend/ && git commit -m "feat(frontend): card visuals and faction card browser"
```

---

### Task 7: Frontend — create custom card page

**Files:**
- Create: `frontend/src/pages/CreateCardPage.tsx`
- Modify: `frontend/src/App.tsx` (route `/cards/new`)

**Interfaces:**
- Consumes: Task 3 shared functions (`@shared/customCards`), Task 5 function, Task 6 `PhysicalCard`, `CARD_IMAGE_MAX_BYTES`/`CARD_IMAGE_MIME_TYPES` from `@shared/gameSettings`.
- Produces: working `/cards/new`.

- [ ] **Step 1: Page** — `frontend/src/pages/CreateCardPage.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { CARD_IMAGE_MAX_BYTES, CARD_IMAGE_MIME_TYPES, VEHICLE_TYPES } from '@shared/gameSettings'
import { autoKeywords, computeMaterialCost, validateCustomCardInput } from '@shared/customCards'
import type { VehicleType } from '@shared/types'
import { PhysicalCard } from '../components/PhysicalCard'
import type { CardRow } from '../lib/cards'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

export function CreateCardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const [name, setName] = useState('')
  const [vehicleType, setVehicleType] = useState<VehicleType>('ship')
  const [blueprintCost, setBlueprintCost] = useState(50000)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const inputErrors = validateCustomCardInput({ name, vehicleType, blueprintCost })
  const preview = useMemo<CardRow>(() => ({
    id: 'preview', name: name || 'Unnamed', is_built_in: false, owner_id: session?.user.id ?? null,
    faction: 'NEUTRAL', type: 'vehicle', vehicle_type: vehicleType,
    blueprint_cost: blueprintCost,
    material_cost: inputErrors.length === 0 ? computeMaterialCost(blueprintCost, vehicleType) : 0,
    cp_cost: 0, card_text: '', image_url: imageFile ? URL.createObjectURL(imageFile) : '',
    keywords: autoKeywords(vehicleType), meta: {}, created_at: '',
  }), [name, vehicleType, blueprintCost, imageFile, inputErrors.length, session])

  function onPickFile(f: File | null) {
    if (!f) return setImageFile(null)
    if (!(CARD_IMAGE_MIME_TYPES as readonly string[]).includes(f.type)) {
      setErrors(['Image must be JPEG, PNG, or WebP']); return
    }
    if (f.size > CARD_IMAGE_MAX_BYTES) {
      setErrors([`Image must be under ${Math.round(CARD_IMAGE_MAX_BYTES / 1024 / 1024)} MB`]); return
    }
    setErrors([]); setImageFile(f)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inputErrors.length > 0) { setErrors(inputErrors); return }
    setBusy(true); setErrors([])
    try {
      const form = new FormData()
      form.append('name', name.trim())
      form.append('vehicleType', vehicleType)
      form.append('blueprintCost', String(blueprintCost))
      if (imageFile) form.append('image', imageFile)
      const { error } = await supabase.functions.invoke('create-card', { body: form })
      if (error) {
        // supabase-js wraps non-2xx responses; the function's {errors} body
        // is only reachable through error.context.
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => null)
          if (body?.errors) { setErrors(body.errors); return }
        }
        throw error
      }
      await queryClient.invalidateQueries({ queryKey: ['cards'] })
      navigate('/cards')
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-wrap justify-center gap-10 p-6">
      <form onSubmit={onSubmit} className="flex w-80 flex-col gap-3">
        <h1 className="font-display text-3xl">Design a vehicle</h1>
        <input className="rounded bg-ocean-900 p-2" placeholder="Vehicle name" value={name}
          onChange={(e) => setName(e.target.value)} />
        <select className="rounded bg-ocean-900 p-2" value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}>
          {Object.values(VEHICLE_TYPES).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <label className="text-sm text-ocean-300">
          Blueprint cost (from FTD)
          <input type="number" className="mt-1 w-full rounded bg-ocean-900 p-2" value={blueprintCost}
            onChange={(e) => setBlueprintCost(Number(e.target.value))} />
        </label>
        <label className="text-sm text-ocean-300">
          Card image (optional, 2 MB max)
          <input type="file" accept={CARD_IMAGE_MIME_TYPES.join(',')} className="mt-1 w-full"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
        </label>
        {vehicleType === 'plane' && (
          <p className="text-sm text-ocean-300">Planes cost half materials but are Temporary.</p>
        )}
        {errors.map((err) => <p key={err} className="text-red-400">{err}</p>)}
        <button disabled={busy || inputErrors.length > 0}
          className="rounded bg-brass-400 p-2 font-bold text-ocean-950 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create card'}
        </button>
      </form>
      <div>
        <p className="mb-2 text-center text-sm text-ocean-300">Preview</p>
        <PhysicalCard card={preview} />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Route** — `App.tsx`: `<Route path="/cards/new" element={<RequireAuth><CreateCardPage /></RequireAuth>} />`.

- [ ] **Step 3: Verify** — `cd frontend && npm run build` clean. If the preview typing fights the generated `CardRow` (jsonb fields type as `Json`), cast at the preview object only (`keywords: autoKeywords(vehicleType) as CardRow['keywords']`) — do not weaken `CardRow` itself.

- [ ] **Step 4: Commit**

```bash
git add frontend/ && git commit -m "feat(frontend): custom card creation with image upload and live preview"
```

---

### Task 8: Frontend — decks list page

**Files:**
- Create: `frontend/src/lib/decks.ts`, `frontend/src/pages/DecksPage.tsx`
- Modify: `frontend/src/App.tsx` (route `/decks`), `frontend/src/components/NavBar.tsx` ("Decks" link)

**Interfaces:**
- Consumes: `decks` table (Task 2), `DECK_FACTIONS` from `@shared/gameSettings`.
- Produces: `DeckRow` type and `useDecksQuery()` in `frontend/src/lib/decks.ts` (Task 9 reuses); `/decks` page listing own decks with create + delete.

- [ ] **Step 1: Deck hooks** — `frontend/src/lib/decks.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'

export type DeckRow = Database['public']['Tables']['decks']['Row']

export function useDecksQuery() {
  return useQuery({
    queryKey: ['decks'],
    queryFn: async (): Promise<DeckRow[]> => {
      const { data, error } = await supabase.from('decks').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function deckCardCount(deck: DeckRow): number {
  const cards = (deck.cards ?? {}) as Record<string, number>
  return Object.values(cards).reduce((a, b) => a + b, 0)
}
```

- [ ] **Step 2: DecksPage** — `frontend/src/pages/DecksPage.tsx`: list from `useDecksQuery()` (name, faction badge, `deckCardCount`/`DECK_SIZE`, updated date), each linking to `/decks/:id`; inline create form (name input + faction `<select>` over `DECK_FACTIONS`) inserting `{ owner_id: session.user.id, name, faction }` then navigating to the new deck's builder; delete button per deck with `window.confirm`, then delete + invalidate `['decks']`. Handle loading/error/empty ("No fleets yet — build one").

```tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DECK_FACTIONS, DECK_SIZE } from '@shared/gameSettings'
import { deckCardCount, useDecksQuery } from '../lib/decks'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

export function DecksPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: decks, isLoading, error } = useDecksQuery()
  const [name, setName] = useState('')
  const [faction, setFaction] = useState<string>(DECK_FACTIONS[0])
  const [formError, setFormError] = useState<string | null>(null)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!session) return
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 40) { setFormError('Name must be 1-40 characters'); return }
    const { data, error: insertError } = await supabase
      .from('decks')
      .insert({ owner_id: session.user.id, name: trimmed, faction })
      .select()
      .single()
    if (insertError) { setFormError(insertError.message); return }
    await queryClient.invalidateQueries({ queryKey: ['decks'] })
    navigate(`/decks/${data.id}`)
  }

  async function onDelete(id: string, deckName: string) {
    if (!window.confirm(`Scuttle deck "${deckName}"? This cannot be undone.`)) return
    const { error: deleteError } = await supabase.from('decks').delete().eq('id', id)
    if (deleteError) { setFormError(deleteError.message); return }
    await queryClient.invalidateQueries({ queryKey: ['decks'] })
  }

  if (isLoading) return <main className="p-8 text-center">Loading decks…</main>
  if (error) return <main className="p-8 text-center text-red-400">Failed to load decks: {String(error)}</main>

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl">Your fleets</h1>
      <form onSubmit={onCreate} className="mt-4 flex flex-wrap items-center gap-2">
        <input className="rounded bg-ocean-900 p-2" placeholder="New deck name" value={name}
          onChange={(e) => setName(e.target.value)} />
        <select className="rounded bg-ocean-900 p-2" value={faction}
          onChange={(e) => setFaction(e.target.value)}>
          {DECK_FACTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button className="rounded bg-brass-400 px-3 py-2 font-bold text-ocean-950">Create</button>
        {formError && <p className="text-red-400">{formError}</p>}
      </form>
      <ul className="mt-6 flex flex-col gap-3">
        {(decks ?? []).map((d) => (
          <li key={d.id} className="flex items-center gap-4 rounded border border-ocean-600 bg-ocean-900/60 p-4">
            <Link to={`/decks/${d.id}`} className="flex-1">
              <span className="font-display text-xl">{d.name}</span>
              <span className="ml-3 rounded bg-ocean-600 px-2 py-0.5 text-sm">{d.faction}</span>
              <span className="ml-3 text-ocean-300">{deckCardCount(d)}/{DECK_SIZE} cards</span>
            </Link>
            <button onClick={() => onDelete(d.id, d.name)} className="text-red-400 underline">Delete</button>
          </li>
        ))}
        {(decks ?? []).length === 0 && <p className="text-ocean-300">No fleets yet — build one above.</p>}
      </ul>
    </main>
  )
}
```

- [ ] **Step 3: Route + nav** — `App.tsx` route `/decks` behind RequireAuth; NavBar link "Decks" beside "Cards".

- [ ] **Step 4: Verify** — `cd frontend && npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/ && git commit -m "feat(frontend): deck list with create and delete"
```

---

### Task 9: Frontend — deck builder with live validation

**Files:**
- Create: `frontend/src/pages/DeckBuilderPage.tsx`
- Modify: `frontend/src/App.tsx` (route `/decks/:id`)

**Interfaces:**
- Consumes: `useCardsQuery`/`CardRow`/`PhysicalCard` (Task 6), `useDecksQuery`/`DeckRow` (Task 8), `validateDeck`/`DEFAULT_DECK_RULES`/`DeckCardInfo` (Task 4), `FACTIONS`, hero_powers table.
- Produces: working `/decks/:id`.

Behavior (spec §7): pool = built-ins of the deck's faction + NEUTRAL + the signed-in player's custom cards (other factions and other players' customs never shown; the 4 TG cards therefore never appear — expected). Deck panel lists entries with qty steppers; the steppers deliberately do NOT hard-block at limits — the live validation banner from `validateDeck` reports every violation, keeping all rule enforcement in one place. Decks MAY be saved invalid (drafts); validity is enforced at game start in Phase 3, so the banner informs, never blocks saving. Hero powers sidebar: rows from `hero_powers` where faction is NEUTRAL or the deck faction. Save button upserts `{ name, cards }` and invalidates `['decks']`.

- [ ] **Step 1: Page** — `frontend/src/pages/DeckBuilderPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FACTIONS } from '@shared/gameSettings'
import type { DeckCardInfo } from '@shared/engine/deckValidation'
import { validateDeck } from '@shared/engine/deckValidation'
import { shortHandNumber } from '@shared/format'
import { PhysicalCard } from '../components/PhysicalCard'
import { useCardsQuery } from '../lib/cards'
import { useDecksQuery } from '../lib/decks'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

export function DeckBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const { data: allCards } = useCardsQuery()
  const { data: decks } = useDecksQuery()
  const deck = decks?.find((d) => d.id === id)

  const [cards, setCards] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Reset local edits only when a DIFFERENT deck loads — keying on the row
  // object would clobber in-progress edits when a save's refetch returns a
  // new object identity (updated_at changes).
  useEffect(() => {
    if (deck) {
      setCards((deck.cards ?? {}) as Record<string, number>)
      setName(deck.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck?.id])

  const { data: heroPowers } = useQuery({
    queryKey: ['heroPowers', deck?.faction],
    enabled: !!deck,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hero_powers').select('*')
        .in('faction', [FACTIONS.NEUTRAL, deck!.faction])
      if (error) throw error
      return data
    },
  })

  const pool = useMemo(
    () =>
      (allCards ?? []).filter((c) =>
        c.is_built_in
          ? c.faction === deck?.faction || c.faction === FACTIONS.NEUTRAL
          : c.owner_id === session?.user.id,
      ),
    [allCards, deck, session],
  )

  const validation = useMemo(() => {
    if (!deck || !allCards || !session) return null
    const infoMap = new Map<string, DeckCardInfo>(
      allCards.map((c) => [c.id, {
        id: c.id, isBuiltIn: c.is_built_in, faction: c.faction,
        vehicleType: c.vehicle_type, ownerId: c.owner_id,
      }]),
    )
    return validateDeck({ faction: deck.faction, cards }, infoMap, session.user.id)
  }, [deck, allCards, session, cards])

  function add(cardId: string) {
    setCards((prev) => ({ ...prev, [cardId]: (prev[cardId] ?? 0) + 1 }))
    setSaveState('idle')
  }
  function remove(cardId: string) {
    setCards((prev) => {
      const next = { ...prev }
      if ((next[cardId] ?? 0) <= 1) delete next[cardId]
      else next[cardId] -= 1
      return next
    })
    setSaveState('idle')
  }

  async function onSave() {
    if (!deck) return
    setSaveState('saving'); setSaveError(null)
    const { error } = await supabase.from('decks')
      .update({ name: name.trim() || deck.name, cards })
      .eq('id', deck.id)
    if (error) { setSaveState('error'); setSaveError(error.message); return }
    await queryClient.invalidateQueries({ queryKey: ['decks'] })
    setSaveState('saved')
  }

  if (!deck) return <main className="p-8 text-center">Loading deck…</main>

  const cardById = new Map((allCards ?? []).map((c) => [c.id, c]))
  return (
    <main className="mx-auto flex max-w-[1600px] flex-wrap gap-6 p-6">
      <section className="min-w-[600px] flex-1">
        <h1 className="font-display text-2xl">{deck.faction} card pool</h1>
        <div className="mt-4 flex flex-wrap gap-4">
          {pool.map((c) => (
            <div key={c.id} className="scale-90 origin-top-left">
              <PhysicalCard card={c} onClick={() => add(c.id)} />
            </div>
          ))}
        </div>
      </section>
      <aside className="w-96">
        <input className="w-full rounded bg-ocean-900 p-2 font-display text-xl" value={name}
          onChange={(e) => { setName(e.target.value); setSaveState('idle') }} />
        {validation && (
          <div className={`mt-3 rounded p-3 ${validation.valid ? 'bg-green-900/60' : 'bg-ocean-900/80'}`}>
            <p className="font-bold">{validation.cardCount} cards — {validation.valid ? 'battle ready' : 'draft'}</p>
            <ul className="mt-1 list-inside list-disc text-sm text-ocean-300">
              {validation.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}
        <ul className="mt-3 flex flex-col gap-1">
          {Object.entries(cards).map(([cardId, qty]) => {
            const c = cardById.get(cardId)
            return (
              <li key={cardId} className="flex items-center gap-2 rounded bg-ocean-900/60 px-2 py-1">
                <span className="flex-1 truncate">{c?.name ?? cardId}</span>
                <span className="text-ocean-300">{c ? shortHandNumber(c.material_cost) : ''}</span>
                <button onClick={() => remove(cardId)} className="px-2">−</button>
                <span>{qty}</span>
                <button onClick={() => add(cardId)} className="px-2">+</button>
              </li>
            )
          })}
        </ul>
        <button onClick={onSave} disabled={saveState === 'saving'}
          className="mt-4 w-full rounded bg-brass-400 p-2 font-bold text-ocean-950 disabled:opacity-50">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save deck'}
        </button>
        {saveError && <p className="mt-2 text-red-400">{saveError}</p>}
        <h2 className="mt-6 font-display text-xl">Hero powers</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {(heroPowers ?? []).map((h) => (
            <li key={h.id} className="rounded border border-ocean-600 p-2">
              <span className="font-bold">{h.name}</span>
              <span className="ml-2 text-sm text-ocean-300">{h.cp_cost} CP</span>
              <p className="text-sm">{h.power_text}</p>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  )
}
```

- [ ] **Step 2: Route** — `App.tsx`: `<Route path="/decks/:id" element={<RequireAuth><DeckBuilderPage /></RequireAuth>} />`.

- [ ] **Step 3: Verify** — `cd frontend && npm run build` clean. Note: the qty "+" button intentionally allows exceeding limits (validation banner reports it) — the stepper does not hard-block, keeping rules changeable in one place.

- [ ] **Step 4: Commit**

```bash
git add frontend/ && git commit -m "feat(frontend): deck builder with faction pool and live validation"
```

---

### Task 10: Polish, E2E verification, push

**Files:**
- Modify: `frontend/src/lib/supabaseClient.ts` (env guard), `frontend/README.md` (replace boilerplate), `README.md` (Phase 2 notes)

- [ ] **Step 1: Env guard** — `frontend/src/lib/supabaseClient.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — copy frontend/.env.example to frontend/.env.local and fill in the values.',
  )
}

export const supabase = createClient<Database>(url, key)
```

- [ ] **Step 2: READMEs.** Replace `frontend/README.md` with:

```markdown
# FTD Card Game — frontend

Vite + React SPA. See the repo root README for setup; game rules live in
`../shared/` and the design spec in `../docs/superpowers/specs/`.
```

Root `README.md`: under Layout add `- \`supabase/functions/\` — edge functions (create-card); \`npm run functions:sync\` refreshes their shared-module copies`; under Tests note the drift-guard test.

- [ ] **Step 3: Headless E2E** (throwaway script in scratchpad, anon key): sign in as `jacob.finn+ftdtest2@streetfeastapp.com` / `FtdPhase2Test!2026` (created in Task 5). Then:
  1. Create a custom card via the function (FormData: name 'E2E Runabout', vehicleType 'ship', blueprintCost 30001) → material_cost 35000.
  2. Insert a deck (name 'E2E Fleet', faction 'DWG'); build `cards` = 9 built-in DWG cards **with `vehicle_type = 'ship'`** (query: `select id from cards where is_built_in and faction = 'DWG' and vehicle_type = 'ship' limit 9` via the signed-in client) at 2 copies each + the custom card at 2 copies = 20 total (ships only, so the flier/sub caps can't trip the assertion).
  3. Update the deck with those cards; read it back; run `validateDeck` locally (import from `shared/engine/deckValidation.ts`) → expect `valid: true`.
  4. RLS negative: a signed-OUT client selects `decks` → 0 rows.
  5. Clean up via `execute_sql`: delete the E2E deck row AND the custom card (`delete from public.decks where name = 'E2E Fleet'; delete from public.cards where is_built_in = false and name = 'E2E Runabout';`).

- [ ] **Step 4: Advisors sweep** — `get_advisors` security + performance; expect the two `handle_new_user` WARNs GONE (Task 1); no new criticals. Report remaining.

- [ ] **Step 5: Full gates** — root `npm test` all green; `cd frontend && npm run build` clean.

- [ ] **Step 6: Commit + report.** Commit the polish changes:

```bash
git add frontend/ README.md && git commit -m "chore: env guard, README refresh for phase 2"
```

Do NOT push — the controller merges and pushes in the finishing flow.

---

## Self-review notes (completed)

- Spec coverage: §3.10 (Tasks 3, 5, 7 — manual stats, rounding, auto-keywords, Storage upload, customs public + owner-usable), §4 decks + bucket (Task 2), §5 create-card (Task 5), §3.1 deck rules (Task 4), §7 pages/card visuals/faction pick/hero-power display (Tasks 6-9), Phase 1 deferred hardening (Task 1, 10). Deck-rule *overrides* (lobby settings) are consumed in Phase 3 — `validateDeck` takes a `rules` param now.
- Type consistency: `power_text` (Task 9 display) matches Phase 1 schema; `validateDeck` signature matches between Task 4 and Task 9; `CARD_IMAGE_*` constants defined Task 3, consumed Task 7; bucket path `{uid}/{uuid}.{ext}` matches the storage policy and the function's `allowedPrefix`.
- Placeholders: none; all code steps carry full content. KeywordIcons icon assignments are aesthetic choices, changeable freely.
- Decisions (recorded): decks are saveable as invalid drafts; legality is enforced at game start (Phase 3). Custom cards are faction NEUTRAL. Image upload flows through the create-card function (service role) because the MCP role cannot create storage.objects policies — verified live. Shared modules use explicit `.ts` relative imports for Deno compatibility. Function deploys with `verify_jwt: false` (does its own auth).
- This plan was adversarially verified by a 3-lens workflow (spec coverage, cross-code consistency, executability); all 3 blocking + 5 important + 10 minor findings were resolved or consciously accepted in this revision.
