import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-02 balance pass — SS's share, pinned against the seed source.
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
  vehicleType?: string | null
  cpCost?: number
  cardText?: string
}

// Every SS card the 2026-09-02 pass touched, spelled out. Keywords compare as
// SETS — order in the seed literal is not meaningful.
const CARDS: Record<string, Expected> = {
  'SS:Tyr': {
    materialCost: 950_000, blueprintCost: 983_000, keywords: ['blocker'],
    vehicleType: 'ship',
    cardText: 'This card costs 60k less for every turn it spends in your hand',
  },
}

describe('2026-09-02 balance pass — SS', () => {
  it.each(Object.entries(CARDS))('%s carries its balanced numbers', async (k, want) => {
    const card = (await bySeedKey()).get(k)
    expect(card, `${k} is missing from the seed source`).toBeDefined()
    expect({
      materialCost: card!.materialCost,
      blueprintCost: card!.blueprintCost,
      keywords: [...(card!.keywords ?? [])].sort(),
    }).toEqual({
      materialCost: want.materialCost,
      blueprintCost: want.blueprintCost,
      keywords: [...want.keywords].sort(),
    })
    if (want.vehicleType !== undefined) expect(card!.vehicleType ?? null).toBe(want.vehicleType)
    if (want.cpCost !== undefined) expect(card!.cpCost).toBe(want.cpCost)
    if (want.cardText !== undefined) expect(card!.cardText ?? '').toBe(want.cardText)
  })

  // costModifier is not a DATA_EFFECT_KEY, and G1 only checks that a NAME
  // present in meta resolves. It cannot check the card carries one — a cleared
  // meta would leave a 950k vanilla Tyr with card text promising a discount.
  it('Tyr names the cost modifier its text promises', async () => {
    expect((await bySeedKey()).get('SS:Tyr')!.meta).toMatchObject({
      costModifier: 'tyrCostModifier',
    })
  })
})
