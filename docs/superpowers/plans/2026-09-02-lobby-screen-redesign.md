# Lobby Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline lobby card with a StarCraft II-style `/lobby/:id` screen — visible seats, in-lobby deck choice, host-editable settings, a live board miniature, and both players auto-navigated onto the board when the host starts.

**Architecture:** Three layers, each independently testable. (1) Pure frontend modules — `lobbyVerdict`/`canStart`/`seatOf` and the shared biome colour maps — carry all the branching logic and are unit-tested with no network. (2) The `lobby-action` edge function gains four ops and tightens `START`'s atomic lock; a migration makes `host_deck_id` nullable and adds two ready flags. (3) The UI is a new route whose navigation is *derived* from the realtime lobby row through `lobbyVerdict`, so host and guest reach the board by the same path.

**Tech Stack:** React 19 + TypeScript strict, Vite, Tailwind v4, TanStack Query v5, react-router v7, Supabase (Postgres + Deno edge functions), vitest.

**Spec:** [docs/superpowers/specs/2026-09-02-lobby-screen-redesign-design.md](../specs/2026-09-02-lobby-screen-redesign-design.md) — read it alongside this plan.

## Global Constraints

- **Shell is PowerShell.** No `&&` chaining — use `;` or separate calls.
- **Fresh worktree setup:** run `npm install` in **both** the repo root and `frontend/`, and copy `frontend/.env.local` from the main checkout, before any build or test. A typecheck reporting errors in the hundreds means an incomplete `node_modules`, not a code regression.
- **Tests:** `npx vitest run` from the repo root. **Never pass `--root`** — it silently runs 0 tests.
- **No return-type annotations on React components.** React 19's types removed the global `JSX` namespace; `JSX.Element` does not compile here. Let TS infer.
- **Pages are named exports**, added to `App.tsx` as `lazy(() => import('./pages/X').then((m) => ({ default: m.X })))`.
- **No `shared/` changes in this plan.** Therefore `npm run functions:sync` has nothing to carry — but if a task ever does touch `shared/`, that commit must include the sync output or `supabase/seed/functionSharedSync.test.ts` fails.
- **Never use native `window.confirm/prompt/alert`** — use `ConfirmDialog` from `src/components/ConfirmDialog.tsx`.
- **Function errors** surface via `FunctionsHttpError` → `await error.context.json()` → `errors.join('; ')`, rendered inline near the triggering control.
- **Deploy edge functions only with `npm run functions:deploy -- lobby-action`.** Never through the `deploy_edge_function` MCP tool and never via a subagent — both truncate the payload, and a truncated deploy **deletes every file it omits**.
- **Colours come from Tailwind v4 `@theme` tokens** in `frontend/src/theme/index.css` (`ocean-*`, `brass-*`, `parchment-*`). Do not introduce raw hex.

---

### Task 1: Shared biome colour maps

Lifts the biome tint/border maps out of `BoardZone.tsx` so the new preview and the real board cannot drift apart. Pure, no dependencies on any other task.

**Files:**
- Create: `frontend/src/lib/biomeStyles.ts`
- Create: `frontend/src/lib/biomeStyles.test.ts`
- Modify: `frontend/src/pages/game/BoardZone.tsx` (delete the two local consts at lines 30–40, import them instead)

**Interfaces:**
- Consumes: `ZONE_TYPES` from `@shared/gameSettings`
- Produces: `BIOME_TINT: Record<string, string>`, `BIOME_BORDER: Record<string, string>` — Tailwind class strings keyed by biome value

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/biomeStyles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ZONE_TYPES } from '@shared/gameSettings'
import { BIOME_BORDER, BIOME_TINT } from './biomeStyles'

