# Phase 4: Game Engine & Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully playable vanilla game: complete turn loop, card placement, zone activation, base attacks, out-of-band FTD battles (spawn sheet → report → mutual approval → repair economics), the 4 universal hero powers, moves, win/loss — server-authoritative via a `game-action` edge function, rendered on a live board UI.

**Architecture:** A pure reducer in `shared/engine/` — `applyAction(game, actorId, action)` operates on an `EngineGame` (public state + BOTH private states) and returns a new game or a typed error; it is deep-clone-pure and fully TDD'd. The `game-action` edge function is a thin I/O wrapper: auth → load rows → applyAction → optimistic-concurrency write (`version` check). The board UI reads public state + own private row (realtime-invalidated) and calls the function; legality hints client-side reuse small engine helpers. Card EFFECTS (registry) and faction hero powers are **Phase 5** — this phase plays every card as vanilla per spec §3.9's fallback rule, with ability cards resolving as pay + log.

**Tech Stack:** Existing stack. No new packages. No DB migrations (all new state lives in the `games.state` / `game_players` jsonb).

**Spec:** `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` §3 (all rules), §5 (game-action), §7 (board). Rules implemented here: 3.1–3.8 complete except card effects (3.9) and faction powers (3.8 faction list) — deferred to Phase 5 with the alert-card and targeting action variants that only effects need.

## Global Constraints

- Supabase ref `wpgsjnjnvykxavaxibld`, remote-only via MCP. `verify_jwt: false` deploys; platform prunes type-only-import files (expected). Manifest-driven sync + drift test (extend `supabase/functions/shared-manifest.json` for `game-action`).
- All tunables from `shared/gameSettings.ts` — never inlined. This phase consumes: MATERIALS_PER_TURN, BASE_DAMAGE_DIVISOR, STARTING_HAND_SIZE, SURVIVE_HP_PERCENT (90), REPAIR_WINDOW_MIN_PERCENT (80), REPAIR_COST_RATE (0.5), SPAWN_DISTANCE_DEFAULT_M (1200), SPAWN_DISTANCE_MIN_M (50), SPAWN_DISTANCE_MAX_M (2000), HERO_POWER_DISTANCE_MOD_M (600), IN_BATTLE_RESOURCE_RATE (0.1), KEYWORDS, ZONE_TYPES, VEHICLE_TYPES.
- Engine purity: `shared/engine/**` stays dependency-free, I/O-free; every handler TDD'd; `applyAction` never mutates its input (structuredClone at entry; Node 20 and Deno both have it).
- Rule decisions already made (implement as stated, do not re-litigate — recorded in the self-review notes): zone activation is once per zone per half-turn (lastActivatedTurn === turnNumber blocks); 1-turn delay = `playedOnTurn < turnNumber`; screens block PLAYING into a zone but not MOVING into it (biome legality only for moves); ability cards resolve vanilla (pay materials+CP, remove from hand, log "no effect yet — Phase 5"); destroyed vehicles append to `state.destroyed[side]` (Salvage draws from it; ability cards do NOT go there); repair cost `Math.ceil(materialCost × REPAIR_COST_RATE)`, 0 with scrappy, forbidden for fragile; repairs are paid by each vehicle's controller from their materials at approve time; materials persist through the opponent's half-turn (they reset at YOUR turn start); empty-deck draw = skip + log; a battle cancelled by all-stealthy-opt-out does NOT spend the zone activation; hero powers salvage/draw/rapidRedeployment are your-turn-only and blocked during battle freeze, tacticalPositioning is either-participant during an active battle before a report exists; MOVE_VEHICLE requires the mobile keyword and once-per-turn per vehicle (movedOnTurn); Rapid Redeployment moves any own vehicle regardless of mobile and also sets movedOnTurn; win = opponent loses 2+ zones (baseHp ≤ 0), checked after every base attack; CONCEDE always legal for participants of an active game.
- Old-BE action names map: PLAY_CARD_WITHOUT_TARGET → PLAY_ABILITY_CARD; SET_ALERT_CARD + PLAY_CARD_TARGETING_* deferred to Phase 5 (only effects consume them) — the spec §5 table is the full-engine vocabulary, completed across phases 4+5.
- Frontend gates: `cd frontend && npm run build` clean; root `npm test` green (counts per task). Context7 before novel supabase-js usage.
- Commit per task, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Windows; Bash tool (Git Bash). Test accounts: ftdtest2/`FtdPhase2Test!2026`, ftdtest3/`FtdPhase3Test!2026`. No pushes (controller finishes).

---

### Task 1: Engine state shapes — extend `PublicGameState` (TDD)

**Files:**
- Create: `shared/engine/engineTypes.ts`
- Modify: `shared/engine/gameInit.ts` (state gains new fields; zone card arrays typed as `ZoneCardEntry[]`), `shared/engine/gameInit.test.ts` (assert new fields)
- Test: (gameInit.test.ts updated)

**Interfaces:**
- Produces (every later task imports from `engineTypes.ts`):

```ts
import type { CardInstance, PublicGameState } from './gameInit.ts'

export type Side = 'a' | 'b'

export interface ZoneCardEntry extends CardInstance {
  playedOnTurn: number
  movedOnTurn: number | null
}

export interface AwaitingResponse {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  targetIds: string[]      // full defender selection, incl. stealthy
  stealthyIds: string[]    // subset the defender may opt out
}

export interface ActiveBattle {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  defenderIds: string[]
  distanceM: number
  distanceModifiedBy: Side[] // per-player: each side may apply Tactical Positioning once
}

export interface BattleReport {
  submittedBy: Side
  results: Record<string, number> // instanceId -> ending HP percent (0-100)
  repairs: string[]               // instanceIds their controllers will pay to repair
}

export interface PrivateState {
  hand: CardInstance[]
  deck: CardInstance[]
}

export interface EngineGame {
  id: string
  playerA: string
  playerB: string
  status: 'active' | 'complete' | 'abandoned'
  winnerId: string | null
  turnNumber: number
  activePlayer: string
  settings: { zones: { biome: string; baseHp: number }[] }
  state: PublicGameState
  privates: { a: PrivateState; b: PrivateState }
}

export type GameAction =
  | { type: 'END_TURN' }
  | { type: 'CONCEDE' }
  | { type: 'PLAY_CARD_TO_ZONE'; instanceId: string; zoneId: number }
  | { type: 'PLAY_ABILITY_CARD'; instanceId: string }
  | { type: 'MOVE_VEHICLE'; instanceId: string; zoneId: number }
  | { type: 'ATTACK_ENEMY_BASE'; zoneId: number }
  | { type: 'ATTACK_ENEMY_FLEET'; zoneId: number; attackerIds: string[]; targetIds: string[] }
  | { type: 'RESPOND_TO_ATTACK'; optOutIds: string[] }
  | { type: 'SUBMIT_BATTLE_REPORT'; results: Record<string, number>; repairs: string[] }
  | { type: 'DECIDE_BATTLE_REPORT'; approve: boolean }
  | {
      type: 'USE_HERO_POWER'
      power: 'salvage' | 'tacticalPositioning' | 'draw' | 'rapidRedeployment'
      cardId?: string       // salvage: which destroyed card
      instanceId?: string   // rapidRedeployment: which vehicle
      zoneId?: number       // rapidRedeployment: destination
      distanceDeltaM?: number // tacticalPositioning: ±meters
    }

export type ApplyResult = { ok: true; game: EngineGame } | { ok: false; status: number; error: string }
```

- [ ] **Step 1: Write `engineTypes.ts`** exactly as above (with the `import type` line first).

- [ ] **Step 2: Extend `PublicGameState` in `gameInit.ts`.** Change the interface and initial construction:
  - `zones` stays `ZoneState[]` but `ZoneState.cards` becomes `{ a: ZoneCardEntry[]; b: ZoneCardEntry[] }` — move the `ZoneCardEntry` shape into gameInit? NO: to avoid an import cycle, keep `ZoneState.cards` typed as before (`CardInstance[]`) in gameInit and have `engineTypes.ts` narrow it. Concretely: in `gameInit.ts` change nothing about the zone type, and in `engineTypes.ts` (already written above) `ZoneCardEntry` extends `CardInstance`. Zone card arrays start empty so init needs no data change for them.
  - ADD to `PublicGameState` and to the constructed state in `buildInitialGame`:
    ```ts
    destroyed: { a: SnapshotCard[]; b: SnapshotCard[] }
    awaitingResponse: null   // typed: AwaitingResponse | null — declare as `unknown | null`? NO:
    ```
    To keep gameInit dependency-clean, declare the three battle fields in `PublicGameState` structurally:
    ```ts
    awaitingResponse: {
      zoneId: number; aggressor: 'a' | 'b'
      attackerIds: string[]; targetIds: string[]; stealthyIds: string[]
    } | null
    activeBattle: {
      zoneId: number; aggressor: 'a' | 'b'
      attackerIds: string[]; defenderIds: string[]
      distanceM: number; distanceModifiedBy: ('a' | 'b')[]
    } | null
    pendingReport: {
      submittedBy: 'a' | 'b'; results: Record<string, number>; repairs: string[]
    } | null
    destroyed: { a: SnapshotCard[]; b: SnapshotCard[] }
    ```
    (replacing the previous `activeBattle: null` / `pendingReport: null` literal-null fields) and initialize `awaitingResponse: null, activeBattle: null, pendingReport: null, destroyed: { a: [], b: [] }` in `buildInitialGame`.

- [ ] **Step 3: Update `gameInit.test.ts`** — in the 'deals 5, leaves 15' test add:

```ts
    expect(game.state.destroyed).toEqual({ a: [], b: [] })
    expect(game.state.awaitingResponse).toBeNull()
    expect(game.state.activeBattle).toBeNull()
    expect(game.state.pendingReport).toBeNull()
```

- [ ] **Step 4: Migration — `apply_action_tx`.** Create `supabase/migrations/20260825000006_apply_action_tx.sql` (exact content) and apply remotely via MCP `apply_migration` (name `apply_action_tx`):

```sql
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
```

Regenerate `frontend/src/lib/database.types.ts` afterwards (the RPC appears in Functions).

- [ ] **Step 5: Gates + lobby-action redeploy.** `npm test` FIRST — expect exactly ONE red: the drift test's `lobby-action/shared/engine/gameInit.ts` byte-comparison (you edited the source). Then `npm run functions:sync && npm test` → all 45 green. Then **REDEPLOY `lobby-action`** (same 6-file payload as Phase 3, `verify_jwt: false`) so newly created games carry the new state fields — without this, games started by the live function lack `awaitingResponse`/`destroyed` and (belt-and-braces: game-action also normalizes, Task 8). Re-run its two smoke checks. `cd frontend && npm run build` (GameStubPage tolerates the additive fields).

- [ ] **Step 6: Commit** (include the synced copy + migration + regenerated types)

```bash
git add shared/engine/ supabase/functions/lobby-action/shared/ supabase/migrations/ frontend/src/lib/database.types.ts && git commit -m "feat(engine): battle-ready state shapes, action types, atomic action RPC"
```

---

### Task 2: Dispatcher, guards, END_TURN, CONCEDE (TDD)

**Files:**
- Create: `shared/engine/gameEngine.ts`, `shared/engine/testFixtures.ts`
- Test: `shared/engine/gameEngine.test.ts`

