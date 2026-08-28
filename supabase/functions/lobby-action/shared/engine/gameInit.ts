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

// A persistent, board-visible marker a card leaves on one zone for one side
// (e.g. DWG Waters). Keyed by the registry effect name so the next persistent
// zone card reuses the same array and the same UI badge slot.
export interface ZoneEffect {
  effect: string
  zoneId: number
  side: 'a' | 'b'
  cardName: string
  setOnTurn: number
}

// One suspension slot (spec §4.2). An effect needing a decision writes this
// and returns true; the game freezes to PENDING_ACTIONS until
// RESOLVE_PENDING_EFFECT re-enters the same registry name.
//
// It carries the whole card, not just a name: by resolve time an ability has
// been spendCard'd into state.destroyed, so it is in neither hand nor field,
// and both the continuation's payload and game-action's catalog probe need
// something with meta on it.
//
// `options` is PUBLIC. Never offer a choice over cards the opponent cannot
// already see.
export interface PendingEffect {
  effect: string
  side: 'a' | 'b'
  card: CardInstance
  kind: 'choice'
  prompt: string
  options: { id: string; label: string }[]
  data?: Record<string, unknown>
}

export interface PublicGameState {
  zones: ZoneState[]
  resources: { a: { materials: number; cp: number }; b: { materials: number; cp: number } }
  counts: { a: { hand: number; deck: number }; b: { hand: number; deck: number } }
  usedHeroPowers: { a: string[]; b: string[] }
  awaitingResponse: {
    zoneId: number; aggressor: 'a' | 'b'
    attackerIds: string[]; targetIds: string[]; stealthyIds: string[]
  } | null
  // Structurally duplicates ActiveBattle in engineTypes.ts (not imported or
  // aliased) — any field added to one must be added to the other by hand.
  activeBattle: {
    zoneId: number; aggressor: 'a' | 'b'
    attackerIds: string[]; defenderIds: string[]
    distanceM: number; distanceModifiedBy: ('a' | 'b')[]
    summons: CardInstance[]
    continuation: {
      effect: string; side: 'a' | 'b'; card: CardInstance; data?: Record<string, unknown>
    } | null
  } | null
  pendingReport: {
    submittedBy: 'a' | 'b'; results: Record<string, number>; repairs: string[]
  } | null
  destroyed: { a: SnapshotCard[]; b: SnapshotCard[] }
  log: string[]
  factions: { a: string; b: string }
  alertCard: { side: 'a' | 'b'; instanceId: string; name: string; setOnTurn: number } | null
  scheduled: { type: 'changeOrderDraw'; side: 'a' | 'b'; dueTurn: number }[]
  zoneEffects: ZoneEffect[]
  pendingEffect: PendingEffect | null
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
  factionA: string
  factionB: string
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
    awaitingResponse: null,
    activeBattle: null,
    pendingReport: null,
    destroyed: { a: [], b: [] },
    log: [`Game started — first turn: ${activeIsA ? 'player A' : 'player B'}`],
    factions: { a: input.factionA, b: input.factionB },
    alertCard: null,
    scheduled: [],
    zoneEffects: [],
    pendingEffect: null,
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
