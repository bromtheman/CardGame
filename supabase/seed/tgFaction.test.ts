import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'
import type { SeedCard } from '../../shared/types'

// The TG faction (wave 7), pinned against the seed source.
//
// Same job balancePass.test.ts does for the 2026-08-30 pass: costs, keywords
// and card text are plain data, so nothing else in the suite reads them.
// effectCoverage only asks whether a card's EFFECTS are wired, and
// seedDataSync only asks whether the generated SQL matches the source it was
// generated from — both stay green if a number is fat-fingered.
//
// It deliberately spells the numbers out rather than deriving them. A test
// that recomputes its expectation from the same source it is checking proves
// nothing.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

const keywordsOf = (card: SeedCard): string[] => [...(card.keywords ?? [])].sort()

// ---------------------------------------------------------------------------
// The LH "[TG] Robotics" pool.
//
// ⚠ This pool is the reason wave 7 could ship a cross-faction regression with
// an empty diff. It is the QUERY `is_built_in AND faction = 'TG'`, not a card
// list, so seeding 26 TG cards would have taken it from 4 rows to 30 — and no
// line of lhEffects.ts would have changed. The marker is what keeps it at four.
describe('the LH [TG] Robotics pool stays exactly four (wave 7)', () => {
  const POOL = ['[TG] Amusement', '[TG] Fear', '[TG] Hysteria', '[TG] Obsession']

  it('has exactly the four borrowed rows, and no TG faction card', async () => {
    const { cards } = await loadSeedData()
    const pool = cards.filter((c) => c.isBuiltIn && c.meta?.lhRoboticsPool === true)
    // The COUNT as well as the names: wave 6's Harbringer note is the
    // precedent — a small pool means a filter typo would be invisible.
    expect(pool).toHaveLength(4)
    expect(pool.map((c) => c.name).sort()).toEqual([...POOL].sort())
  })

  it('marks them with the literal `true` the engine compares, not merely a key', async () => {
    const byKey = await bySeedKey()
    for (const name of POOL) {
      expect(byKey.get(`TG:${name}`)?.meta?.lhRoboticsPool).toBe(true)
    }
  })

  it('gives them no other meta — the marker is their only wave-7 edit', async () => {
    const byKey = await bySeedKey()
    for (const name of POOL) {
      expect(Object.keys(byKey.get(`TG:${name}`)?.meta ?? {})).toEqual(['lhRoboticsPool'])
    }
  })
})

// ---------------------------------------------------------------------------
// Ruling L-1: no existing card changes behaviour — only the 26 new ones do.
//
// The four borrowed rows keep every gameplay-relevant field they had before
// wave 7. Spelled out per card so that "unchanged" is a test rather than an
// intention, and so a later wave cannot quietly give one of them upkeep.
describe('L-1: the four borrowed [TG] rows are otherwise untouched', () => {
  interface Expected {
    materialCost: number
    blueprintCost: number
    keywords: string[]
    vehicleType: string
  }

  const BORROWED: Record<string, Expected> = {
    '[TG] Amusement': {
      materialCost: 400_000, blueprintCost: 400_000,
      keywords: ['mobile', 'robotic'], vehicleType: 'ship',
    },
    '[TG] Fear': {
      materialCost: 600_000, blueprintCost: 614_000,
      keywords: ['robotic'], vehicleType: 'ship',
    },
    '[TG] Hysteria': {
      materialCost: 410_000, blueprintCost: 414_000,
      keywords: ['robotic'], vehicleType: 'ship',
    },
    '[TG] Obsession': {
      materialCost: 330_000, blueprintCost: 337_000,
      keywords: ['robotic'], vehicleType: 'ship',
    },
  }

  it.each(Object.entries(BORROWED))('%s keeps its exact stats', async (name, want) => {
    const card = (await bySeedKey()).get(`TG:${name}`)
    expect(card, `${name} is missing from the seed`).toBeDefined()
    expect(card!.materialCost).toBe(want.materialCost)
    expect(card!.blueprintCost).toBe(want.blueprintCost)
    expect(card!.vehicleType).toBe(want.vehicleType)
    expect(keywordsOf(card!)).toEqual([...want.keywords].sort())
    // Blank card text is why G2 never inspects them, and so why the marker
    // needs no DATA_EFFECT_KEYS entry. Asserted rather than assumed.
    expect(card!.cardText ?? '').toBe('')
    expect(card!.type).toBe('vehicle')
  })

  it('gives none of them UPKEEP_REQUIRED — all ten upkeep cards are new', async () => {
    const byKey = await bySeedKey()
    for (const name of Object.keys(BORROWED)) {
      expect(keywordsOf(byKey.get(`TG:${name}`)!)).not.toContain('upkeepRequired')
    }
  })
})
