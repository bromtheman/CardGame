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
  it('seeds the three summon-only vehicles, flagged and text-free', async () => {
    const { cards } = await loadSeedData()
    for (const name of ['Flying Squirrel', 'Martyr', 'Parapet']) {
      const card = cards.find((c) => c.name === name)
      expect(card, `${name} is missing from the seed`).toBeDefined()
      expect(card!.meta).toMatchObject({ summonOnly: true })
      expect((card!.cardText ?? '').trim()).toBe('')
      expect(card!.keywords ?? []).toEqual([])
    }
  })
})

describe('vehicle_type patches (upstream OW-Built-in.js enum-key bug)', () => {
  it('every vehicle-type card has a non-null vehicleType', async () => {
    const { cards } = await loadSeedData()
    for (const c of cards) {
      if (c.type === 'vehicle') {
        expect(c.vehicleType).not.toBeNull()
        expect(c.vehicleType).not.toBeUndefined()
      }
    }
  })
  it('patches all 10 affected OW cards to vehicleType "ship"', async () => {
    const { cards } = await loadSeedData()
    const names = [
      'Cauldron', 'Clydesdale', 'Halberd', 'Iron Cordon', 'Javelin',
      'Jormangund', 'Mace', 'Mandrel', 'Partisan', 'Rook',
    ]
    for (const name of names) {
      const card = cards.find((c) => c.faction === 'OW' && c.name === name)
      expect(card).toBeDefined()
      expect(card?.vehicleType).toBe('ship')
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