**Interfaces:**
- Produces: `applyAction(game: EngineGame, actorId: string, action: GameAction): ApplyResult`; helpers exported for later tasks and the UI: `sideOf(game, playerId): Side | null`, `otherSide(side): Side`, `zoneById(state, zoneId)`, `findVehicle(state, instanceId): { zone, side, entry, index } | null`, `battleFrozen(state): boolean`, `zonesLostBy(game, side): number`. Fixture: `makeGame(overrides?)` building a minimal valid EngineGame (used by ALL later engine tests).

- [ ] **Step 1: Fixtures** — `shared/engine/testFixtures.ts`:

```ts
import type { CardInstance, SnapshotCard } from './gameInit.ts'
import type { EngineGame, ZoneCardEntry } from './engineTypes.ts'

let counter = 0
export const nextId = (): string => `t-${counter++}`

export function snap(over: Partial<SnapshotCard> = {}): SnapshotCard {
  return {
    cardId: `card-${counter++}`, name: 'Test Vehicle', isBuiltIn: true, ownerId: null,
    faction: 'DWG', type: 'vehicle', vehicleType: 'ship',
    blueprintCost: 40000, materialCost: 40000, cpCost: 0,
    cardText: '', imageUrl: '', keywords: [], meta: {},
    ...over,
  }
}

export function inst(over: Partial<CardInstance> = {}): CardInstance {
  return { ...snap(over), instanceId: over.instanceId ?? nextId() }
}

export function zoneEntry(over: Partial<ZoneCardEntry> = {}): ZoneCardEntry {
  return { ...inst(over), playedOnTurn: over.playedOnTurn ?? 0, movedOnTurn: over.movedOnTurn ?? null }
}

export function makeGame(over: Partial<EngineGame> = {}): EngineGame {
  const base: EngineGame = {
    id: 'g1', playerA: 'alice', playerB: 'bob',
    status: 'active', winnerId: null,
    turnNumber: 2, activePlayer: 'alice',
    settings: {
      zones: [
        { biome: 'water', baseHp: 1000 },
        { biome: 'beach', baseHp: 1000 },
        { biome: 'land', baseHp: 1000 },
      ],
    },
    state: {
      zones: [1, 2, 3].map((id) => ({
        id, biome: id === 1 ? 'water' : id === 2 ? 'beach' : 'land',
        baseHp: { a: 1000, b: 1000 },
        cards: { a: [], b: [] },
        lastActivatedTurn: null,
      })),
      resources: { a: { materials: 100000, cp: 3 }, b: { materials: 100000, cp: 3 } },
      counts: { a: { hand: 0, deck: 0 }, b: { hand: 0, deck: 0 } },
      usedHeroPowers: { a: [], b: [] },
      awaitingResponse: null, activeBattle: null, pendingReport: null,
      destroyed: { a: [], b: [] },
      log: [],
    },
    privates: { a: { hand: [], deck: [] }, b: { hand: [], deck: [] } },
    ...over,
  }
  // sync counts with any provided hands/decks
  base.state.counts = {
    a: { hand: base.privates.a.hand.length, deck: base.privates.a.deck.length },
    b: { hand: base.privates.b.hand.length, deck: base.privates.b.deck.length },
  }
  return base
}
```

- [ ] **Step 2: Failing tests** — `shared/engine/gameEngine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction, normalizeState } from './gameEngine'
import { inst, makeGame, zoneEntry } from './testFixtures'

describe('guards', () => {
  it('rejects non-participants and finished games', () => {
    const g = makeGame()
    expect(applyAction(g, 'mallory', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 403 })
    const done = makeGame({ status: 'complete' })
    expect(applyAction(done, 'alice', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
  it('rejects turn actions from the non-active player', () => {
    const g = makeGame() // alice active
    expect(applyAction(g, 'bob', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
  it('never mutates its input', () => {
    const g = makeGame()
    const before = JSON.stringify(g)
    applyAction(g, 'alice', { type: 'END_TURN' })
    expect(JSON.stringify(g)).toBe(before)
  })
  it('freezes non-battle actions during a battle', () => {
    const g = makeGame()
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1200, distanceModifiedBy: null,
    }
    expect(applyAction(g, 'alice', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('END_TURN', () => {
  it('advances 0.5, flips active player, SETS (not adds) income, draws', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.privates.b.deck = [inst(), inst()]
    g.state.counts.b.deck = 2
    g.state.resources.b.materials = 12345 // sentinel: must be REPLACED, not added to
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.turnNumber).toBe(2.5)
    expect(r.game.activePlayer).toBe('bob')
    expect(r.game.state.resources.b.materials).toBe(100000) // floor(2.5) * 50k exactly
    expect(r.game.privates.b.hand).toHaveLength(1)
    expect(r.game.state.counts.b).toEqual({ hand: 1, deck: 1 })
  })
  it('culls temporary vehicles from both sides at turn start', () => {
    const g = makeGame()
    g.state.zones[0].cards.a.push(zoneEntry({ keywords: ['temporary'], playedOnTurn: 2 }))
    g.state.zones[0].cards.b.push(zoneEntry({}))
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
    expect(r.game.state.zones[0].cards.b).toHaveLength(1)
    expect(r.game.state.destroyed.a).toHaveLength(1) // culled temporaries are destroyed (salvageable)
  })
  it('skips the draw on an empty deck and logs it', () => {
    const g = makeGame()
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toHaveLength(0)
    expect(r.game.state.log.some((l) => l.includes('no cards left'))).toBe(true)
  })
})

describe('CONCEDE', () => {
  it('ends the game with the other player winning, from either seat, even off-turn', () => {
    const g = makeGame()
    const r = applyAction(g, 'bob', { type: 'CONCEDE' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.status).toBe('complete')
    expect(r.game.winnerId).toBe('alice')
  })
})

describe('normalizeState', () => {
  it('fills fields missing from pre-Phase-4 game rows', () => {
    const g = makeGame()
    const legacy = g.state as unknown as Record<string, unknown>
    delete legacy.awaitingResponse
    delete legacy.destroyed
    legacy.activeBattle = undefined
    ;(g.state.zones[0].cards.a as unknown[]).push({ ...inst() }) // no playedOnTurn
    normalizeState(g.state)
    expect(g.state.awaitingResponse).toBeNull()
    expect(g.state.activeBattle).toBeNull()
    expect(g.state.destroyed).toEqual({ a: [], b: [] })
    expect((g.state.zones[0].cards.a[0] as { playedOnTurn: number }).playedOnTurn).toBe(0)
    // normalized state passes the frozen check
    expect(applyAction(g, 'alice', { type: 'END_TURN' }).ok).toBe(true)
  })
})
```

- [ ] **Step 3: `npm test`** → RED.

- [ ] **Step 4: Implement** — `shared/engine/gameEngine.ts`:

```ts
import { KEYWORDS, MATERIALS_PER_TURN } from '../gameSettings.ts'
import type { PublicGameState } from './gameInit.ts'
import type {
  ApplyResult, EngineGame, GameAction, Side, ZoneCardEntry,
} from './engineTypes.ts'

export function sideOf(game: EngineGame, playerId: string): Side | null {
  if (playerId === game.playerA) return 'a'
  if (playerId === game.playerB) return 'b'
  return null
}

export const otherSide = (side: Side): Side => (side === 'a' ? 'b' : 'a')

export function zoneById(state: PublicGameState, zoneId: number) {
  return state.zones.find((z) => z.id === zoneId) ?? null
}

export function findVehicle(state: PublicGameState, instanceId: string) {
  for (const zone of state.zones) {
    for (const side of ['a', 'b'] as Side[]) {
      const index = zone.cards[side].findIndex((c) => c.instanceId === instanceId)
      if (index >= 0) {
        return { zone, side, entry: zone.cards[side][index] as ZoneCardEntry, index }
      }
    }
  }
  return null
}

export const battleFrozen = (state: PublicGameState): boolean =>
  state.awaitingResponse !== null || state.activeBattle !== null || state.pendingReport !== null

export function zonesLostBy(game: EngineGame, side: Side): number {
  return game.state.zones.filter((z) => z.baseHp[side] <= 0).length
}

const BATTLE_ACTIONS = new Set<GameAction['type']>([
  'RESPOND_TO_ATTACK', 'SUBMIT_BATTLE_REPORT', 'DECIDE_BATTLE_REPORT', 'CONCEDE', 'USE_HERO_POWER',
])

const OFF_TURN_ACTIONS = new Set<GameAction['type']>([
  'CONCEDE', 'RESPOND_TO_ATTACK', 'SUBMIT_BATTLE_REPORT', 'DECIDE_BATTLE_REPORT', 'USE_HERO_POWER',
])

export const err = (status: number, error: string): ApplyResult => ({ ok: false, status, error })

// Handler registry — later modules add entries via registerHandler.
type Handler = (game: EngineGame, actor: Side, action: GameAction) => ApplyResult
const handlers = new Map<GameAction['type'], Handler>()
export function registerHandler(type: GameAction['type'], handler: Handler) {
  handlers.set(type, handler)
}

// Defensive shape-repair for rows created before this phase (or by an older
// deployed lobby-action): missing fields become their empty defaults so the
// freeze check and handlers never trip over `undefined`.
export function normalizeState(state: PublicGameState): void {
  const s = state as unknown as Record<string, unknown>
  if (s.awaitingResponse === undefined) s.awaitingResponse = null
  if (s.activeBattle === undefined) s.activeBattle = null
  if (s.pendingReport === undefined) s.pendingReport = null
  if (s.destroyed === undefined) s.destroyed = { a: [], b: [] }
  for (const zone of state.zones) {
    for (const side of ['a', 'b'] as Side[]) {
      for (const entry of zone.cards[side] as Partial<ZoneCardEntry>[]) {
        if (entry.playedOnTurn === undefined) entry.playedOnTurn = 0
        if (entry.movedOnTurn === undefined) entry.movedOnTurn = null
      }
    }
  }
}

export function drawCard(game: EngineGame, side: Side): void {
  const priv = game.privates[side]
  const card = priv.deck.shift()
  if (!card) {
    game.state.log.push(`Player ${side.toUpperCase()} has no cards left to draw`)
  } else {
    priv.hand.push(card)
  }
  game.state.counts[side] = { hand: priv.hand.length, deck: priv.deck.length }
}

export function checkVictory(game: EngineGame): void {
  for (const side of ['a', 'b'] as Side[]) {
    if (zonesLostBy(game, side) >= 2 && game.status === 'active') {
      game.status = 'complete'
      game.winnerId = side === 'a' ? game.playerB : game.playerA
      game.state.log.push(`Player ${otherSide(side).toUpperCase()} wins — two zones fell`)
    }
  }
}

function endTurn(game: EngineGame): ApplyResult {
  game.turnNumber = Math.round((game.turnNumber + 0.5) * 10) / 10
  const incoming = game.activePlayer === game.playerA ? game.playerB : game.playerA
  game.activePlayer = incoming
  const side = sideOf(game, incoming) as Side
  // Cull temporaries from BOTH sides at every turn start (spec §3.2/§3.7).
  for (const zone of game.state.zones) {
    for (const s of ['a', 'b'] as Side[]) {
      const keep: ZoneCardEntry[] = []
      for (const entry of zone.cards[s] as ZoneCardEntry[]) {
        if (entry.keywords.includes(KEYWORDS.TEMPORARY)) {
          const { instanceId: _instanceId, playedOnTurn: _p, movedOnTurn: _m, ...snapshot } = entry
          game.state.destroyed[s].push(snapshot)
          game.state.log.push(`${entry.name} despawned (temporary)`)
        } else {
          keep.push(entry)
        }
      }
      zone.cards[s] = keep
    }
  }
  game.state.resources[side].materials = Math.floor(game.turnNumber) * MATERIALS_PER_TURN
  drawCard(game, side)
  game.state.log.push(`Turn ${game.turnNumber} — player ${side.toUpperCase()} to act`)
  return { ok: true, game }
}

function concede(game: EngineGame, actor: Side): ApplyResult {
  game.status = 'complete'
  game.winnerId = actor === 'a' ? game.playerB : game.playerA
  game.state.log.push(`Player ${actor.toUpperCase()} conceded`)
  return { ok: true, game }
}

export function applyAction(input: EngineGame, actorId: string, action: GameAction): ApplyResult {
  const game = structuredClone(input)
  const actor = sideOf(game, actorId)
  if (!actor) return err(403, 'You are not in this game')
  if (game.status !== 'active') return err(409, 'Game is over')
  if (battleFrozen(game.state) && !BATTLE_ACTIONS.has(action.type)) {
    return err(409, 'A battle is in progress — resolve it first')
  }
  if (!OFF_TURN_ACTIONS.has(action.type) && game.activePlayer !== actorId) {
    return err(409, 'Not your turn')
  }
  if (action.type === 'END_TURN') return endTurn(game)
  if (action.type === 'CONCEDE') return concede(game, actor)
  const handler = handlers.get(action.type)
  if (!handler) return err(400, `Unknown or not-yet-supported action: ${action.type}`)
  return handler(game, actor, action)
}
```