describe('biome styles', () => {
  it('tints every biome the engine can put on a zone', () => {
    for (const biome of Object.values(ZONE_TYPES)) {
      expect(BIOME_TINT[biome], `missing tint for ${biome}`).toBeDefined()
      expect(BIOME_TINT[biome].length).toBeGreaterThan(0)
    }
  })

  it('gives every biome a border', () => {
    for (const biome of Object.values(ZONE_TYPES)) {
      expect(BIOME_BORDER[biome], `missing border for ${biome}`).toBeDefined()
      expect(BIOME_BORDER[biome].length).toBeGreaterThan(0)
    }
  })

  it('gives each biome a distinct tint, so two biomes never render alike', () => {
    const tints = Object.values(ZONE_TYPES).map((b) => BIOME_TINT[b])
    expect(new Set(tints).size).toBe(tints.length)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run frontend/src/lib/biomeStyles.test.ts
```

Expected: FAIL — `Failed to resolve import "./biomeStyles"`.

- [ ] **Step 3: Create the module**

`frontend/src/lib/biomeStyles.ts` — the values are moved **verbatim** from `BoardZone.tsx`, along with the comment explaining why they carry this much contrast:

```ts
import { ZONE_TYPES } from '@shared/gameSettings'

// These ARE the biome readout — the biome word is gone from the board panel.
// A tinted border does most of the work: a low-opacity fill over a dark navy
// page barely registers, an edge colour reads at a glance. Deliberately weaker
// than the solid brass border + ring that marks a legal drop target, so a land
// zone is never mistaken for a highlighted one.
//
// Lives here rather than in BoardZone so the lobby's BoardPreview shows the
// same colours as the board it previews.
export const BIOME_TINT: Record<string, string> = {
  [ZONE_TYPES.WATER]: 'bg-ocean-600/30',
  [ZONE_TYPES.BEACH]: 'bg-parchment-300/20',
  [ZONE_TYPES.LAND]: 'bg-brass-400/20',
}

export const BIOME_BORDER: Record<string, string> = {
  [ZONE_TYPES.WATER]: 'border-ocean-300/50',
  [ZONE_TYPES.BEACH]: 'border-parchment-300/60',
  [ZONE_TYPES.LAND]: 'border-brass-400/45',
}
```

- [ ] **Step 4: Point `BoardZone.tsx` at the new module**

Delete the local `BIOME_TINT` and `BIOME_BORDER` consts (currently `frontend/src/pages/game/BoardZone.tsx:30-40`) and their comment block, then add to the imports:

```ts
import { BIOME_BORDER, BIOME_TINT } from '../../lib/biomeStyles'
```

The two use sites inside the `title=`/`className=` template literals stay exactly as they are.

- [ ] **Step 5: Run the tests and the frontend build**

```bash
npx vitest run frontend/src/lib/biomeStyles.test.ts
```

Expected: PASS, 3 tests.

```bash
npm --prefix frontend run build
```

Expected: clean typecheck + build. This is the check that catches a missed import in `BoardZone.tsx`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/biomeStyles.ts frontend/src/lib/biomeStyles.test.ts frontend/src/pages/game/BoardZone.tsx
git commit -m "refactor(frontend): lift biome colour maps into a shared module"
```

---

### Task 2: Lobby verdict and readiness logic (pure)

All the branching that decides where a player goes and whether the host may start. Deliberately typed against a **narrow structural interface**, not the generated `Database` types, so this task does not depend on the migration and its tests need no database.

**Files:**
- Create: `frontend/src/lib/lobbies.ts`
- Create: `frontend/src/lib/lobbies.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces, relied on by Tasks 7 and 8:
  - `interface LobbySeats { host_id: string; guest_id: string | null; host_deck_id: string | null; guest_deck_id: string | null; host_ready: boolean; guest_ready: boolean; status: string; game_id: string | null }`
  - `type LobbyVerdict = { kind: 'waiting' } | { kind: 'to-game'; gameId: string } | { kind: 'ejected'; notice: string } | { kind: 'joinable' } | { kind: 'unavailable'; notice: string }`
  - `lobbyVerdict(lobby: LobbySeats | null, myId: string, wasSeated: boolean): LobbyVerdict`
  - `canStart(lobby: LobbySeats): boolean`
  - `seatOf(lobby: LobbySeats, myId: string): 'host' | 'guest' | null`

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/lobbies.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LobbySeats } from './lobbies'
import { canStart, lobbyVerdict, seatOf } from './lobbies'

const HOST = 'host-uuid'
const GUEST = 'guest-uuid'
const STRANGER = 'stranger-uuid'

function lobby(over: Partial<LobbySeats> = {}): LobbySeats {
  return {
    host_id: HOST,
    guest_id: GUEST,
    host_deck_id: 'deck-a',
    guest_deck_id: 'deck-b',
    host_ready: true,
    guest_ready: true,
    status: 'open',
    game_id: null,
    ...over,
  }
}

describe('lobbyVerdict', () => {
  it('sends the HOST to the game once game_id lands', () => {
    const v = lobbyVerdict(lobby({ status: 'closed', game_id: 'game-1' }), HOST, true)
    expect(v).toEqual({ kind: 'to-game', gameId: 'game-1' })
  })

  // The whole point of R-3: the guest reaches the board by the same path,
  // without pressing anything.
  it('sends the GUEST to the game once game_id lands', () => {
    const v = lobbyVerdict(lobby({ status: 'closed', game_id: 'game-1' }), GUEST, true)
    expect(v).toEqual({ kind: 'to-game', gameId: 'game-1' })
  })

  it('keeps a seated player waiting while the lobby is open', () => {
    expect(lobbyVerdict(lobby(), GUEST, true)).toEqual({ kind: 'waiting' })
  })

  it('keeps a seated player waiting through the starting lock', () => {
    expect(lobbyVerdict(lobby({ status: 'starting' }), GUEST, true)).toEqual({ kind: 'waiting' })
  })

  it('ejects a guest who was kicked', () => {
    const v = lobbyVerdict(lobby({ guest_id: null, guest_deck_id: null, guest_ready: false }), GUEST, true)
    expect(v).toEqual({ kind: 'ejected', notice: 'You were removed from the lobby.' })
  })

  // A kicked guest is looking at an open lobby with a free seat — the exact
  // shape that reads as 'joinable'. wasSeated has to win, or being kicked
  // silently offers you a Join button instead of telling you what happened.
  it('prefers ejected over joinable for a kicked guest', () => {
    const v = lobbyVerdict(lobby({ guest_id: null, guest_deck_id: null }), GUEST, true)
    expect(v.kind).toBe('ejected')
  })

  it('ejects everyone when the row is gone', () => {
    const v = lobbyVerdict(null, GUEST, true)
    expect(v).toEqual({ kind: 'ejected', notice: 'The host closed the lobby.' })
  })

  it('ejects a seated player from a lobby that closed without a game', () => {
    const v = lobbyVerdict(lobby({ status: 'closed' }), HOST, true)
    expect(v).toEqual({ kind: 'ejected', notice: 'That lobby is no longer open.' })
  })

  it('offers a stranger the free seat of an open lobby', () => {
    expect(lobbyVerdict(lobby({ guest_id: null }), STRANGER, false)).toEqual({ kind: 'joinable' })
  })

  it('tells a stranger a full lobby is unavailable', () => {
    const v = lobbyVerdict(lobby(), STRANGER, false)
    expect(v).toEqual({ kind: 'unavailable', notice: 'That lobby is full or closed.' })
  })

  it('tells a stranger a closed lobby is unavailable', () => {
    const v = lobbyVerdict(lobby({ guest_id: null, status: 'closed' }), STRANGER, false)
    expect(v.kind).toBe('unavailable')
  })
})

describe('canStart', () => {
  it('allows a start when both seats are decked and ready', () => {
    expect(canStart(lobby())).toBe(true)
  })

  it('refuses without a guest', () => {
    expect(canStart(lobby({ guest_id: null, guest_deck_id: null, guest_ready: false }))).toBe(false)
  })

  it('refuses without a host deck', () => {
    expect(canStart(lobby({ host_deck_id: null }))).toBe(false)
  })

  it('refuses without a guest deck', () => {
    expect(canStart(lobby({ guest_deck_id: null }))).toBe(false)
  })

  it('refuses when the host has not readied', () => {
    expect(canStart(lobby({ host_ready: false }))).toBe(false)
  })

  it('refuses when the guest has not readied', () => {
    expect(canStart(lobby({ guest_ready: false }))).toBe(false)
  })

  it('refuses once the lobby has left open', () => {
    expect(canStart(lobby({ status: 'starting' }))).toBe(false)
  })
})

describe('seatOf', () => {
  it('names each seat', () => {
    expect(seatOf(lobby(), HOST)).toBe('host')
    expect(seatOf(lobby(), GUEST)).toBe('guest')
    expect(seatOf(lobby(), STRANGER)).toBe(null)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run frontend/src/lib/lobbies.test.ts
```

Expected: FAIL — `Failed to resolve import "./lobbies"`.

- [ ] **Step 3: Write the module**

`frontend/src/lib/lobbies.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { LobbySettings } from '@shared/lobbySettings'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'

export type LobbyRow = Database['public']['Tables']['lobbies']['Row']

// The narrow shape the pure functions below reason about. Deliberately NOT
// LobbyRow: these are the only columns the decisions turn on, and typing
// against the subset keeps the tests free of generated-type churn.
export interface LobbySeats {
  host_id: string
  guest_id: string | null
  host_deck_id: string | null
  guest_deck_id: string | null
  host_ready: boolean
  guest_ready: boolean
  status: string
  game_id: string | null
}

export type LobbyVerdict =
  | { kind: 'waiting' }
  | { kind: 'to-game'; gameId: string }
  | { kind: 'ejected'; notice: string }
  | { kind: 'joinable' }
  | { kind: 'unavailable'; notice: string }

export function seatOf(lobby: LobbySeats, myId: string): 'host' | 'guest' | null {
  if (lobby.host_id === myId) return 'host'
  if (lobby.guest_id === myId) return 'guest'
  return null
}

// Where this player belongs, given the latest row. The page acts on the
// verdict; it never decides for itself. `wasSeated` is the one bit of history
// the row cannot carry — without it, a kicked guest is indistinguishable from
// a stranger browsing an open lobby.
export function lobbyVerdict(
  lobby: LobbySeats | null,
  myId: string,
  wasSeated: boolean,
): LobbyVerdict {
  if (!lobby) {
    return wasSeated
      ? { kind: 'ejected', notice: 'The host closed the lobby.' }
      : { kind: 'unavailable', notice: 'That lobby no longer exists.' }
  }

  if (seatOf(lobby, myId) !== null) {
    // game_id is checked before status because a started lobby is 'closed' —
    // reading status first would eject both players at the moment of victory.
    if (lobby.game_id) return { kind: 'to-game', gameId: lobby.game_id }
    if (lobby.status === 'closed') {
      return { kind: 'ejected', notice: 'That lobby is no longer open.' }
    }
    return { kind: 'waiting' }
  }

  // Ordered ahead of 'joinable' on purpose: a kicked guest is looking at an
  // open lobby with a free seat, and must be told what happened rather than
  // silently offered the seat back.
  if (wasSeated) return { kind: 'ejected', notice: 'You were removed from the lobby.' }

  if (lobby.status === 'open' && !lobby.guest_id) return { kind: 'joinable' }
  return { kind: 'unavailable', notice: 'That lobby is full or closed.' }
}

// Mirrors the conditions in lobby-action's START lock. Advisory only — the
// server re-checks every one of them inside the statement that takes the
// mutex, so a stale client can never start a game it shouldn't.
export function canStart(lobby: LobbySeats): boolean {
  return (
    lobby.status === 'open' &&
    !!lobby.host_deck_id &&
    !!lobby.guest_id &&
    !!lobby.guest_deck_id &&
    lobby.host_ready &&
    lobby.guest_ready
  )
}

export function useLobbyQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['lobby', id],
    enabled: !!id,
    queryFn: async (): Promise<LobbyRow | null> => {
      const { data, error } = await supabase
        .from('lobbies').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export interface LobbyActionBody {
  action: 'JOIN' | 'LEAVE' | 'START' | 'SET_DECK' | 'SET_READY' | 'UPDATE_SETTINGS' | 'KICK'
  lobbyId: string
  deckId?: string
  ready?: boolean
  settings?: LobbySettings
}

export async function lobbyAction(body: LobbyActionBody) {
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
```

> Note: `useLobbyQuery` references `host_ready`/`guest_ready` only through `LobbyRow`, which does not carry those columns until Task 3 regenerates the types. That is fine — nothing in this file *reads* them off a `LobbyRow` yet, so it compiles today.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run frontend/src/lib/lobbies.test.ts
```

Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/lobbies.ts frontend/src/lib/lobbies.test.ts
git commit -m "feat(frontend): lobby verdict, readiness and seat logic"
```

---

### Task 3: Migration — nullable host deck, ready flags, denormalized factions

**Files:**
- Create: `supabase/migrations/<UTC timestamp>_lobby_ready_and_optional_decks.sql`
- Modify: `frontend/src/lib/database.types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces, relied on by Tasks 4–8: `lobbies.host_deck_id` becomes `uuid null`; `lobbies.host_ready` and `lobbies.guest_ready` exist as `boolean not null default false`; `lobbies.host_faction` and `lobbies.guest_faction` exist as `text null`.

- [ ] **Step 1: Name the migration file**

The filename must be a UTC timestamp in the same `YYYYMMDDHHMMSS` format as its neighbours (see `supabase/migrations/`, e.g. `20260901222000_create_battle_tokens.sql`). Generate it:

```bash
node -e "console.log(new Date().toISOString().replace(/[-:T]/g,'').slice(0,14))"
```

Use that value as the prefix. **Never rename a migration after it has been applied** — the timestamp is recorded in `supabase_migrations.schema_migrations`, and a renamed file is replayed and fails.

- [ ] **Step 2: Write the migration**

```sql
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
```

- [ ] **Step 3: Apply the migration**

Apply it through the Supabase MCP `apply_migration` tool (there is no local Supabase stack — remote only), passing the file's contents and its name.

- [ ] **Step 4: Verify the shape landed**

Via the MCP `execute_sql` tool:

```sql
select column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'lobbies'
   and column_name in ('host_deck_id', 'host_ready', 'guest_ready', 'host_faction', 'guest_faction')
 order by column_name;
```

Expected five rows: `guest_faction | YES`, `guest_ready | NO | false`, `host_deck_id | YES`, `host_faction | YES`, `host_ready | NO | false`.

- [ ] **Step 5: Regenerate the frontend types**

Use the MCP `generate_typescript_types` tool and write its output over `frontend/src/lib/database.types.ts`. Then confirm the three columns appear:

```bash
grep -n "host_ready\|guest_ready\|host_deck_id\|host_faction\|guest_faction" frontend/src/lib/database.types.ts
```

Expected in the lobbies `Row`: `host_deck_id: string | null`, `host_ready: boolean`, `guest_ready: boolean`, `host_faction: string | null`, `guest_faction: string | null`.

- [ ] **Step 6: Confirm nothing regressed**

```bash
npm --prefix frontend run build
```

Expected: clean. `LobbiesPage.tsx` still inserts `host_deck_id: deckId` at this point, which remains valid against a nullable column.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations frontend/src/lib/database.types.ts
git commit -m "feat(db): nullable host deck and explicit ready flags on lobbies"
```

---

### Task 4: `lobby-action` — four new ops and a tighter START lock

**Files:**
- Modify: `supabase/functions/lobby-action/index.ts`

**Interfaces:**
- Consumes: the columns from Task 3.
- Produces, relied on by Tasks 5, 7 and 8: the request body gains `ready?: boolean` and `settings?: unknown`; ops `SET_DECK`, `SET_READY`, `UPDATE_SETTINGS`, `KICK`. All return `200 { ok: true }` on success except `START` (`{ gameId }`) and `JOIN` (`{ lobby }`).

- [ ] **Step 1: Widen the body parse**

In `supabase/functions/lobby-action/index.ts`, replace the body-parsing block (currently the `let body: { action?: unknown; ... }` declaration through the `deckId` const) with:

```ts
  let body: {
    action?: unknown; lobbyId?: unknown; deckId?: unknown
    ready?: unknown; settings?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json(400, { errors: ['Invalid JSON body'] })
  }
  const action = typeof body.action === 'string' ? body.action : ''
  const lobbyId = typeof body.lobbyId === 'string' ? body.lobbyId : ''
  const deckId = typeof body.deckId === 'string' ? body.deckId : ''
  if (!lobbyId) return json(400, { errors: ['lobbyId required'] })
```

- [ ] **Step 2: Make `JOIN`'s deck optional**

Replace the `JOIN` block's opening — the `if (!deckId) return json(400, ...)` guard and the deck-ownership lookup — so a deckless join claims the seat. Keep the ownership check for the compatibility case where a deck *is* supplied (the pre-redesign frontend still sends one during the deploy window):

```ts
  if (action === 'JOIN') {
    // deckId is optional now: seats are claimed first and decked in the lobby
    // (spec R-2). It is still accepted so a frontend deployed before this
    // function keeps working through the rollout window.
    if (deckId) {
      const { data: deck } = await admin
        .from('decks').select('id, owner_id').eq('id', deckId).maybeSingle()
      if (!deck || deck.owner_id !== userId) {
        return json(403, { errors: ['That deck is not yours'] })
      }
    }
    // Atomic claim: only succeeds while the seat is empty and the lobby open.
    const { data: claimed, error: claimError } = await admin
      .from('lobbies')
      .update({ guest_id: userId, guest_deck_id: deckId || null })
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
```

- [ ] **Step 3: Clear the guest's ready flag on LEAVE**

In the `LEAVE` block, change the update payload:

```ts
      .update({ guest_id: null, guest_deck_id: null, guest_faction: null, guest_ready: false })
```

- [ ] **Step 4: Add the four new ops**

Insert this block immediately **after** the `LEAVE` block and **before** `if (action === 'START')`:

```ts
  // Every op below is conditioned on status = 'open' inside its own WHERE, so
  // none of them can mutate a lobby that START has already locked to
  // 'starting'. Reading the row first and updating second would leave exactly
  // that window open.

  if (action === 'SET_DECK') {
    if (!deckId) return json(400, { errors: ['deckId required'] })
    const { data: deck } = await admin
      .from('decks').select('id, owner_id, faction').eq('id', deckId).maybeSingle()
    if (!deck || deck.owner_id !== userId) {
      return json(403, { errors: ['That deck is not yours'] })
    }
    const { data: lobby } = await admin
      .from('lobbies').select('host_id, guest_id').eq('id', lobbyId).maybeSingle()
    if (!lobby) return json(404, { errors: ['Lobby not found'] })

    // Two things happen here. The faction is copied onto the lobby (spec
    // §3.1.1) because decks_select_own means the opponent's deck row is
    // unreadable by the client — faction is the ONLY field that crosses, so
    // the deck's name and contents stay structurally out of reach rather than
    // merely unrendered. And changing your deck drops your OWN ready flag
    // (§4.1): you re-affirm after changing what you are bringing.
    const patch = lobby.host_id === userId
      ? { host_deck_id: deckId, host_faction: deck.faction, host_ready: false }
      : lobby.guest_id === userId
        ? { guest_deck_id: deckId, guest_faction: deck.faction, guest_ready: false }
        : null
    if (!patch) return json(403, { errors: ['You are not in that lobby'] })

    const { data: updated, error: updateError } = await admin
      .from('lobbies').update(patch).eq('id', lobbyId).eq('status', 'open')
      .select().maybeSingle()
    if (updateError) return json(500, { errors: [updateError.message] })
    if (!updated) return json(409, { errors: ['Lobby is no longer open'] })
    return json(200, { ok: true })
  }

  if (action === 'SET_READY') {
    if (typeof body.ready !== 'boolean') return json(400, { errors: ['ready must be a boolean'] })
    const ready = body.ready
    const { data: lobby } = await admin
      .from('lobbies').select('host_id, guest_id, host_deck_id, guest_deck_id')
      .eq('id', lobbyId).maybeSingle()
    if (!lobby) return json(404, { errors: ['Lobby not found'] })

    const isHost = lobby.host_id === userId
    const isGuest = lobby.guest_id === userId
    if (!isHost && !isGuest) return json(403, { errors: ['You are not in that lobby'] })

    const myDeck = isHost ? lobby.host_deck_id : lobby.guest_deck_id
    if (ready && !myDeck) return json(409, { errors: ['Pick a deck before readying up'] })

    const { data: updated, error: updateError } = await admin
      .from('lobbies')
      .update(isHost ? { host_ready: ready } : { guest_ready: ready })
      .eq('id', lobbyId).eq('status', 'open')
      .select().maybeSingle()
    if (updateError) return json(500, { errors: [updateError.message] })
    if (!updated) return json(409, { errors: ['Lobby is no longer open'] })
    return json(200, { ok: true })
  }

  if (action === 'UPDATE_SETTINGS') {
    const parsed = validateLobbySettings(body.settings)
    if ('errors' in parsed) return json(400, { errors: parsed.errors })

    // Clears guest_ready, never host_ready (spec §4.1): the host authored the
    // change, so their consent is implicit; the guest re-affirms against the
    // battlefield they can now see in the preview.
    const { data: updated, error: updateError } = await admin
      .from('lobbies')
      .update({ settings: parsed.settings, guest_ready: false })
      .eq('id', lobbyId).eq('status', 'open').eq('host_id', userId)
      .select().maybeSingle()
    if (updateError) return json(500, { errors: [updateError.message] })
    if (!updated) return json(409, { errors: ['Only the host can change an open lobby'] })
    return json(200, { ok: true })
  }

  if (action === 'KICK') {
    const { data: updated, error: updateError } = await admin
      .from('lobbies')
      .update({ guest_id: null, guest_deck_id: null, guest_faction: null, guest_ready: false })
      .eq('id', lobbyId).eq('status', 'open').eq('host_id', userId)
      .select().maybeSingle()
    if (updateError) return json(500, { errors: [updateError.message] })
    if (!updated) return json(409, { errors: ['Only the host can remove a player from an open lobby'] })
    return json(200, { ok: true })
  }
```

- [ ] **Step 5: Tighten the START lock**

In the `START` block, extend the `open → starting` lock's `WHERE` and its failure message:

```ts
    const { data: locked } = await admin
      .from('lobbies')
      .update({ status: 'starting' })
      .eq('id', lobbyId)
      .eq('status', 'open')
      .not('guest_id', 'is', null)
      .not('guest_deck_id', 'is', null)
      .not('host_deck_id', 'is', null)
      .eq('host_ready', true)
      .eq('guest_ready', true)
      .select()
      .maybeSingle()
    if (!locked || !locked.guest_id || !locked.guest_deck_id || !locked.host_deck_id) {
      return json(409, {
        errors: ['Both players need a deck and a ready check before the battle can begin'],
      })
    }
```

All four preconditions are now checked in the same statement that takes the mutex, so no stale `true` read earlier can be acted on.

- [ ] **Step 6: Preview the deploy payload**

```bash
npm run functions:deploy -- lobby-action --dry-run
```

Expected: a file list including `index.ts` and the `shared/` modules. Needs `SUPABASE_ACCESS_TOKEN` in the environment.

- [ ] **Step 7: Deploy**

```bash
npm run functions:deploy -- lobby-action
```

**Do not** deploy through the `deploy_edge_function` MCP tool and **do not** delegate this to a subagent — both truncate the payload, and a truncated deploy deletes every file it omits, failing the function at boot for every player.

- [ ] **Step 8: Verify the deploy**

Read the function back with the MCP `get_edge_function` tool and confirm the **version number incremented** and that the four new op strings are present in `index.ts`. Verify by content, not file count — a deploy legitimately reads back with fewer modules because type-only imports are erased during transpilation.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/lobby-action/index.ts
git commit -m "feat(lobby-action): SET_DECK, SET_READY, UPDATE_SETTINGS, KICK, and ready-gated START"
```

---

### Task 5: Repair the smoke harness, then cover the new ops

`smoke-lib.mjs`'s `startGame` posts a lobby and calls `START` immediately. With Task 4 deployed, that `START` now 409s — which breaks **every** existing harness (`smoke-wave4/5/6/7.mjs`, `smoke-battle-report.mjs`, `mutation-harness.mjs`). Fix the shared plumbing first, then add the lobby-specific coverage.

**Files:**
- Modify: `scripts/smoke-lib.mjs` (the `startGame` function, around lines 195–200)
- Create: `scripts/smoke-lobby.mjs`

**Interfaces:**
- Consumes: `step`, `rest`, `fn`, `signIn`, `builtIns`, `buildDeck`, `cleanUp`, `report`, `keep` from `./smoke-lib.mjs`; the ops from Task 4.

- [ ] **Step 1: Ready both seats inside `startGame`**

In `scripts/smoke-lib.mjs`, between the existing JOIN and START calls, insert:

```js
  // START is ready-gated as of the lobby redesign: both seats must carry a
  // deck AND a ready check. Every harness that calls startGame goes through
  // here, so the gate is satisfied once, in one place.
  for (const [who, label] of [[p1, 'host'], [p2, 'guest']]) {
    const r = await fn('lobby-action', who.token, { action: 'SET_READY', lobbyId, ready: true })
    if (r.status !== 200) die(`${label} SET_READY failed (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`)
  }
```

The lobby POST above it keeps `host_deck_id: p1DeckId` — harnesses deck the host at creation, which a nullable column still allows.

- [ ] **Step 2: Prove the existing harnesses still start a game**

```bash
node scripts/smoke-wave4.mjs
```

Expected: the run reaches its scenarios and reports PASS lines. A `START failed (HTTP 409)` here means Step 1 did not land. This is the regression gate for Task 4 — run it before writing anything new.

- [ ] **Step 3: Write the lobby smoke script**

`scripts/smoke-lobby.mjs`:

```js
#!/usr/bin/env node
// Live smoke test for the redesigned lobby flow against the REAL backend.
// Plumbing lives in ./smoke-lib.mjs; this file is scenarios only.
//
// What it proves that no unit test can: the four new lobby-action ops and the
// ready-gated START lock actually behave that way through Postgres and RLS.
// There is no local Supabase stack, so this is the only place the ops run.
//
// Usage:  node scripts/smoke-lobby.mjs [--keep]
//
// Credentials come from scripts/qa-accounts.local (gitignored).

import { step, rest, fn, signIn, builtIns, buildDeck, report, keep } from './smoke-lib.mjs'

const WATER = [1, 2, 3].map(() => ({ biome: 'water', baseHp: 5000 }))

async function main() {
  const p1 = await signIn('P1')
  const p2 = await signIn('P2')
  const cards = await builtIns(p1.token)

  async function makeDeck(who, faction) {
    const res = await rest('/decks', {
      method: 'POST', token: who.token, prefer: 'return=representation',
      body: {
        owner_id: who.userId, name: `lobby-smoke-${Date.now()}`, faction,
        cards: buildDeck(cards, faction, []),
      },
    })
    return res.body[0].id
  }
  const hostDeck = await makeDeck(p1, 'DWG')
  const guestDeck = await makeDeck(p2, 'DWG')

  // A deckless lobby is the whole point of R-2 — it must be insertable now.
  const created = await rest('/lobbies', {
    method: 'POST', token: p1.token, prefer: 'return=representation',
    body: { host_id: p1.userId, name: `lobby-smoke-${Date.now()}`, status: 'open', settings: { zones: WATER } },
  })
  step('creates a lobby with no host deck', created.status < 300 && !!created.body?.[0]?.id,
    `HTTP ${created.status}`)
  const lobbyId = created.body?.[0]?.id
  if (!lobbyId) return

  const load = async () => (await rest(`/lobbies?id=eq.${lobbyId}&select=*`, { token: p1.token })).body?.[0]

  // Readying without a deck must fail — this is the precondition SET_READY
  // enforces so START never has to.
  const earlyReady = await fn('lobby-action', p1.token, { action: 'SET_READY', lobbyId, ready: true })
  step('refuses ready before a deck is picked', earlyReady.status === 409, `HTTP ${earlyReady.status}`)

  const setHostDeck = await fn('lobby-action', p1.token, { action: 'SET_DECK', lobbyId, deckId: hostDeck })
  step('host sets a deck from inside the lobby', setHostDeck.status === 200, `HTTP ${setHostDeck.status}`)

  const joined = await fn('lobby-action', p2.token, { action: 'JOIN', lobbyId })
  step('guest joins without naming a deck', joined.status === 200, `HTTP ${joined.status}`)

  const guestDeckSet = await fn('lobby-action', p2.token, { action: 'SET_DECK', lobbyId, deckId: guestDeck })
  step('guest sets a deck from inside the lobby', guestDeckSet.status === 200, `HTTP ${guestDeckSet.status}`)

  // R-1 through the denormalized column: the guest can see the host's FACTION
  // without being able to read the host's deck at all.
  const seen = (await rest(`/lobbies?id=eq.${lobbyId}&select=host_faction,guest_faction`, { token: p2.token })).body?.[0]
  step('guest reads the host faction off the lobby row', seen?.host_faction === 'DWG', String(seen?.host_faction))

  // The property that denormalization exists to preserve. If this ever starts
  // returning a row, the opponent's entire decklist is readable and the
  // "faction yes, deck name no" rule in spec §5.3 is gone.
  const peek = await rest(`/decks?id=eq.${hostDeck}&select=id,name,cards`, { token: p2.token })
  step('guest CANNOT read the host deck itself',
    Array.isArray(peek.body) && peek.body.length === 0, `${peek.body?.length ?? '?'} rows`)

  // A guest must not be able to edit the battlefield.
  const guestSettings = await fn('lobby-action', p2.token, {
    action: 'UPDATE_SETTINGS', lobbyId, settings: { zones: WATER },
  })
  step('guest cannot change settings', guestSettings.status === 409, `HTTP ${guestSettings.status}`)

  await fn('lobby-action', p1.token, { action: 'SET_READY', lobbyId, ready: true })
  await fn('lobby-action', p2.token, { action: 'SET_READY', lobbyId, ready: true })
  const bothReady = await load()
  step('both seats read as ready', bothReady.host_ready === true && bothReady.guest_ready === true)

  // R-8, the consent invariant: a settings change must drop the guest's ready
  // flag and leave the host's alone.
  const changed = await fn('lobby-action', p1.token, {
    action: 'UPDATE_SETTINGS', lobbyId,
    settings: { zones: [{ biome: 'land', baseHp: 5000 }, { biome: 'beach', baseHp: 5000 }, { biome: 'water', baseHp: 5000 }] },
  })
  step('host changes settings in the lobby', changed.status === 200, `HTTP ${changed.status}`)
  const afterChange = await load()
  step('settings change clears ONLY the guest ready flag',
    afterChange.guest_ready === false && afterChange.host_ready === true)

  const blocked = await fn('lobby-action', p1.token, { action: 'START', lobbyId })
  step('START is refused while the guest is unready', blocked.status === 409, `HTTP ${blocked.status}`)

  // Changing your own deck drops your own flag, not the other player's.
  await fn('lobby-action', p2.token, { action: 'SET_READY', lobbyId, ready: true })
  await fn('lobby-action', p2.token, { action: 'SET_DECK', lobbyId, deckId: guestDeck })
  const afterDeckSwap = await load()
  step('changing your deck clears your own ready flag', afterDeckSwap.guest_ready === false)

  // A guest cannot be kicked by anyone but the host.
  const badKick = await fn('lobby-action', p2.token, { action: 'KICK', lobbyId })
  step('a guest cannot kick', badKick.status === 409, `HTTP ${badKick.status}`)

  const kicked = await fn('lobby-action', p1.token, { action: 'KICK', lobbyId })
  step('host kicks the guest', kicked.status === 200, `HTTP ${kicked.status}`)
  const afterKick = await load()
  step('kick frees the seat entirely',
    afterKick.guest_id === null && afterKick.guest_deck_id === null &&
    afterKick.guest_faction === null && afterKick.guest_ready === false)

  // Rejoin and run the flow to completion.
  await fn('lobby-action', p2.token, { action: 'JOIN', lobbyId })
  await fn('lobby-action', p2.token, { action: 'SET_DECK', lobbyId, deckId: guestDeck })
  await fn('lobby-action', p2.token, { action: 'SET_READY', lobbyId, ready: true })
  const started = await fn('lobby-action', p1.token, { action: 'START', lobbyId })
  step('START succeeds once both seats are decked and ready',
    started.status === 200 && !!started.body?.gameId, `HTTP ${started.status}`)

  const finished = await load()
  step('lobby closes and carries the game id',
    finished.status === 'closed' && finished.game_id === started.body?.gameId)

  const game = await rest(`/games?id=eq.${started.body?.gameId}&select=id,player_a,player_b`, { token: p2.token })
  step('the guest can read the game they were started into', game.body?.[0]?.id === started.body?.gameId)

  if (!keep) await rest(`/lobbies?id=eq.${lobbyId}`, { method: 'DELETE', token: p1.token })
}

await main()
report()
```

- [ ] **Step 4: Run it**

```bash
node scripts/smoke-lobby.mjs
```

Expected: every step PASS, exit code 0. Needs `frontend/.env.local` and `scripts/qa-accounts.local` (see docs/claude/testing.md).

- [ ] **Step 5: Confirm the wider harness suite still passes**

```bash
node scripts/smoke-wave7.mjs
```

Expected: PASS lines throughout — the deepest existing harness, and the strongest evidence Step 1 did not break the shared plumbing.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-lib.mjs scripts/smoke-lobby.mjs
git commit -m "test(smoke): ready-gate the shared harness and cover the new lobby ops"
```

---

### Task 6: `BoardPreview` component

**Files:**
- Create: `frontend/src/components/BoardPreview.tsx`

**Interfaces:**
- Consumes: `BIOME_TINT`, `BIOME_BORDER` from Task 1; `LobbySettings` from `@shared/lobbySettings`.
- Produces, relied on by Tasks 7 and 8: `<BoardPreview settings={LobbySettings} size="sm" | "lg" />`

- [ ] **Step 1: Write the component**

`frontend/src/components/BoardPreview.tsx`:

```tsx
import type { LobbySettings } from '@shared/lobbySettings'
import { shortHandNumber } from '@shared/format'
import { BIOME_BORDER, BIOME_TINT } from '../lib/biomeStyles'

// A miniature of the board the lobby is about to become — same zones, same
// left-to-right order, same biome colours as BoardZone, because both read the
// one map in lib/biomeStyles.ts. It is a picture, not a control: nothing here
// is clickable, and it carries no game state because none exists yet.
export function BoardPreview({ settings, size = 'lg' }: {
  settings: LobbySettings
  size?: 'sm' | 'lg'
}) {
  const small = size === 'sm'
  return (
    <div
      className={`flex ${small ? 'gap-1' : 'gap-2'}`}
      role="img"
      aria-label={`Battlefield: ${settings.zones.map((z) => z.biome).join(', ')}`}
    >
      {settings.zones.map((zone, i) => (
        <div
          key={i}
          className={`flex-1 rounded border text-center ${small ? 'px-1 py-2' : 'px-2 py-4'} ${
            BIOME_TINT[zone.biome] ?? 'bg-ocean-900/20'
          } ${BIOME_BORDER[zone.biome] ?? 'border-ocean-600'}`}
        >
          {!small && (
            <>
              <span className="block text-xs text-parchment-100">{zone.biome}</span>
              <span className="block text-xs text-ocean-300">{shortHandNumber(zone.baseHp)}</span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
```

The `role="img"` + `aria-label` is the accessible equivalent of the `sr-only` biome text `BoardZone` carries — colour alone is not a readout.

- [ ] **Step 2: Verify it compiles**

```bash
npm --prefix frontend run build
```

Expected: clean. (An unused export does not fail the build; Task 7 wires it up.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/BoardPreview.tsx
git commit -m "feat(frontend): board preview miniature"
```

---

### Task 7: The lobby screen

**Files:**
- Create: `frontend/src/pages/LobbyPage.tsx`
- Modify: `frontend/src/App.tsx` (add the route and extend the nav-hiding test)

**Interfaces:**
- Consumes: `useLobbyQuery`, `lobbyAction`, `lobbyVerdict`, `canStart`, `seatOf` (Task 2); `BoardPreview` (Task 6); the ops from Task 4; `useDecksQuery` from `../lib/decks`; `useUsernames` from `../lib/games`; `useRealtimeInvalidate` from `../lib/realtime`.
- Produces: route `/lobby/:id`, page export `LobbyPage`.

- [ ] **Step 1: Wire the route and hide the nav**

In `frontend/src/App.tsx`, add the lazy import beside the others:

```tsx
const LobbyPage = lazy(() => import('./pages/LobbyPage').then((m) => ({ default: m.LobbyPage })))
```

Extend the nav-hiding test (replacing the existing `onGameBoard` const and its comment):

```tsx
  // The battle board is a fixed-height column sized so board, hand, hero powers
  // and resource figures fit without scrolling, and the NavBar's ~65px is the
  // difference between that fitting on a 1080p screen and not. The lobby joins
  // it for a different reason: it is a full-screen staging room with its own
  // command strip, and the site nav competes with it. Both routes carry a back
  // link in the NavBar's place.
  const onGameBoard = useMatch('/game/:id') !== null
  const onLobby = useMatch('/lobby/:id') !== null
```

and the render guard:

```tsx
      {!onGameBoard && !onLobby && <NavBar right={<UserMenu />} />}
```

Add the route beside `/lobbies`:

```tsx
          <Route path="/lobby/:id" element={<RequireAuth><LobbyPage /></RequireAuth>} />
```

- [ ] **Step 2: Write the page**

`frontend/src/pages/LobbyPage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DEFAULT_LOBBY_SETTINGS, materialsPerTurnOf, validateLobbySettings } from '@shared/lobbySettings'
import type { LobbySettings } from '@shared/lobbySettings'
import { MAX_MATERIALS_PER_TURN, MIN_MATERIALS_PER_TURN, ZONE_TYPES } from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import { BoardPreview } from '../components/BoardPreview'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAuth } from '../lib/auth'
import { useDecksQuery } from '../lib/decks'
import { useUsernames } from '../lib/games'
import { canStart, lobbyAction, lobbyVerdict, seatOf, useLobbyQuery } from '../lib/lobbies'
import { useRealtimeInvalidate } from '../lib/realtime'
import { supabase } from '../lib/supabaseClient'

export function LobbyPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = session?.user.id ?? ''

  const { data: lobby, isLoading } = useLobbyQuery(id)
  const { data: decks } = useDecksQuery()
  useRealtimeInvalidate('lobby-room', 'lobbies', [['lobby', id]], `id=eq.${id}`)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  // Set before any self-initiated exit so the verdict effect stays quiet —
  // a host who cancels their own lobby must not be told "The host closed the
  // lobby", and a guest who leaves must not be told they were removed.
  const leavingRef = useRef(false)
  // The one bit of history the row cannot carry: without it a kicked guest
  // looks exactly like a stranger browsing an open lobby.
  const wasSeatedRef = useRef(false)

  // LobbyRow structurally satisfies LobbySeats once Task 3's types land, so
  // these pass straight through — no cast.
  const seat = lobby ? seatOf(lobby, me) : null
  if (seat !== null) wasSeatedRef.current = true

  const { data: names } = useUsernames([lobby?.host_id, lobby?.guest_id])

  useEffect(() => {
    if (isLoading || leavingRef.current) return
    const verdict = lobbyVerdict(lobby ?? null, me, wasSeatedRef.current)
    if (verdict.kind === 'to-game') {
      navigate(`/game/${verdict.gameId}`, { replace: true })
    } else if (verdict.kind === 'ejected') {
      navigate('/lobbies', { replace: true, state: { notice: verdict.notice } })
    }
  }, [lobby, isLoading, me, navigate])

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['lobby', id] })

  const setDeck = (deckId: string) => run(async () => {
    await lobbyAction({ action: 'SET_DECK', lobbyId: id!, deckId })
    await refresh()
  })

  const setReady = (ready: boolean) => run(async () => {
    await lobbyAction({ action: 'SET_READY', lobbyId: id!, ready })
    await refresh()
  })

  const updateSettings = (settings: LobbySettings) => run(async () => {
    const checked = validateLobbySettings(settings)
    if ('errors' in checked) throw new Error(checked.errors.join('; '))
    await lobbyAction({ action: 'UPDATE_SETTINGS', lobbyId: id!, settings: checked.settings })
    await refresh()
  })

  const kick = () => run(async () => {
    await lobbyAction({ action: 'KICK', lobbyId: id! })
    await refresh()
  })

  const join = () => run(async () => {
    await lobbyAction({ action: 'JOIN', lobbyId: id! })
    await refresh()
  })

  const leave = () => run(async () => {
    leavingRef.current = true
    await lobbyAction({ action: 'LEAVE', lobbyId: id! })
    navigate('/lobbies', { replace: true })
  })

  const cancel = () => run(async () => {
    leavingRef.current = true
    const { error: deleteError } = await supabase.from('lobbies').delete().eq('id', id!)
    if (deleteError) { leavingRef.current = false; throw deleteError }
    navigate('/lobbies', { replace: true })
  })

  // The fast path for the host. The verdict effect above would get them there
  // anyway once game_id arrives over realtime — this just skips the wait, and
  // means a dropped response leaves the host no worse off than the guest.
  const start = () => run(async () => {
    const result = await lobbyAction({ action: 'START', lobbyId: id! })
    if (result?.gameId) navigate(`/game/${result.gameId}`, { replace: true })
  })

  if (isLoading) return <main className="p-8 text-center text-ocean-300">Loading lobby…</main>
  if (!lobby) return <main className="p-8 text-center text-ocean-300">Lobby not found.</main>

  const isHost = seat === 'host'
  const settings = 'errors' in validateLobbySettings(lobby.settings)
    ? DEFAULT_LOBBY_SETTINGS
    : (validateLobbySettings(lobby.settings) as { settings: LobbySettings }).settings

  if (seat === null) {
    const open = lobby.status === 'open' && !lobby.guest_id
    return (
      <main className="mx-auto max-w-2xl p-6">
        <Link to="/lobbies" className="text-sm text-ocean-300 hover:text-brass-400">← Harbor</Link>
        <h1 className="mt-3 font-display text-3xl">{lobby.name}</h1>
        <div className="mt-4"><BoardPreview settings={settings} /></div>
        {error && <p className="mt-2 text-red-400">{error}</p>}
        {open ? (
          <button disabled={busy} onClick={join}
            className="mt-4 rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
            Take the free seat
          </button>
        ) : (
          <p className="mt-4 text-ocean-300">That lobby is full or closed.</p>
        )}
      </main>
    )
  }

  const myDeckId = (isHost ? lobby.host_deck_id : lobby.guest_deck_id) ?? ''
  const myReady = isHost ? lobby.host_ready : lobby.guest_ready
  // Off the LOBBY row, never from `decks` — decks_select_own means the
  // opponent's deck row is unreadable by this client (spec §3.1.1).
  const theirFaction = (isHost ? lobby.guest_faction : lobby.host_faction) ?? undefined

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col gap-3 p-4">
      {/* Command strip, in the hidden NavBar's place — same shape as the
          game board's, so the two full-screen routes read alike. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-ocean-600 bg-ocean-900/95 px-3 py-1.5">
        <Link to="/lobbies" title="Back to the harbor" className="text-sm text-ocean-300 hover:text-brass-400">
          ← Harbor
        </Link>
        <h1 className="font-display text-lg leading-tight">{lobby.name}</h1>
        <span className="text-sm text-ocean-300">{isHost ? 'Host' : 'Challenger'}</span>
        <span className="ml-auto rounded-full bg-ocean-800 px-2.5 py-0.5 text-sm text-ocean-300">
          {!lobby.guest_id
            ? 'Waiting for a challenger'
            : canStart(lobby) ? 'Ready to launch' : 'Waiting on ready checks'}
        </span>
      </header>

      {error && <p className="text-red-400">{error}</p>}

      <div className="grid gap-3 md:grid-cols-[1.15fr_1fr]">
        <section className="flex flex-col gap-2">
          <Seat
            label="Host" name={names?.get(lobby.host_id) ?? '…'} ready={lobby.host_ready}
            mine={isHost} decks={decks ?? []} deckId={isHost ? myDeckId : ''}
            faction={isHost ? undefined : theirFaction}
            onDeck={setDeck} onReady={setReady} busy={busy}
          />
          {lobby.guest_id ? (
            <Seat
              label="Challenger" name={names?.get(lobby.guest_id) ?? '…'} ready={lobby.guest_ready}
              mine={!isHost} decks={decks ?? []} deckId={!isHost ? myDeckId : ''}
              faction={isHost ? theirFaction : undefined}
              onDeck={setDeck} onReady={setReady} busy={busy}
              onKick={isHost ? kick : undefined}
            />
          ) : (
            <div className="rounded border border-dashed border-ocean-600 bg-ocean-900/40 p-6 text-center text-ocean-300">
              An empty berth. Share this page's link to fill it.
            </div>
          )}
        </section>

        <section className="rounded border border-ocean-600 bg-ocean-900/60 p-3">
          <h2 className="text-sm text-ocean-300">Battlefield</h2>
          <div className="mt-2"><BoardPreview settings={settings} /></div>
          <div className="mt-3 border-t border-ocean-600 pt-3">
            {isHost ? (
              <SettingsEditor settings={settings} busy={busy} onChange={updateSettings} />
            ) : (
              <dl className="flex flex-col gap-1 text-sm text-ocean-300">
                <div className="flex justify-between">
                  <dt>Base HP</dt>
                  <dd className="text-parchment-100">
                    {settings.zones.map((z) => shortHandNumber(z.baseHp)).join(' / ')}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Resources / turn</dt>
                  <dd className="text-parchment-100">
                    {shortHandNumber(materialsPerTurnOf(settings))} × turn
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {isHost && (
          <button disabled={busy || !canStart(lobby)} onClick={start}
            className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
            {busy ? 'Working…' : 'Start game'}
          </button>
        )}
        <button disabled={busy || (!myReady && !myDeckId)} onClick={() => setReady(!myReady)}
          className="rounded border border-ocean-600 px-4 py-2 text-parchment-100 disabled:opacity-50">
          {myReady ? 'Unready' : 'Ready'}
        </button>
        <div className="ml-auto">
          {isHost ? (
            <button disabled={busy} onClick={() => setConfirmCancel(true)} className="text-red-400 underline">
              Cancel lobby
            </button>
          ) : (
            <button disabled={busy} onClick={leave} className="text-red-400 underline">
              Leave lobby
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this lobby?"
        body="The lobby closes for both of you and the berth is lost."
        confirmLabel="Cancel lobby"
        danger
        onConfirm={() => { setConfirmCancel(false); void cancel() }}
        onCancel={() => setConfirmCancel(false)}
      />
    </main>
  )
}
```

- [ ] **Step 3: Add the two sub-components to the same file**

Below `LobbyPage`, still in `frontend/src/pages/LobbyPage.tsx`:

```tsx
function Seat({ label, name, ready, mine, decks, deckId, faction, onDeck, onReady, busy, onKick }: {
  label: string
  name: string
  ready: boolean
  mine: boolean
  decks: { id: string; name: string; faction: string }[]
  deckId: string
  /** The opponent's faction, read off the lobby row. Their deck NAME is
      deliberately never shown — "anti-air rush" tells you what to mulligan
      for, with no way to un-see it — and is not even fetchable client-side. */
  faction?: string
  onDeck: (deckId: string) => void
  onReady: (ready: boolean) => void
  busy: boolean
  onKick?: () => void
}) {
  return (
    <div className={`rounded border p-3 ${ready ? 'border-brass-400' : 'border-ocean-600'} bg-ocean-900/60`}>
      <p className="text-xs text-ocean-300">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="font-bold text-parchment-100">{name}</span>
        {faction && (
          <span className="rounded-full bg-ocean-800 px-2 py-0.5 text-xs text-ocean-300">{faction}</span>
        )}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${
          ready ? 'bg-brass-400 text-ocean-950' : 'bg-ocean-800 text-ocean-300'
        }`}>
          {ready ? 'Ready' : 'Not ready'}
        </span>
        {onKick && (
          <button onClick={onKick} disabled={busy} aria-label={`Remove ${name} from the lobby`}
            title="Remove from lobby" className="text-red-400 disabled:opacity-50">
            ×
          </button>
        )}
      </div>
      {mine && (
        <select className="mt-2 w-full rounded bg-ocean-950 p-2" value={deckId} disabled={busy}
          onChange={(e) => onDeck(e.target.value)}>
          <option value="">Your deck…</option>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.faction})</option>)}
        </select>
      )}
    </div>
  )
}

// Selects commit on change; number inputs commit on BLUR, so typing a
// five-digit HP value sends one request instead of five.
function SettingsEditor({ settings, busy, onChange }: {
  settings: LobbySettings
  busy: boolean
  onChange: (next: LobbySettings) => void
}) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => { setDraft(settings) }, [settings])

  const commitZoneHp = (i: number, value: number) => {
    const next = { ...draft, zones: draft.zones.map((z, j) => (j === i ? { ...z, baseHp: value } : z)) }
    setDraft(next); onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {draft.zones.map((zone, i) => (
        <div key={i} className="flex items-center gap-2 text-sm text-ocean-300">
          <span className="w-14">Zone {i + 1}</span>
          <select className="flex-1 rounded bg-ocean-950 p-1" value={zone.biome} disabled={busy}
            onChange={(e) => {
              const next = {
                ...draft,
                zones: draft.zones.map((z, j) =>
                  (j === i ? { ...z, biome: e.target.value as typeof z.biome } : z)),
              }
              setDraft(next); onChange(next)
            }}>
            {Object.values(ZONE_TYPES).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input type="number" className="w-24 rounded bg-ocean-950 p-1" disabled={busy}
            value={zone.baseHp}
            onChange={(e) => setDraft((d) => ({
              ...d, zones: d.zones.map((z, j) => (j === i ? { ...z, baseHp: Number(e.target.value) } : z)),
            }))}
            onBlur={(e) => commitZoneHp(i, Number(e.target.value))} />
        </div>
      ))}
      <label className="text-sm text-ocean-300">
        Resources / turn
        <input type="number" className="mt-1 block w-full rounded bg-ocean-950 p-1" disabled={busy}
          min={MIN_MATERIALS_PER_TURN} max={MAX_MATERIALS_PER_TURN} step={5000}
          value={materialsPerTurnOf(draft)}
          onChange={(e) => setDraft((d) => ({ ...d, materialsPerTurn: Number(e.target.value) }))}
          onBlur={(e) => {
            const next = { ...draft, materialsPerTurn: Number(e.target.value) }
            setDraft(next); onChange(next)
          }} />
        <span className="mt-1 block text-xs text-ocean-400">
          × turn number — {shortHandNumber(materialsPerTurnOf(draft))} on turn 1
        </span>
      </label>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck and lint**

```bash
npm --prefix frontend run build
```

Expected: clean.

```bash
npm --prefix frontend run lint
```

Expected: clean.

- [ ] **Step 5: Run the full unit suite**

```bash
npx vitest run
```

Expected: all tests pass. Record the passing count.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LobbyPage.tsx frontend/src/App.tsx
git commit -m "feat(frontend): SC2-style lobby screen at /lobby/:id"
```

---

### Task 8: Slim down the lobby browser

**Files:**
- Modify: `frontend/src/pages/LobbiesPage.tsx`

**Interfaces:**
- Consumes: `lobbyAction` (Task 2); `BoardPreview` (Task 6); `useUsernames` from `../lib/games`.

- [ ] **Step 1: Strip what moved into the lobby**

In `frontend/src/pages/LobbiesPage.tsx`, remove:

- the local `lobbyAction` function (now imported from `../lib/lobbies`),
- the `deckId`, `joinDeckId` and `settings` state,
- the entire zone/base-HP/resources control block in the create form,
- the "Join with:" `<select>` and its wrapper,
- the whole `myLobby ? (...) : (...)` conditional's **first** branch (the inline lobby card), keeping the create form as the unconditional content.

- [ ] **Step 2: Rewrite create and join to navigate**

```tsx
  const createLobby = () => run(async () => {
    if (!me) throw new Error('Not signed in')
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 40) throw new Error('Name must be 1-40 characters')
    // No deck and default settings: both are chosen inside the lobby now.
    const { data, error: insertError } = await supabase.from('lobbies').insert({
      host_id: me, name: trimmed,
      settings: DEFAULT_LOBBY_SETTINGS as unknown as Database['public']['Tables']['lobbies']['Insert']['settings'],
    }).select().single()
    if (insertError) throw insertError
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
    navigate(`/lobby/${data.id}`)
  })

  const join = (lobby: LobbyRow) => run(async () => {
    await lobbyAction({ action: 'JOIN', lobbyId: lobby.id })
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
    navigate(`/lobby/${lobby.id}`)
  })
```

- [ ] **Step 3: Show the notice banner and a link back into your lobby**

Add near the top of the component:

```tsx
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
```

and render it under the `<h1>`, above the error line:

```tsx
      {notice && (
        <p className="mt-2 rounded border border-ocean-600 bg-ocean-900/60 p-2 text-ocean-300">{notice}</p>
      )}
```

Replace the removed inline lobby card with a link, so a player mid-lobby can get back:

```tsx
      {myLobby && (
        <section className="mt-4 rounded border border-brass-400 bg-ocean-900/60 p-4">
          <h2 className="font-display text-2xl">{myLobby.name}</h2>
          <p className="mt-1 text-ocean-300">You have a lobby in progress.</p>
          <Link to={`/lobby/${myLobby.id}`}
            className="mt-3 inline-block rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950">
            Return to lobby
          </Link>
        </section>
      )}
```

- [ ] **Step 4: Enrich the browser rows**

Add the username lookup beside the existing queries:

```tsx
  const { data: hostNames } = useUsernames((lobbies ?? []).map((l) => l.host_id))
```

and replace the `openLobbies.map(...)` list item body with:

```tsx
            <li key={l.id} className="flex items-center gap-4 rounded border border-ocean-600 bg-ocean-900/60 p-3">
              <span className="w-28 shrink-0">
                <BoardPreview settings={previewSettings(l.settings)} size="sm" />
              </span>
              <span className="flex-1">
                <span className="font-display text-lg">{l.name}</span>
                <span className="ml-3 text-sm text-ocean-300">
                  {hostNames?.get(l.host_id) ?? '…'}
                </span>
                <span className="ml-3 text-sm text-ocean-300">{settingsSummary(l.settings)}</span>
              </span>
              <span className="rounded-full bg-ocean-800 px-2 py-0.5 text-xs text-ocean-300">
                {l.guest_id ? '2/2' : '1/2'}
              </span>
              <button disabled={busy || !!myLobby || !!l.guest_id} onClick={() => join(l)}
                className="rounded bg-brass-400 px-3 py-1 font-bold text-ocean-950 disabled:opacity-50">
                Join
              </button>
            </li>
```

Add the helper beside the existing `settingsSummary`:

```tsx
// A row must render even if its settings blob is malformed — the preview is
// decoration, not a gate on browsing.
function previewSettings(settings: unknown): LobbySettings {
  const parsed = validateLobbySettings(settings)
  return 'errors' in parsed ? DEFAULT_LOBBY_SETTINGS : parsed.settings
}
```

- [ ] **Step 5: Fix up imports**

`LobbiesPage.tsx` should now import `Link`, `useLocation` and `useNavigate` from `react-router-dom`; `lobbyAction` from `../lib/lobbies`; `BoardPreview` from `../components/BoardPreview`; `useUsernames` from `../lib/games`. `FunctionsHttpError` and the `MAX_MATERIALS_PER_TURN`/`MIN_MATERIALS_PER_TURN`/`ZONE_TYPES` imports are no longer used — remove them.

- [ ] **Step 6: Typecheck, lint, test**

```bash
npm --prefix frontend run build
```

Expected: clean — this is what catches a stale import left behind by Step 1.

```bash
npm --prefix frontend run lint
```

Expected: clean.

```bash
npx vitest run
```

Expected: all tests pass, same count as Task 7 Step 5.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/LobbiesPage.tsx
git commit -m "feat(frontend): lobby browser shows seats and a board preview"
```

---

### Task 9: Two-player browser verification

The unit tests cover the branching and the smoke script covers the ops, but neither proves a guest's browser actually navigates itself onto the board. That needs two live sessions.

**Files:** none — verification only.

- [ ] **Step 1: Start the dev server**

Use the browser preview's `frontend` entry from `.claude/launch.json`. **Print the port it actually bound to** — Vite increments past 5173 whenever another worktree is already serving, and a session signed in on `localhost:5173` does not carry over to `localhost:5174`; the mismatch presents as a spurious auth failure rather than a wrong-port error.

- [ ] **Step 2: Get two signed-in sessions**

```bash
node scripts/qa-login.mjs
```

Run it in the background — it serves once and exits — then call `await window.__qaLogin()` in each of the two browser contexts. **Never type credentials into the sign-in form and never ask the user to log in.** Setup notes: docs/claude/testing.md.

- [ ] **Step 3: Walk the flow**

As the host: create a lobby from `/lobbies`, confirm you land on `/lobby/:id` with **no site nav bar** and a `← Harbor` link in its place. Pick a deck; press Ready.

As the guest: join from the browser list, confirm you land in the same lobby, pick a deck, press Ready.

- [ ] **Step 4: Verify the consent invariant in the UI**

As the host, change a zone's biome. Confirm the preview recolours **and** the guest's Ready pip drops to "Not ready" without a reload. Confirm the host's own pip stays green. Confirm Start is disabled.

- [ ] **Step 5: Verify auto-navigation (R-3)**

Guest readies again; host presses Start. **Both** windows must land on `/game/:id` with no further clicks. This is the requirement the whole plan exists for — take a screenshot of the guest's window on the board.

- [ ] **Step 6: Verify the kick path**

In a fresh lobby, host kicks the guest. The guest's window must land on `/lobbies` showing "You were removed from the lobby." — not a Join button.

- [ ] **Step 7: Check the console and report**

Read console messages and network requests for errors. Then report: the before→after passing test count from `npx vitest run`, the smoke script result, and the screenshot from Step 5.

---

## Notes for the executor

- **Task order matters.** 3 → 4 → 5 is a hard chain (migration, then function, then the harness that exercises it). Tasks 1, 2 and 6 are independent and can run at any point before 7. Tasks 7 and 8 need 2, 3 and 6.
- **The deploy window in spec §7 is real.** Between deploying Task 4 and shipping Task 8's frontend, a lobby created by the old UI cannot be started — its ready flags are `false` and the old UI cannot set them. Cancel and recreate. Do not "fix" this by loosening the START gate.
- **Deploy from a branch up to date with `main`,** so a production fix already on `main` is never regressed by a deploy from a stale branch.
