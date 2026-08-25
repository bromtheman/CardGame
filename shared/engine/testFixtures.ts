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