- [ ] **Step 5: `npm test`** → GREEN (45 prior + 9 new = 54).

- [ ] **Step 6: Commit**

```bash
git add shared/engine/ && git commit -m "feat(engine): action dispatcher with turn loop and concede"
```

---

### Task 3: Placement + the Half-Cost economy (TDD)

**Files:**
- Create: `shared/engine/placement.ts`, `shared/engine/index.ts`
- Modify: `shared/engine/gameEngine.test.ts` (import from `./index` instead of `./gameEngine` — mechanical), `shared/customCards.ts` + `shared/customCards.test.ts` (computeMaterialCost stops pre-halving planes), `supabase/functions/create-card/shared/customCards.ts` (via sync)
- Test: `shared/engine/placement.test.ts`

**Interfaces:**
- Produces: registered handlers; exported helpers `legalZonesFor(state, side, card): number[]`, `canAfford(state, side, card): boolean`, and **`effectiveMaterialCostOf(card): number`** — THE material cost everywhere the engine spends or measures cost (play price, base damage, repair, in-battle resources). Half-Cost halves (floor). Tasks 4, 6, 10-12 import it.

**Half-Cost ruling (spec §3.7):** the flier discount lives in the ENGINE via `effectiveMaterialCostOf`, never baked into stored `material_cost`. Seed data proves built-ins are NOT pre-halved (Albacore 249522→240000). Phase 2's create-card DID pre-halve custom planes — corrected here: `computeMaterialCost` in `shared/customCards.ts` becomes rounding-only (delete the plane branch; update its test: plane 40205 → 45000 and 5000 → 5000, keyword does the halving at play time), run `npm run functions:sync`, **REDEPLOY `create-card`** (same payload as Phase 3, `verify_jwt: false`, smoke: unauth POST → 401), and repair any pre-halved custom planes with one `execute_sql`: `update public.cards set material_cost = (ceil(blueprint_cost / 5000.0) * 5000)::int where is_built_in = false and vehicle_type = 'plane';` (report rows affected — probably 0).

Rules: vehicle placement by biome (ship/sub → water|beach; tank → beach|land; plane/airship → any) minus enemy screens (airScreen blocks plane+airship, subScreen blocks sub — PLAYING only); cost = effectiveMaterialCost + cpCost (both must afford); the placed entry gains `playedOnTurn: turnNumber, movedOnTurn: null`; counts update. Ability cards: pay effectiveMaterialCost + cpCost, remove from hand, log `"<name> resolved (no effect yet — effects arrive in Phase 5)"`.

- [ ] **Step 1: Failing tests** — `shared/engine/placement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction, effectiveMaterialCostOf, legalZonesFor } from './index'
import { inst, makeGame, zoneEntry } from './testFixtures'

function withHand(cardOver: Record<string, unknown>) {
  const g = makeGame()
  const card = inst(cardOver)
  g.privates.a.hand = [card]
  g.state.counts.a.hand = 1
  return { g, card }
}

describe('PLAY_CARD_TO_ZONE', () => {
  it('places a ship into water, pays, stamps playedOnTurn', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 40000 })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a[0]).toMatchObject({
      instanceId: card.instanceId, playedOnTurn: 2, movedOnTurn: null,
    })
    expect(r.game.state.resources.a.materials).toBe(60000)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.counts.a.hand).toBe(0)
  })
  it('enforces biome legality', () => {
    const { g, card } = withHand({ vehicleType: 'tank' })
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
    expect(legalZonesFor(g.state, 'a', card)).toEqual([2, 3])
  })
  it('enforces enemy screens for playing (air + sub)', () => {
    const { g, card } = withHand({ vehicleType: 'plane', materialCost: 10000 })
    g.state.zones[0].cards.b.push(zoneEntry({ keywords: ['airScreen'] }))
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
    expect(legalZonesFor(g.state, 'a', card)).toEqual([2, 3])
    const { g: g2, card: sub } = withHand({ vehicleType: 'sub' })
    g2.state.zones[0].cards.b.push(zoneEntry({ keywords: ['subScreen'] }))
    expect(legalZonesFor(g2.state, 'a', sub)).toEqual([2])
  })
  it('rejects unaffordable and unknown cards', () => {
    const { g, card } = withHand({ materialCost: 999999 })
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ghost', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('pays CP when the card costs CP', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 1000, cpCost: 2 })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.a.cp).toBe(1)
  })
  it('halfCost halves the bill (spec §3.7 flier rule)', () => {
    expect(effectiveMaterialCostOf(inst({ materialCost: 240000, keywords: ['halfCost'] }))).toBe(120000)
    expect(effectiveMaterialCostOf(inst({ materialCost: 240000 }))).toBe(240000)
    const { g, card } = withHand({ vehicleType: 'plane', materialCost: 150000, keywords: ['halfCost'] })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.a.materials).toBe(25000) // 100000 - 75000
  })
})

describe('PLAY_ABILITY_CARD', () => {
  it('pays, discards, and logs the vanilla note', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, cpCost: 1, name: 'Rally' })
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.log.some((l) => l.includes('no effect yet'))).toBe(true)
    expect(r.game.state.destroyed.a).toHaveLength(0)
  })
  it('rejects playing a vehicle via the ability action', () => {
    const { g, card } = withHand({ type: 'vehicle', vehicleType: 'ship' })
    expect(applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })
})
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement** — `shared/engine/placement.ts`:

```ts
import { KEYWORDS, VEHICLE_TYPES, ZONE_TYPES } from '../gameSettings.ts'
import type { CardInstance, PublicGameState } from './gameInit.ts'
import type { EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { err, otherSide, registerHandler } from './gameEngine.ts'

const BIOMES_BY_TYPE: Record<string, string[]> = {
  [VEHICLE_TYPES.SHIP]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH],
  [VEHICLE_TYPES.SUB]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH],
  [VEHICLE_TYPES.TANK]: [ZONE_TYPES.BEACH, ZONE_TYPES.LAND],
  [VEHICLE_TYPES.PLANE]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH, ZONE_TYPES.LAND],
  [VEHICLE_TYPES.AIRSHIP]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH, ZONE_TYPES.LAND],
}

export function biomeAllows(vehicleType: string | null, biome: string): boolean {
  return vehicleType !== null && (BIOMES_BY_TYPE[vehicleType] ?? []).includes(biome)
}

function screenBlocks(state: PublicGameState, side: Side, zoneId: number, vehicleType: string): boolean {
  const zone = state.zones.find((z) => z.id === zoneId)
  if (!zone) return true
  const enemy = zone.cards[otherSide(side)]
  const isAir = vehicleType === VEHICLE_TYPES.PLANE || vehicleType === VEHICLE_TYPES.AIRSHIP
  if (isAir && enemy.some((c) => c.keywords.includes(KEYWORDS.AIR_SCREEN))) return true
  if (vehicleType === VEHICLE_TYPES.SUB && enemy.some((c) => c.keywords.includes(KEYWORDS.SUB_SCREEN))) return true
  return false
}

export function legalZonesFor(state: PublicGameState, side: Side, card: CardInstance): number[] {
  if (card.type !== 'vehicle' || card.vehicleType === null) return []
  return state.zones
    .filter((z) => biomeAllows(card.vehicleType, z.biome) && !screenBlocks(state, side, z.id, card.vehicleType!))
    .map((z) => z.id)
}

// Spec §3.7 Half-Cost: the discount is applied at usage time, never baked
// into stored material_cost (seed data and create-card both store full cost).
export function effectiveMaterialCostOf(card: { materialCost: number; keywords: string[] }): number {
  return card.keywords.includes(KEYWORDS.HALF_COST)
    ? Math.floor(card.materialCost / 2)
    : card.materialCost
}

export function canAfford(state: PublicGameState, side: Side, card: CardInstance): boolean {
  return (
    state.resources[side].materials >= effectiveMaterialCostOf(card) &&
    state.resources[side].cp >= card.cpCost
  )
}

function takeFromHand(game: EngineGame, side: Side, instanceId: string): CardInstance | null {
  const hand = game.privates[side].hand
  const index = hand.findIndex((c) => c.instanceId === instanceId)
  if (index < 0) return null
  const [card] = hand.splice(index, 1)
  game.state.counts[side].hand = hand.length
  return card
}

function pay(game: EngineGame, side: Side, card: CardInstance): void {
  game.state.resources[side].materials -= effectiveMaterialCostOf(card)
  game.state.resources[side].cp -= card.cpCost
}

registerHandler('PLAY_CARD_TO_ZONE', (game, actor, action) => {
  if (action.type !== 'PLAY_CARD_TO_ZONE') return err(400, 'Bad action')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')
  if (card.type !== 'vehicle') return err(400, 'Ability cards are played without a zone')
  if (!canAfford(game.state, actor, card)) return err(400, 'You cannot afford that card')
  if (!legalZonesFor(game.state, actor, card).includes(action.zoneId)) {
    return err(400, 'That vehicle cannot deploy to that zone')
  }
  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)
  const entry: ZoneCardEntry = { ...card, playedOnTurn: game.turnNumber, movedOnTurn: null }
  game.state.zones.find((z) => z.id === action.zoneId)!.cards[actor].push(entry)
  game.state.log.push(`${card.name} deployed to zone ${action.zoneId}`)
  return { ok: true, game }
})

