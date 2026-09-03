import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-02 balance pass — OW's share, pinned against the seed source.
//
// One file per faction so the five faction branches never edit the same test
// file (spec §2.3). Costs, keywords and card text are plain data that nothing
// else in the suite reads: effectCoverage asks only whether a card's EFFECTS
// are wired, and seedDataSync only whether the generated SQL matches its
// source. Both stay green if a number is fat-fingered. This file would not.
//
// Numbers are spelled out, never derived — a test that recomputes its
// expectation from the source it is checking proves nothing.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

interface Expected {
  materialCost: number
  blueprintCost: number
  keywords: string[]
  vehicleType: string | null
  cardText: string
}

// Every OW card the pass touched, new or updated. Keywords are compared as
// sets — order in the seed literal is not meaningful. cardText and vehicleType
// are NOT optional here, unlike balancePass.test.ts's shape: this pass moves a
// card's text and a card's type, so leaving either unpinned would leave the
// wave's two least visible edits unguarded.
const CARDS: Record<string, Expected> = {
  'OW:Brandistock': {
    materialCost: 250_000, blueprintCost: 258_000, keywords: ['subScreen'],
    vehicleType: 'ship',
    cardText: 'When this card is destroyed, draw a random GT Airship',
  },
}

describe('2026-09-02 balance pass — OW', () => {
  it.each(Object.entries(CARDS))('%s carries its balanced numbers', async (k, want) => {
    const card = (await bySeedKey()).get(k)
    expect(card, `${k} is missing from the seed source`).toBeDefined()
    expect({
      materialCost: card!.materialCost,
      blueprintCost: card!.blueprintCost,
      keywords: [...(card!.keywords ?? [])].sort(),
      vehicleType: card!.vehicleType ?? null,
      cardText: card!.cardText ?? '',
    }).toEqual({
      materialCost: want.materialCost,
      blueprintCost: want.blueprintCost,
      keywords: [...want.keywords].sort(),
      vehicleType: want.vehicleType,
      cardText: want.cardText,
    })
  })

  // R-6, checked from the DATA end. The engine-side check (that both names are
  // registered) lives in factionEffects.test.ts; this one is what would catch
  // a seed edit that pointed Brandistock at Halberd's id — which compiles,
  // passes G1, and silently rebinds one of the two.
  it('Brandistock names its own death trigger, and Halberd keeps its own', async () => {
    const cards = await bySeedKey()
    expect(cards.get('OW:Brandistock')!.meta?.onDeathEffect).toBe('brandistockOnDeath')
    expect(cards.get('OW:Halberd')!.meta?.onDeathEffect).toBe('halberdOnDeath')
  })
})
