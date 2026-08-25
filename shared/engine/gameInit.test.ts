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