registerHandler('PLAY_ABILITY_CARD', (game, actor, action) => {
  if (action.type !== 'PLAY_ABILITY_CARD') return err(400, 'Bad action')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')
  if (card.type !== 'ability') return err(400, 'Vehicles must target a zone')
  if (!canAfford(game.state, actor, card)) return err(400, 'You cannot afford that card')
  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)
  game.state.log.push(`${card.name} resolved (no effect yet — effects arrive in Phase 5)`)
  return { ok: true, game }
})
```

Then create `shared/engine/index.ts` — the single entry point that aggregates exports AND triggers handler registration (gameEngine.ts itself never imports handler modules, avoiding cycles):

```ts
export * from './gameEngine.ts'
export * from './placement.ts'
import './placement.ts'
```

All consumers (edge function, UI, engine tests) import from `./index` — update `gameEngine.test.ts`'s import line to `from './index'` (mechanical; its own assertions don't change). Later tasks append their module's two lines (`export * from` + side-effect `import`) here.

- [ ] **Step 4: GREEN** — engine tests 54 + 8 = 62; the full suite also reflects the `customCards.test.ts` expectation updates (count there unchanged). Complete the Half-Cost ruling's remaining steps now: functions:sync, create-card redeploy + smoke, the custom-plane repair SQL.

- [ ] **Step 5: Commit**

```bash
git add shared/ supabase/functions/create-card/shared/ && git commit -m "feat(engine): placement rules and the half-cost economy"
```

---

### Task 4: Zone activation — ATTACK_ENEMY_BASE (TDD)

**Files:**
- Create: `shared/engine/baseAttack.ts`
- Modify: `shared/engine/index.ts` (add `export * from './baseAttack.ts'` + `import './baseAttack.ts'`)
- Test: `shared/engine/baseAttack.test.ts`

Rules: actor must have ≥1 vehicle in the zone; zone not yet activated this half-turn (`lastActivatedTurn !== turnNumber`); enemy base not already destroyed (`baseHp[enemy] > 0`); illegal if ANY enemy vehicle in the zone has blocker. Damage = Σ `floor(materialCost / BASE_DAMAGE_DIVISOR)` over actor vehicles that are: not sub, not inoffensive, `playedOnTurn < turnNumber`. Zero eligible damage → still legal? RULING: reject with 400 'No vehicles able to strike' (avoids wasting the activation). Apply damage, set `lastActivatedTurn = turnNumber`, log, `checkVictory`.

- [ ] **Step 1: Failing tests** — `shared/engine/baseAttack.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction } from './index'
import { makeGame, zoneEntry } from './testFixtures'

function armed(over: Record<string, unknown> = {}) {
  const g = makeGame({ turnNumber: 3 })
  g.state.zones[0].cards.a.push(zoneEntry({ materialCost: 40000, playedOnTurn: 2, ...over }))
  return g
}

describe('ATTACK_ENEMY_BASE', () => {
  it('deals floor(cost/1000) per eligible vehicle and spends the activation', () => {
    const g = armed()
    g.state.zones[0].cards.a.push(zoneEntry({ materialCost: 15500, playedOnTurn: 2 }))
    const r = applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 40 - 15)
    expect(r.game.state.zones[0].lastActivatedTurn).toBe(3)
    expect(applyAction(r.game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 409 }) // once per half-turn
  })
  it('excludes subs, inoffensive, and freshly played vehicles', () => {
    const g = makeGame({ turnNumber: 3 })
    g.state.zones[0].cards.a.push(
      zoneEntry({ vehicleType: 'sub', playedOnTurn: 1 }),
      zoneEntry({ keywords: ['inoffensive'], playedOnTurn: 1 }),
      zoneEntry({ playedOnTurn: 3 }),
    )
    expect(applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 }) // nothing eligible
  })
  it('is blocked by an enemy blocker and by a destroyed base', () => {
    const g = armed()
    g.state.zones[0].cards.b.push(zoneEntry({ keywords: ['blocker'] }))
    expect(applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
    const g2 = armed()
    g2.state.zones[0].baseHp.b = 0
    expect(applyAction(g2, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('completes the game when a second zone falls', () => {
    const g = armed({ materialCost: 500000 }) // 500 damage
    g.state.zones[0].baseHp.b = 300
    g.state.zones[1].baseHp.b = 0 // already lost
    const r = applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.status).toBe('complete')
    expect(r.game.winnerId).toBe('alice')
  })
  it('requires presence in the zone', () => {
    const g = makeGame({ turnNumber: 3 })
    expect(applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('halfCost vehicles strike at their effective (halved) weight', () => {
    const g = armed({ materialCost: 80000, keywords: ['halfCost'] })
    const r = applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 40) // floor(40000/1000)
  })
})
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement** — `shared/engine/baseAttack.ts`:

```ts
import { BASE_DAMAGE_DIVISOR, KEYWORDS, VEHICLE_TYPES } from '../gameSettings.ts'
import type { ZoneCardEntry } from './engineTypes.ts'
import { checkVictory, err, otherSide, registerHandler, zoneById } from './gameEngine.ts'
import { effectiveMaterialCostOf } from './placement.ts'

export function baseDamageFrom(entries: ZoneCardEntry[], turnNumber: number): number {
  return entries
    .filter(
      (c) =>
        c.vehicleType !== VEHICLE_TYPES.SUB &&
        !c.keywords.includes(KEYWORDS.INOFFENSIVE) &&
        c.playedOnTurn < turnNumber,
    )
    .reduce((sum, c) => sum + Math.floor(effectiveMaterialCostOf(c) / BASE_DAMAGE_DIVISOR), 0)
}

registerHandler('ATTACK_ENEMY_BASE', (game, actor, action) => {
  if (action.type !== 'ATTACK_ENEMY_BASE') return err(400, 'Bad action')
  const zone = zoneById(game.state, action.zoneId)
  if (!zone) return err(400, 'No such zone')
  const enemy = otherSide(actor)
  if (zone.cards[actor].length === 0) return err(400, 'You have no vehicles in that zone')
  if (zone.lastActivatedTurn === game.turnNumber) return err(409, 'That zone was already activated this turn')
  if (zone.baseHp[enemy] <= 0) return err(400, 'That base is already destroyed')
  if (zone.cards[enemy].some((c) => c.keywords.includes(KEYWORDS.BLOCKER))) {
    return err(400, 'An enemy Blocker protects that base')
  }
  const damage = baseDamageFrom(zone.cards[actor] as ZoneCardEntry[], game.turnNumber)
  if (damage <= 0) return err(400, 'No vehicles able to strike (subs, inoffensive, and fresh deployments cannot)')
  zone.lastActivatedTurn = game.turnNumber
  zone.baseHp[enemy] = Math.max(0, zone.baseHp[enemy] - damage)
  game.state.log.push(`Zone ${zone.id}: base bombardment for ${damage} (${zone.baseHp[enemy]} HP remains)`)
  if (zone.baseHp[enemy] === 0) game.state.log.push(`Zone ${zone.id} has fallen`)
  checkVictory(game)
  return { ok: true, game }
})
```

- [ ] **Step 4: GREEN** (62 + 6 = 68). **Step 5: Commit** `feat(engine): base attacks with eligibility and victory check` (same `git add shared/engine/` + trailer pattern).

---

### Task 5: Fleet battles — declare + stealthy response (TDD)

**Files:**
- Create: `shared/engine/battleDeclare.ts`
- Modify: `shared/engine/index.ts` (wire like prior tasks)
- Test: `shared/engine/battleDeclare.test.ts`

Rules: ATTACK_ENEMY_FLEET — actor's turn, zone has actor vehicles, `lastActivatedTurn !== turnNumber`, ≥1 attackerId (all actor's, in-zone, none inoffensive), ≥1 targetId (all enemy's, in-zone). If any target has stealthy → set `awaitingResponse` (zone NOT yet activated; battle not locked). Else lock immediately: `activeBattle` with `SPAWN_DISTANCE_DEFAULT_M`, spend activation. RESPOND_TO_ATTACK — only the defender while awaitingResponse; `optOutIds ⊆ stealthyIds`; remaining targets = targetIds − optOutIds; if empty → cancel (log, clear awaitingResponse, activation NOT spent); else lock activeBattle with the remaining targets + spend activation.

- [ ] **Step 1: Failing tests** — `shared/engine/battleDeclare.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction } from './index'
import { makeGame, zoneEntry } from './testFixtures'

function battleground() {
  const g = makeGame({ turnNumber: 3 })
  const atk = zoneEntry({ playedOnTurn: 2 })
  const def = zoneEntry({})
  g.state.zones[0].cards.a.push(atk)
  g.state.zones[0].cards.b.push(def)
  return { g, atk, def }
}

describe('ATTACK_ENEMY_FLEET', () => {
  it('locks a battle at default distance and spends the activation', () => {
    const { g, atk, def } = battleground()
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [def.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle).toMatchObject({
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
    })
    expect(r.game.state.zones[0].lastActivatedTurn).toBe(3)
  })
  it('rejects inoffensive attackers, foreign ids, and empty selections', () => {
    const { g, def } = battleground()
    const ino = zoneEntry({ keywords: ['inoffensive'], playedOnTurn: 2 })
    g.state.zones[0].cards.a.push(ino)
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [ino.instanceId], targetIds: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: ['ghost'], targetIds: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [], targetIds: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('routes stealthy targets through the response window', () => {
    const { g, atk, def } = battleground()
    const sneak = zoneEntry({ keywords: ['stealthy'] })
    g.state.zones[0].cards.b.push(sneak)
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [atk.instanceId], targetIds: [def.instanceId, sneak.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.awaitingResponse).toMatchObject({ stealthyIds: [sneak.instanceId] })
    expect(r.game.state.activeBattle).toBeNull()
    expect(r.game.state.zones[0].lastActivatedTurn).toBeNull() // not spent yet
    // defender opts the stealthy ship out; battle locks with the rest
    const r2 = applyAction(r.game, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [sneak.instanceId] })
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.game.state.activeBattle!.defenderIds).toEqual([def.instanceId])
    expect(r2.game.state.zones[0].lastActivatedTurn).toBe(3)
  })
  it('cancels without spending the activation when every defender opts out', () => {
    const { g, atk } = battleground()
    g.state.zones[0].cards.b = []
    const sneak = zoneEntry({ keywords: ['stealthy'] })
    g.state.zones[0].cards.b.push(sneak)
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [sneak.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    const r2 = applyAction(r.game, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [sneak.instanceId] })
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.game.state.awaitingResponse).toBeNull()
    expect(r2.game.state.activeBattle).toBeNull()
    expect(r2.game.state.zones[0].lastActivatedTurn).toBeNull()
    // attacker may activate the zone again (e.g. base attack)
  })
  it('only the defender may respond, and only non-stealthy opt-outs are rejected', () => {
    const { g, atk, def } = battleground()
    const sneak = zoneEntry({ keywords: ['stealthy'] })
    g.state.zones[0].cards.b.push(sneak)
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [atk.instanceId], targetIds: [def.instanceId, sneak.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(applyAction(r.game, 'alice', { type: 'RESPOND_TO_ATTACK', optOutIds: [] }))
      .toMatchObject({ ok: false, status: 403 })
    expect(applyAction(r.game, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [def.instanceId] }))
      .toMatchObject({ ok: false, status: 400 })
  })
})
```

- [ ] **Step 2: RED.** **Step 3: Implement** — `shared/engine/battleDeclare.ts`:

```ts
import { KEYWORDS, SPAWN_DISTANCE_DEFAULT_M } from '../gameSettings.ts'
import type { Side } from './engineTypes.ts'
import type { EngineGame } from './engineTypes.ts'
import { err, otherSide, registerHandler, zoneById } from './gameEngine.ts'

function lockBattle(
  game: EngineGame, zoneId: number, aggressor: Side, attackerIds: string[], defenderIds: string[],
): void {
  game.state.activeBattle = {
    zoneId, aggressor, attackerIds, defenderIds,
    distanceM: SPAWN_DISTANCE_DEFAULT_M, distanceModifiedBy: [],
  }
  zoneById(game.state, zoneId)!.lastActivatedTurn = game.turnNumber
  game.state.log.push(
    `Fleet battle declared in zone ${zoneId} — ${attackerIds.length} vs ${defenderIds.length}. Fight it in From The Depths, then report results.`,
  )
}

registerHandler('ATTACK_ENEMY_FLEET', (game, actor, action) => {
  if (action.type !== 'ATTACK_ENEMY_FLEET') return err(400, 'Bad action')
  const zone = zoneById(game.state, action.zoneId)
  if (!zone) return err(400, 'No such zone')
  if (zone.lastActivatedTurn === game.turnNumber) return err(409, 'That zone was already activated this turn')
  const enemy = otherSide(actor)
  const mine = zone.cards[actor]
  const theirs = zone.cards[enemy]
  if (action.attackerIds.length === 0 || action.targetIds.length === 0) {
    return err(400, 'Pick at least one attacker and one target')
  }
  for (const id of action.attackerIds) {
    const card = mine.find((c) => c.instanceId === id)
    if (!card) return err(400, 'Attacker selection includes a vehicle that is not yours in that zone')
    if (card.keywords.includes(KEYWORDS.INOFFENSIVE)) {
      return err(400, `${card.name} is Inoffensive and cannot attack`)
    }
  }
  const stealthyIds: string[] = []
  for (const id of action.targetIds) {
    const card = theirs.find((c) => c.instanceId === id)
    if (!card) return err(400, 'Target selection includes a vehicle that is not in that zone')
    if (card.keywords.includes(KEYWORDS.STEALTHY)) stealthyIds.push(id)
  }
  if (stealthyIds.length > 0) {
    game.state.awaitingResponse = {
      zoneId: action.zoneId, aggressor: actor,
      attackerIds: action.attackerIds, targetIds: action.targetIds, stealthyIds,
    }
    game.state.log.push(`Fleet attack declared in zone ${action.zoneId} — stealthy defenders may withdraw`)
    return { ok: true, game }
  }
  lockBattle(game, action.zoneId, actor, action.attackerIds, action.targetIds)
  return { ok: true, game }
})

registerHandler('RESPOND_TO_ATTACK', (game, actor, action) => {
  if (action.type !== 'RESPOND_TO_ATTACK') return err(400, 'Bad action')
  const pending = game.state.awaitingResponse
  if (!pending) return err(409, 'No attack awaits a response')
  if (actor === pending.aggressor) return err(403, 'Only the defender responds')
  for (const id of action.optOutIds) {
    if (!pending.stealthyIds.includes(id)) return err(400, 'Only stealthy vehicles may withdraw')
  }
  const remaining = pending.targetIds.filter((id) => !action.optOutIds.includes(id))
  game.state.awaitingResponse = null
  if (remaining.length === 0) {
    game.state.log.push('All defenders slipped away — the attack is called off')
    return { ok: true, game }
  }
  lockBattle(game, pending.zoneId, pending.aggressor, pending.attackerIds, remaining)
  return { ok: true, game }
})
```

Note the freeze rule already admits RESPOND_TO_ATTACK during `awaitingResponse` (battleFrozen covers it; RESPOND is in BATTLE_ACTIONS and OFF_TURN_ACTIONS).

- [ ] **Step 4: GREEN** (68 + 5 = 73). **Step 5: Commit** `feat(engine): fleet battle declaration with stealthy response window`.

---

### Task 6: Battle reports — submit, decide, repairs (TDD)

**Files:**
- Create: `shared/engine/battleResolve.ts`
- Modify: `shared/engine/index.ts` (wire)
- Test: `shared/engine/battleResolve.test.ts`

Rules: SUBMIT_BATTLE_REPORT — either participant while `activeBattle && !pendingReport`; `results` must cover EXACTLY the participating instanceIds (attackers + defenders), each 0-100; `repairs ⊆` participants whose reported HP is in `[REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT)`, not fragile; store as pendingReport. DECIDE_BATTLE_REPORT — only the NON-submitter; reject → clear pendingReport (battle stays active, resubmittable by either); approve → resolve: for each participant, `hp >= 90` survives; `80 ≤ hp < 90` destroyed unless in repairs (controller pays `repairCostOf(card)` — scrappy 0, else `Math.ceil(materialCost * REPAIR_COST_RATE)`; insufficient materials at approve time → 400, report stays pending for a corrected decision after... RULING: 400 error, pendingReport kept, so players can re-submit a report with fewer repairs); `hp < 80` destroyed. Destroyed → removed from zone, snapshot → `destroyed[side]`. Clear activeBattle+pendingReport, log summary. `repairCostOf` exported for the UI.

- [ ] **Step 1: Failing tests** — `shared/engine/battleResolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction, repairCostOf } from './index'
import { makeGame, zoneEntry } from './testFixtures'

function inBattle() {
  const g = makeGame({ turnNumber: 3 })
  const atk = zoneEntry({ playedOnTurn: 2, materialCost: 40000, name: 'Raider' })
  const def = zoneEntry({ materialCost: 60000, name: 'Bastion' })
  g.state.zones[0].cards.a.push(atk)
  g.state.zones[0].cards.b.push(def)
  g.state.activeBattle = {
    zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
    defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
  }
  g.state.zones[0].lastActivatedTurn = 3
  return { g, atk, def }
}

describe('SUBMIT_BATTLE_REPORT', () => {
  it('stores a complete report from either participant', () => {
    const { g, atk, def } = inBattle()
    const r = applyAction(g, 'bob', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingReport).toMatchObject({ submittedBy: 'b' })
  })
  it('rejects duplicate repair ids', () => {
    const { g, atk, def } = inBattle()
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 },
      repairs: [atk.instanceId, atk.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects incomplete or out-of-range results and illegal repairs', () => {
    const { g, atk, def } = inBattle()
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT', results: { [atk.instanceId]: 95 }, repairs: [],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 101, [def.instanceId]: 40 }, repairs: [],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 }) // 40 is below the repair window
  })
})

describe('DECIDE_BATTLE_REPORT', () => {
  it('only the non-submitter decides; reject clears the report but not the battle', () => {
    const { g, atk, def } = inBattle()
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    expect(applyAction(s.game, 'alice', { type: 'DECIDE_BATTLE_REPORT', approve: true }))
      .toMatchObject({ ok: false, status: 403 })
    const rej = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: false })
    if (!rej.ok) throw new Error(rej.error)
    expect(rej.game.state.pendingReport).toBeNull()
    expect(rej.game.state.activeBattle).not.toBeNull()
  })
  it('approve applies thresholds: survive / destroy / repair', () => {
    const { g, atk, def } = inBattle()
    const scrapper = zoneEntry({ keywords: ['scrappy'], materialCost: 20000 })
    g.state.zones[0].cards.a.push(scrapper)
    g.state.activeBattle!.attackerIds.push(scrapper.instanceId)
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 70, [scrapper.instanceId]: 82 },
      repairs: [atk.instanceId, scrapper.instanceId],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    // atk repaired for ceil(40000*0.5)=20000; scrappy free; def destroyed
    expect(r.game.state.resources.a.materials).toBe(80000)
    expect(r.game.state.zones[0].cards.a).toHaveLength(2)
    expect(r.game.state.zones[0].cards.b).toHaveLength(0)
    expect(r.game.state.destroyed.b.map((c) => c.name)).toEqual(['Bastion'])
    expect(r.game.state.activeBattle).toBeNull()
    expect(r.game.state.pendingReport).toBeNull()
  })
  it('fragile cannot be repaired; unrepaired window vehicles are destroyed', () => {
    const { g, atk, def } = inBattle()
    const glass = zoneEntry({ keywords: ['fragile'], playedOnTurn: 2 })
    g.state.zones[0].cards.a.push(glass)
    g.state.activeBattle!.attackerIds.push(glass.instanceId)
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [glass.instanceId]: 85 },
      repairs: [glass.instanceId],
    })).toMatchObject({ ok: false, status: 400 }) // fragile can't be repaired
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [glass.instanceId]: 85 },
      repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a.some((c) => c.cardId === glass.cardId)).toBe(true)
  })
  it('fails the approval when a controller cannot afford their repairs', () => {
    const { g, atk, def } = inBattle()
    g.state.resources.a.materials = 1000
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [atk.instanceId],
    })
    if (!s.ok) throw new Error(s.error)
    expect(applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('repairCostOf', () => {
  it('is half material cost rounded up, free for scrappy', () => {
    expect(repairCostOf(zoneEntry({ materialCost: 41000 }))).toBe(20500)
    expect(repairCostOf(zoneEntry({ materialCost: 41001 }))).toBe(20501)
    expect(repairCostOf(zoneEntry({ materialCost: 90000, keywords: ['scrappy'] }))).toBe(0)
  })
})
```

- [ ] **Step 2: RED.** **Step 3: Implement** — `shared/engine/battleResolve.ts`:

```ts
import {
  KEYWORDS, REPAIR_COST_RATE, REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT,
} from '../gameSettings.ts'
import type { SnapshotCard } from './gameInit.ts'
import type { EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { err, registerHandler, zoneById } from './gameEngine.ts'
import { effectiveMaterialCostOf } from './placement.ts'

export function repairCostOf(card: { materialCost: number; keywords: string[] }): number {
  if (card.keywords.includes(KEYWORDS.SCRAPPY)) return 0
  return Math.ceil(effectiveMaterialCostOf(card) * REPAIR_COST_RATE)
}

function participantsOf(game: EngineGame): Map<string, { entry: ZoneCardEntry; side: Side }> {
  const battle = game.state.activeBattle!
  const zone = zoneById(game.state, battle.zoneId)!
  const map = new Map<string, { entry: ZoneCardEntry; side: Side }>()
  for (const id of battle.attackerIds) {
    const entry = zone.cards[battle.aggressor].find((c) => c.instanceId === id)
    if (entry) map.set(id, { entry: entry as ZoneCardEntry, side: battle.aggressor })
  }
  const defenderSide: Side = battle.aggressor === 'a' ? 'b' : 'a'
  for (const id of battle.defenderIds) {
    const entry = zone.cards[defenderSide].find((c) => c.instanceId === id)
    if (entry) map.set(id, { entry: entry as ZoneCardEntry, side: defenderSide })
  }
  return map
}

registerHandler('SUBMIT_BATTLE_REPORT', (game, actor, action) => {
  if (action.type !== 'SUBMIT_BATTLE_REPORT') return err(400, 'Bad action')
  if (!game.state.activeBattle) return err(409, 'No battle to report')
  if (game.state.pendingReport) return err(409, 'A report is already awaiting a decision')
  const participants = participantsOf(game)
  const reported = Object.keys(action.results)
  if (reported.length !== participants.size || reported.some((id) => !participants.has(id))) {
    return err(400, 'The report must cover exactly the vehicles in this battle')
  }
  if (new Set(action.repairs).size !== action.repairs.length) {
    return err(400, 'Repair list contains duplicates')
  }
  for (const [id, hp] of Object.entries(action.results)) {
    if (typeof hp !== 'number' || Number.isNaN(hp) || hp < 0 || hp > 100) {
      return err(400, 'Ending HP must be between 0 and 100')
    }
    void id
  }
  for (const id of action.repairs) {
    const participant = participants.get(id)
    const hp = action.results[id]
    if (!participant) return err(400, 'Repair selection includes a non-participant')
    if (hp === undefined || hp < REPAIR_WINDOW_MIN_PERCENT || hp >= SURVIVE_HP_PERCENT) {
      return err(400, `${participant.entry.name} is not in the repairable band`)
    }
    if (participant.entry.keywords.includes(KEYWORDS.FRAGILE)) {
      return err(400, `${participant.entry.name} is Fragile and cannot be repaired`)
    }
  }
  game.state.pendingReport = { submittedBy: actor, results: action.results, repairs: action.repairs }
  game.state.log.push(`Battle report submitted by player ${actor.toUpperCase()} — awaiting approval`)
  return { ok: true, game }
})

registerHandler('DECIDE_BATTLE_REPORT', (game, actor, action) => {
  if (action.type !== 'DECIDE_BATTLE_REPORT') return err(400, 'Bad action')
  const report = game.state.pendingReport
  if (!report) return err(409, 'No report awaits a decision')
  if (actor === report.submittedBy) return err(403, 'The other captain must approve your report')
  if (!action.approve) {
    game.state.pendingReport = null
    game.state.log.push('Battle report rejected — submit a corrected one')
    return { ok: true, game }
  }
  const participants = participantsOf(game)
  // Repair affordability first (all-or-nothing).
  const owed: Record<Side, number> = { a: 0, b: 0 }
  for (const id of report.repairs) {
    const p = participants.get(id)
    if (p) owed[p.side] += repairCostOf(p.entry)
  }
  for (const side of ['a', 'b'] as Side[]) {
    if (owed[side] > game.state.resources[side].materials) {
      return err(400, `Player ${side.toUpperCase()} cannot afford their repairs — reject and resubmit`)
    }
  }
  for (const side of ['a', 'b'] as Side[]) game.state.resources[side].materials -= owed[side]
  const zone = zoneById(game.state, game.state.activeBattle!.zoneId)!
  let destroyedCount = 0
  for (const [id, { entry, side }] of participants) {
    const hp = report.results[id]
    const survives = hp >= SURVIVE_HP_PERCENT ||
      (hp >= REPAIR_WINDOW_MIN_PERCENT && report.repairs.includes(id))
    if (!survives) {
      zone.cards[side] = zone.cards[side].filter((c) => c.instanceId !== id)
      const { instanceId: _i, playedOnTurn: _p, movedOnTurn: _m, ...snapshot } = entry
      game.state.destroyed[side].push(snapshot as SnapshotCard)
      destroyedCount++
      game.state.log.push(`${entry.name} was destroyed (${hp}%)`)
    } else if (report.repairs.includes(id)) {
      game.state.log.push(`${entry.name} was repaired (${hp}%)`)
    }
  }
  game.state.activeBattle = null
  game.state.pendingReport = null
  game.state.log.push(`Battle resolved — ${destroyedCount} vehicle(s) lost`)
  return { ok: true, game }
})
```

- [ ] **Step 4: GREEN** (73 + 8 = 81). **Step 5: Commit** `feat(engine): battle reports with mutual approval and repair economics`.

---

### Task 7: Hero powers + MOVE_VEHICLE (TDD)

**Files:**
- Create: `shared/engine/heroPowers.ts`
- Modify: `shared/engine/index.ts` (wire)
- Test: `shared/engine/heroPowers.test.ts`

Rules: all powers cost 1 CP, once per game per player (`usedHeroPowers[side]` stores power names). salvage(cardId): your turn, not frozen; card must be in `destroyed[actor]` with `type === 'vehicle'`; remove ONE matching entry → new hand instance (fresh instanceId via a module-level counter is NOT deterministic — RULING: instanceId `hp-${cardId}-${turnNumber}-${side}` is deterministic and unique enough: a card salvaged twice can't happen (once/game) — use that). tacticalPositioning(distanceDeltaM): either participant, requires activeBattle && !pendingReport && `distanceModifiedBy === null`; |delta| ≤ HERO_POWER_DISTANCE_MOD_M; clamp result to [SPAWN_DISTANCE_MIN_M, SPAWN_DISTANCE_MAX_M]; set distanceModifiedBy = actor. draw: your turn, not frozen; drawCard. rapidRedeployment(instanceId, zoneId): your turn, not frozen; own vehicle; target zone biome-legal (screens don't block moves); sets movedOnTurn. MOVE_VEHICLE: your turn, not frozen; own vehicle with mobile keyword; `movedOnTurn !== turnNumber`; biome-legal target; free.

- [ ] **Step 1: Failing tests** — `shared/engine/heroPowers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction } from './index'
import { makeGame, snap, zoneEntry } from './testFixtures'

describe('USE_HERO_POWER', () => {
  it('salvage returns a destroyed vehicle to hand, once per game, 1cp', () => {
    const g = makeGame()
    const dead = snap({ name: 'Sunken Raider' })
    g.state.destroyed.a.push(dead)
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'salvage', cardId: dead.cardId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Sunken Raider'])
    expect(r.game.state.destroyed.a).toHaveLength(0)
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.usedHeroPowers.a).toEqual(['salvage'])
    expect(applyAction(r.game, 'alice', { type: 'USE_HERO_POWER', power: 'salvage', cardId: dead.cardId }))
      .toMatchObject({ ok: false, status: 400 }) // once per game
  })
  it('draw draws; blocked without cp', () => {
    const g = makeGame()
    g.privates.a.deck = [/* one card */ { ...snap(), instanceId: 'd1' }]
    g.state.counts.a.deck = 1
    g.state.resources.a.cp = 0
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'draw' }))
      .toMatchObject({ ok: false, status: 400 })
    g.state.resources.a.cp = 1
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'draw' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(1)
  })
  it('tacticalPositioning is per-player: each side may shift the same battle once', () => {
    const g = makeGame()
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1200, distanceModifiedBy: [],
    }
    const r = applyAction(g, 'bob', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: -600,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle!.distanceM).toBe(600)
    expect(r.game.state.activeBattle!.distanceModifiedBy).toEqual(['b'])
    // the OTHER player may counter with their own once-per-game power
    const r2 = applyAction(r.game, 'alice', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: 100,
    })
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.game.state.activeBattle!.distanceM).toBe(700)
    expect(r2.game.state.activeBattle!.distanceModifiedBy).toEqual(['b', 'a'])
    // same player again → power already used this game
    expect(applyAction(r2.game, 'bob', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: 100,
    })).toMatchObject({ ok: false, status: 400 })
    // delta over the cap rejected
    const g2 = makeGame()
    g2.state.activeBattle = { ...g.state.activeBattle!, distanceModifiedBy: [] }
    expect(applyAction(g2, 'alice', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: 700,
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('tacticalPositioning clamps to the spawn-distance bounds', () => {
    const low = makeGame()
    low.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 500, distanceModifiedBy: [],
    }
    const rLow = applyAction(low, 'alice', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: -600,
    })
    if (!rLow.ok) throw new Error(rLow.error)
    expect(rLow.game.state.activeBattle!.distanceM).toBe(50)
    const high = makeGame()
    high.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1700, distanceModifiedBy: [],
    }
    const rHigh = applyAction(high, 'bob', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: 600,
    })
    if (!rHigh.ok) throw new Error(rHigh.error)
    expect(rHigh.game.state.activeBattle!.distanceM).toBe(2000)
  })
  it('rapidRedeployment moves any own vehicle to a biome-legal zone', () => {
    const g = makeGame()
    const ship = zoneEntry({ vehicleType: 'ship', playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(ship)
    const bad = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'rapidRedeployment', instanceId: ship.instanceId, zoneId: 3,
    })
    expect(bad).toMatchObject({ ok: false, status: 400 }) // ship → land
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'rapidRedeployment', instanceId: ship.instanceId, zoneId: 2,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[1].cards.a).toHaveLength(1)
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
  })
})

describe('MOVE_VEHICLE', () => {
  it('moves mobile vehicles once per turn, biome-legal, free', () => {
    const g = makeGame()
    const truck = zoneEntry({ vehicleType: 'tank', keywords: ['mobile'], playedOnTurn: 1 })
    g.state.zones[1].cards.a.push(truck)
    const r = applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: truck.instanceId, zoneId: 3 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[2].cards.a[0]).toMatchObject({ movedOnTurn: 2 })
    expect(applyAction(r.game, 'alice', { type: 'MOVE_VEHICLE', instanceId: truck.instanceId, zoneId: 2 }))
      .toMatchObject({ ok: false, status: 409 }) // once per turn
  })
  it('rejects non-mobile vehicles and enemy vehicles', () => {
    const g = makeGame()
    const slow = zoneEntry({ vehicleType: 'ship', playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(slow)
    expect(applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: slow.instanceId, zoneId: 2 }))
      .toMatchObject({ ok: false, status: 400 })
    const foe = zoneEntry({ vehicleType: 'ship', keywords: ['mobile'] })
    g.state.zones[0].cards.b.push(foe)
    expect(applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: foe.instanceId, zoneId: 2 }))
      .toMatchObject({ ok: false, status: 400 })
  })
})
```

- [ ] **Step 2: RED.** **Step 3: Implement** — `shared/engine/heroPowers.ts` (structure: one `registerHandler('USE_HERO_POWER', ...)` switching on `action.power` + a `MOVE_VEHICLE` handler; shared move helper validating biome via `biomeAllows`; salvage instance id `hp-${cardId}-${game.turnNumber}-${actor}`; guards: 1 CP, `usedHeroPowers[actor]` absence, your-turn + not-frozen for salvage/draw/rapidRedeployment, battle-participant + `activeBattle && !pendingReport && distanceModifiedBy === null` + |delta| ≤ cap + clamp for tacticalPositioning; all paths deduct 1 CP and push the power name + a log line):

```ts
import {
  HERO_POWER_DISTANCE_MOD_M, KEYWORDS, SPAWN_DISTANCE_MAX_M, SPAWN_DISTANCE_MIN_M,
} from '../gameSettings.ts'
import type { EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { battleFrozen, drawCard, err, findVehicle, registerHandler, zoneById } from './gameEngine.ts'
import { biomeAllows } from './placement.ts'

function moveEntry(game: EngineGame, actor: Side, instanceId: string, zoneId: number, stampMove: boolean) {
  const found = findVehicle(game.state, instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  const target = zoneById(game.state, zoneId)
  if (!target || target.id === found.zone.id) return err(400, 'Pick a different zone')
  if (!biomeAllows(found.entry.vehicleType, target.biome)) {
    return err(400, `${found.entry.name} cannot operate in ${target.biome}`)
  }
  found.zone.cards[actor] = found.zone.cards[actor].filter((c) => c.instanceId !== instanceId)
  const entry: ZoneCardEntry = { ...found.entry, movedOnTurn: stampMove ? game.turnNumber : found.entry.movedOnTurn }
  target.cards[actor].push(entry)
  game.state.log.push(`${found.entry.name} relocated to zone ${zoneId}`)
  return { ok: true as const, game }
}

registerHandler('MOVE_VEHICLE', (game, actor, action) => {
  if (action.type !== 'MOVE_VEHICLE') return err(400, 'Bad action')
  if (game.activePlayer !== (actor === 'a' ? game.playerA : game.playerB)) return err(409, 'Not your turn')
  const found = findVehicle(game.state, action.instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  if (!found.entry.keywords.includes(KEYWORDS.MOBILE)) return err(400, `${found.entry.name} is not Mobile`)
  if (found.entry.movedOnTurn === game.turnNumber) return err(409, `${found.entry.name} already moved this turn`)
  return moveEntry(game, actor, action.instanceId, action.zoneId, true)
})

registerHandler('USE_HERO_POWER', (game, actor, action) => {
  if (action.type !== 'USE_HERO_POWER') return err(400, 'Bad action')
  const res = game.state.resources[actor]
  if (game.state.usedHeroPowers[actor].includes(action.power)) {
    return err(400, 'That hero power was already used this game')
  }
  if (res.cp < 1) return err(400, 'Not enough CP')
  const isMyTurn = game.activePlayer === (actor === 'a' ? game.playerA : game.playerB)

  if (action.power === 'tacticalPositioning') {
    const battle = game.state.activeBattle
    if (!battle || game.state.pendingReport) return err(409, 'No battle to reposition')
    if (battle.distanceModifiedBy.includes(actor)) {
      return err(409, 'You already adjusted this battle')
    }
    const delta = action.distanceDeltaM ?? 0
    if (delta === 0 || Math.abs(delta) > HERO_POWER_DISTANCE_MOD_M) {
      return err(400, `Distance shift must be within ±${HERO_POWER_DISTANCE_MOD_M}m`)
    }
    battle.distanceM = Math.min(SPAWN_DISTANCE_MAX_M, Math.max(SPAWN_DISTANCE_MIN_M, battle.distanceM + delta))
    battle.distanceModifiedBy.push(actor)
    game.state.log.push(`Spawn distance adjusted to ${battle.distanceM}m (Tactical Positioning)`)
  } else {
    if (!isMyTurn) return err(409, 'Not your turn')
    if (battleFrozen(game.state)) return err(409, 'Resolve the battle first')
    if (action.power === 'draw') {
      drawCard(game, actor)
      game.state.log.push('Hero Power Draw')
    } else if (action.power === 'salvage') {
      const index = game.state.destroyed[actor].findIndex(
        (c) => c.cardId === action.cardId && c.type === 'vehicle',
      )
      if (index < 0) return err(400, 'No such destroyed vehicle to salvage')
      const [card] = game.state.destroyed[actor].splice(index, 1)
      game.privates[actor].hand.push({
        ...card, instanceId: `hp-${card.cardId}-${game.turnNumber}-${actor}`,
      })
      game.state.counts[actor].hand = game.privates[actor].hand.length
      game.state.log.push(`${card.name} salvaged back to hand`)
    } else if (action.power === 'rapidRedeployment') {
      const moved = moveEntry(game, actor, action.instanceId ?? '', action.zoneId ?? -1, true)
      if (!moved.ok) return moved
    } else {
      return err(400, 'Unknown hero power')
    }
  }
  res.cp -= 1
  game.state.usedHeroPowers[actor].push(action.power)
  return { ok: true, game }
})
```

- [ ] **Step 4: GREEN** (81 + 7 = 88). **Step 5: Commit** `feat(engine): universal hero powers and mobile moves`.

---

### Task 8: `game-action` edge function — deploy + smoke

**Files:**
- Create: `supabase/functions/game-action/index.ts`, `supabase/functions/game-action/shared/**` (synced)
- Modify: `supabase/functions/shared-manifest.json` (add `game-action` entry)

**Interfaces:**
- Produces: deployed `game-action`: POST JSON `{ gameId: string, expectedVersion: number, action: GameAction }` → `200 { version }` | `400/403/409 {errors}` | `409 {errors:['Version conflict — refresh']}` on optimistic-concurrency failure. Task 10-12's board calls it.

- [ ] **Step 1: Manifest** — add to `shared-manifest.json`:

```json
  "game-action": [
    "gameSettings.ts",
    "types.ts",
    "lobbySettings.ts",
    "engine/deckValidation.ts",
    "engine/gameInit.ts",
    "engine/engineTypes.ts",
    "engine/gameEngine.ts",
    "engine/placement.ts",
    "engine/baseAttack.ts",
    "engine/battleDeclare.ts",
    "engine/battleResolve.ts",
    "engine/heroPowers.ts",
    "engine/index.ts"
  ]
```

(`engine/deckValidation.ts` rides along so the synced tree typechecks — `lobbySettings.ts` type-imports it.) The drift test is parameterized per manifest file, so this adds **13 dynamic tests**. Run `npm test` before sync to see the 13 new entries fail, then `npm run functions:sync` → all green (88 + 13 = **101 total**; record both runs).

- [ ] **Step 2: Function** — `supabase/functions/game-action/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { applyAction, normalizeState } from './shared/engine/index.ts'
import type { EngineGame, GameAction, PrivateState } from './shared/engine/engineTypes.ts'

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

  let body: { gameId?: unknown; expectedVersion?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { errors: ['Invalid JSON body'] })
  }
  const gameId = typeof body.gameId === 'string' ? body.gameId : ''
  const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : -1
  const action = body.action as GameAction | undefined
  if (!gameId || expectedVersion < 0 || !action || typeof action.type !== 'string') {
    return json(400, { errors: ['gameId, expectedVersion, and action are required'] })
  }

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: row } = await admin.from('games').select('*').eq('id', gameId).maybeSingle()
  if (!row) return json(404, { errors: ['Game not found'] })
  if (row.player_a !== userId && row.player_b !== userId) {
    return json(403, { errors: ['You are not in this game'] })
  }
  if (row.version !== expectedVersion) {
    return json(409, { errors: ['Version conflict — refresh'] })
  }
  const { data: playerRows } = await admin
    .from('game_players').select('*').eq('game_id', gameId)
  const aRow = playerRows?.find((p) => p.player_id === row.player_a)
  const bRow = playerRows?.find((p) => p.player_id === row.player_b)
  if (!aRow || !bRow) return json(500, { errors: ['Game state is incomplete'] })

  const engineGame: EngineGame = {
    id: row.id,
    playerA: row.player_a,
    playerB: row.player_b,
    status: row.status as EngineGame['status'],
    winnerId: row.winner_id,
    turnNumber: Number(row.turn_number),
    activePlayer: row.active_player,
    settings: row.settings as EngineGame['settings'],
    state: row.state as EngineGame['state'],
    privates: {
      a: { hand: aRow.hand, deck: aRow.deck } as PrivateState,
      b: { hand: bRow.hand, deck: bRow.deck } as PrivateState,
    },
  }
  // Rows created before this phase (or by an older lobby-action deploy) lack
  // the new state fields — repair the shape before the engine sees it.
  normalizeState(engineGame.state)

  const result = applyAction(engineGame, userId, action)
  if (!result.ok) return json(result.status, { errors: [result.error] })
  const next = result.game

  // One transaction for public state + both private rows (apply_action_tx,
  // Task 1's migration); null return = version conflict.
  const { data: newVersion, error: txError } = await admin.rpc('apply_action_tx', {
    p_game_id: gameId,
    p_expected_version: row.version,
    p_game: {
      status: next.status,
      winnerId: next.winnerId ?? '',
      turnNumber: next.turnNumber,
      activePlayer: next.activePlayer,
      playerA: next.playerA,
      playerB: next.playerB,
      state: next.state,
    },
    p_a_state: next.privates.a,
    p_b_state: next.privates.b,
  })
  if (txError) return json(500, { errors: [txError.message] })
  if (newVersion === null || newVersion === undefined) {
    return json(409, { errors: ['Version conflict — refresh'] })
  }
  return json(200, { version: newVersion })
})
```

- [ ] **Step 3: Deploy + smoke** — `npm run functions:sync && npm test` green first; deploy (name `game-action`, entrypoint `index.ts`, `verify_jwt: false`, files per manifest; type-only prunes expected). Smoke: unauth POST → 401 `{"errors":["Not signed in"]}`; OPTIONS → 200 + CORS. Verify live content vs repo with `get_edge_function` (index.ts byte-match).

- [ ] **Step 4: Commit** `feat(functions): game-action dispatcher with optimistic concurrency`.

---

### Task 9: Live E2E — scripted full game

**Files:** none in repo (scratchpad scripts + MCP: `execute_sql`, `get_advisors`, `query_logs`).

Protocol (URL/key from `frontend/.env.local`; accounts ftdtest2/ftdtest3; helper `act(client, gameId, version, action)` wrapping `functions.invoke('game-action', ...)` reading errors via `error.context.json()` and refreshing version from the response):

1. **Setup:** both users sign in; build cheap DWG decks (10 cheapest DWG built-in ships/airships by material_cost × 2 — record the exact ids and costs). NOTE: the 10-cheapest set includes 3 airships = 6 flier copies, exactly AT the limit of 6 — this validates; if START 400s on the deck, check the flier count first. Host (ftdtest2) creates a lobby named 'E2E Warpath' with settings `{"zones":[{"biome":"water","baseHp":100},{"biome":"water","baseHp":100},{"biome":"water","baseHp":100}]}` (LOW HP by design so bombardment can finish); guest joins; START → gameId. Read the game; identify `first` (active_player) and `second`; map to sides via player_a/player_b.
2. **Turn 1 (first):** play the cheapest affordable ship from hand (≤50k — the E2E decks are built from the cheapest ships so at least one is; if not in hand, END_TURN and adapt: loop up to 6 half-turns until a play lands — record what happened). END_TURN.
3. **Second's turn:** play a ship if affordable; END_TURN.
4. **Delay rule probe:** on `first`'s next turn, ATTACK_ENEMY_BASE in the zone where their vehicle sits (played last turn → eligible now) → expect 200 and base HP reduced by floor(cost/1000); immediately re-attack same zone → expect 409 (already activated).
5. **Fleet battle:** ensure both sides have a vehicle in one zone (play/move as needed, END_TURNs allowed); active player declares ATTACK_ENEMY_FLEET (their vehicle vs one enemy) → activeBattle visible in state with distanceM 1200 and distanceModifiedBy []. tacticalPositioning by the OFF-turn player with distanceDeltaM -600 → distance 600. Retry semantics (per-player rule): the SAME player again → 400 'already used this game'; the OTHER player with +100 → 200 and distance 700. SUBMIT_BATTLE_REPORT by the defender: attacker 95%, defender 85%, repairs [defender] → DECIDE by the attacker approve:true. Expected materials delta for the defender's controller = `repairCostOf(defenderCard)` computed locally by importing it from `shared/engine/index.ts` — NOTE 7 of the 10 cheapest DWG ships are scrappy (repair cost 0), so the delta is very likely 0; assert the computed value either way and PRINT which branch ran (scrappy-free vs paid). If the controller can't afford a paid repair, use repairs [] and expect destruction + `destroyed` populated — again assert the branch that ran.
6. **Hero powers:** active player USE_HERO_POWER draw → hand+1, cp-1; salvage if any destroyed vehicle exists for that side (else skip, note).
7. **Negative checks:** off-turn END_TURN → 409; play a card with wrong instanceId → 400; stale expectedVersion → 409 version conflict; non-participant (signed-out) → 401.
8. **Win by bombardment:** loop: active player attacks base in their vehicle's zone each turn then END_TURN ×2 (both players just cycle; second player passes) until two zones fall (move the attacker between zones 1↔2 with... ships are water/water/water so play additional ships into other zones as income allows, or bombard zone 1 to 0 then redeploy... simplest: host plays a second cheap ship into zone 2 when affordable and alternates bombardments) → assert `status: 'complete'`, `winner_id` set, further actions → 409 'Game is over'.
9. **Cleanup:** delete the game (cascades), lobby, both E2E decks via execute_sql; verify zero rows; advisors both types (expect no new findings).

Full report with every step's expected-vs-got; NO repo changes.

---

### Task 10: Board UI I — layout, hand, play, end turn, realtime

**Files:**
- Create: `frontend/src/pages/game/GameBoardPage.tsx`, `frontend/src/pages/game/useGameActions.ts`, `frontend/src/pages/game/BoardZone.tsx`, `frontend/src/pages/game/HandBar.tsx`, `frontend/src/pages/game/MiniVehicle.tsx`
- Modify: `frontend/src/App.tsx` (route `/game/:id` → GameBoardPage), delete `frontend/src/pages/GameStubPage.tsx`

**Interfaces:**
- Produces: `useGameActions(gameId, version)` → `{ send(action: GameAction): Promise<void>; busy; error }` (invokes `game-action` with expectedVersion=version, surfaces FunctionsHttpError bodies, invalidates ['game', id] + ['gamePlayer', id] on success); board sub-components consumed by Tasks 11-12.

`useGameActions` — `frontend/src/pages/game/useGameActions.ts`:

```ts
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { GameAction } from '@shared/engine/engineTypes'
import { supabase } from '../../lib/supabaseClient'

export function useGameActions(gameId: string | undefined, version: number | undefined) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(action: GameAction) {
    if (!gameId || version === undefined) return
    setBusy(true)
    setError(null)
    try {
      const { error: fnError } = await supabase.functions.invoke('game-action', {
        body: { gameId, expectedVersion: version, action },
      })
      if (fnError) {
        if (fnError instanceof FunctionsHttpError) {
          const body = await fnError.context.json().catch(() => null)
          setError(body?.errors?.join('; ') ?? fnError.message)
        } else {
          setError(fnError.message)
        }
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['game', gameId] })
      await queryClient.invalidateQueries({ queryKey: ['gamePlayer', gameId] })
      setBusy(false)
    }
  }
  return { send, busy, error }
}
```

`MiniVehicle.tsx` — compact in-zone card (name, EFFECTIVE cost via `shortHandNumber(effectiveMaterialCostOf(entry))` — the halfCost discount must be what players see, keyword icons, vehicle-type fallback icon, subtle "fresh" badge when `playedOnTurn === turnNumber`, selectable highlight via props `{ entry, selected?, onClick?, dimmed? }`). `HandBar` likewise shows effective cost on halfCost cards (small strikethrough of the stored cost is a nice touch, optional). `BoardZone.tsx` — one zone panel: biome-tinted background (`water` ocean-600/20, `beach` parchment-300/10, `land` brass-400/10), enemy base HP bar top + own bottom (`baseHp / settings zone hp` width, red under 25%), enemy vehicles row, own vehicles row, children slot for action buttons (Task 11 fills). `HandBar.tsx` — horizontal scrolling hand of full `PhysicalCard`s (scale-75); on click, if exactly one legal zone → play immediately, else enter "placing" mode (parent state) highlighting legal zones (`legalZonesFor` from `@shared/engine/index` — import via `@shared/engine/placement` re-export; abilities get a "Play" button using PLAY_ABILITY_CARD with a confirm since effects are Phase 5).

`GameBoardPage.tsx` — assembles: header (opponent name, turn number, "Your turn"/"Their turn" chip, materials + CP for self, opponent counts, Concede button w/ confirm), 3 `BoardZone`s, `HandBar`, scrolling log panel (last 30, newest last, auto-scroll), win/loss banner overlay when `status === 'complete'` (names the winner, links to /games), realtime invalidation identical to the stub's two subscriptions, error toast from `useGameActions`. Reuses `useGameQuery`/`useMyGamePlayerQuery`/`useUsernames`. Side derivation: `mySide = game.player_a === me ? 'a' : 'b'`.

Steps: implement all five files; replace the `/game/:id` route; delete the stub; gates (`frontend build` clean, root tests unchanged); commit `feat(board): playable board shell — zones, hand, turn loop`.

(The complete JSX for these five files is the implementer's to write from the shapes above — every data source, component boundary, prop, action call, and visual rule is specified; keep components under ~150 lines each and Tailwind-token styled like the existing pages.)

---

### Task 11: Board UI II — zone activation, base attack, fleet attack, stealthy response

**Files:**
- Create: `frontend/src/pages/game/ZoneActions.tsx`, `frontend/src/pages/game/FleetAttackDialog.tsx`, `frontend/src/pages/game/StealthyResponseBar.tsx`
- Modify: `frontend/src/pages/game/GameBoardPage.tsx`, `frontend/src/pages/game/BoardZone.tsx` (children wiring)

Behavior:
- `ZoneActions` (rendered inside each own-side zone footer when it's my turn, no battle freeze, game active): "Bombard base" button — disabled with reason-tooltips derived client-side (`zone already activated`, `enemy Blocker`, `base destroyed`, `no eligible strikers` via `baseDamageFrom(...) === 0` — import from `@shared/engine/index`) showing predicted damage when enabled; sends ATTACK_ENEMY_BASE. "Attack fleet" button (enabled when both sides have vehicles and zone not activated) → opens `FleetAttackDialog`.
- `FleetAttackDialog`: two `MiniVehicle` columns (mine: inoffensive dimmed/unselectable; theirs: all selectable, stealthy marked with the crosshair icon + "may withdraw" note), multi-select both sides, Launch button (disabled until ≥1 each) sends ATTACK_ENEMY_FLEET, cancel closes.
- `StealthyResponseBar`: rendered page-wide when `state.awaitingResponse` and I'm the defender: lists the stealthy targets with checkboxes ("withdraw"), confirm sends RESPOND_TO_ATTACK with the checked ids; when I'm the aggressor, show a waiting notice.
- Base HP bars animate on change (`transition-all duration-500`).

Steps: implement, wire, gates, commit `feat(board): zone activation, bombardment, and fleet attack declaration`.

---

### Task 12: Board UI III — battle overlay, reports, hero powers, moves

**Files:**
- Create: `frontend/src/pages/game/BattleOverlay.tsx`, `frontend/src/pages/game/HeroPowerBar.tsx`
- Modify: `frontend/src/pages/game/GameBoardPage.tsx` (mount both; move-mode wiring on MiniVehicle for mobile vehicles)

Behavior:
- `BattleOverlay` (modal over the board whenever `state.activeBattle`): **Spawn sheet** — zone/biome, both fleets listed with names + effective costs + in-battle resources (`Math.floor(effectiveMaterialCostOf(entry) * IN_BATTLE_RESOURCE_RATE)` each), spawn distance (live — updates when tacticalPositioning lands), altitude guidance line (surface vessels/subs at surface, aircraft 80 m, land vehicles on land — static text from spec §3.5), robotic vehicles flagged with their battle-conduct note, end-condition reminder text. **Distance button**: "Tactical Positioning (1 CP)" with a ±meters input (clamped ±600), disabled when I already used the power this game OR already adjusted this battle (`distanceModifiedBy.includes(mySide)`), sends the hero power. **Report form** (either player): per-participant HP% number inputs (0-100), repair checkboxes auto-enabled only in the 80–89.999 band and not fragile, each showing `repairCostOf` (imported from `@shared/engine/index`) and the controller's affordability; submit sends SUBMIT_BATTLE_REPORT. **Decision panel** (when `pendingReport` and I'm NOT the submitter): read-only render of the report with computed outcomes (survive/repair/destroy per vehicle) + Approve / Reject buttons; when I AM the submitter: waiting notice.
- `HeroPowerBar` (header strip): the 4 universal powers as buttons with used/insufficient-CP/wrong-phase disabled states + tooltips; salvage opens a small picker of `destroyed[mySide]` vehicles; rapid redeployment enters move-mode (pick own vehicle → legal zones highlight → click zone) reusing the same move-mode used for mobile MOVE_VEHICLE (mobile vehicles get a small "move" affordance on their MiniVehicle when eligible).
- Win banner (from Task 10) also fires here after battle-driven losses. Log panel gains battle lines automatically.

Steps: implement, wire, gates, commit `feat(board): battle overlay with spawn sheet, reports, and hero powers`.

---

### Task 13: Final gates + controller visual pass

- [ ] Root `npm test` (expect 101: 88 unit + 13 game-action drift entries) + `cd frontend && npm run build` clean + `git status` clean.
- [ ] `get_advisors` both types — no new criticals.
- [ ] Report exact numbers. NO push. (The controller then does a two-browser visual pass and the finishing flow.)

---

## Self-review notes (completed)

- Spec coverage: §3.1-3.8 fully implemented (see Global Constraints rule-decision list for every ambiguity resolution); §3.9 effects + §3.8 faction powers + alert/targeting actions explicitly deferred to Phase 5; §5 game-action contract with version concurrency; §7 board with all modals/panels. E2E exercises every action type against the live stack.
- Type consistency: `GameAction`/`ApplyResult`/`EngineGame` defined once in engineTypes (Task 1) and consumed by every later task; handler registry + `index.ts` aggregation avoids import cycles; `repairCostOf`/`legalZonesFor`/`baseDamageFrom` exported for UI reuse; the function's row↔EngineGame mapping mirrors lobby-action's proven patterns.
- Decisions (recorded, beyond the Global Constraints list): zero-damage base attacks rejected rather than wasted; approve-time repair-affordability failure keeps the report pending (reject → resubmit path); salvage instance ids are deterministic (`hp-<cardId>-<turn>-<side>`); UI Tasks 10-12 specify complete component contracts but leave JSX authorship to implementers (every prop, data source, and rule named — the engine, not the JSX, is the correctness surface); **Half-Cost lives in `effectiveMaterialCostOf` and applies to play price, base damage, repair cost, and in-battle resources** — create-card stops pre-halving and existing custom planes get repaired by SQL; **Tactical Positioning is per-player per battle** (`distanceModifiedBy: Side[]`) per spec §3.8's per-player once-per-game framing; game-action writes atomically via the `apply_action_tx` RPC; `normalizeState` repairs pre-Phase-4 row shapes; ZoneState.cards stays typed `CardInstance[]` — `as ZoneCardEntry[]` casts at engine boundaries are the mechanism (tests assert via toMatchObject); turn-number PARITY is not authoritative (spec §3.2's "x.0 = playerA" note is dropped — `activePlayer` is the single source of truth; the spec is amended alongside this plan).
- Verification: this plan was adversarially verified (3 lenses, 20 findings — 2 blocking incl. the Half-Cost hole and the undefined-vs-null freeze brick, 8 important, 10 minor); ALL resolved in this revision. Test-count chain: 45 → 54 → 62 → 68 → 73 → 81 → 88 → 101 (T8 adds 13 drift entries).
- Placeholders: none load-bearing — Tasks 10-12's component bodies are deliberately contract-specified (see decision above); all engine/function/E2E code is complete.
