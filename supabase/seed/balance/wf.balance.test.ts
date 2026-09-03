import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-02 balance pass — WF's share, pinned against the seed source.
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

const CARDS: Record<string, Expected> = {
  'WF:Veles': {
    materialCost: 225_000, blueprintCost: 286_922, keywords: ['stealthy', 'scrappy'],
    vehicleType: 'ship',
    cardText: 'This card may be spawned into battle after all enemies are already spawned in',
  },
  'WF:Purifier': {
    materialCost: 750_000, blueprintCost: 765_000, keywords: ['halfCost', 'fragile'],
    vehicleType: 'ship',
    cardText: 'This vehicle does no damage to the enemy base. Whenever it participates in a fleet battle, the enemy forces must spawn in first, even if they are defending.',
  },
  'WF:Sub Strike': {
    materialCost: 100_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Target an enemy submarine, remove it from play.',
  },
}

describe('2026-09-02 balance pass — WF', () => {
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

  // §4.3's mechanic, pinned by VALUE on all three carriers. A data key's value
  // is never checked by G1/G2/G3 (docs/claude/card-effects.md, blind spot 4),
  // and deployOrderFor compares the string exactly — so a seeded 'fist' would
  // give three cards that are inert AND invisible.
  //
  // TG:Anguish is asserted HERE, in WF's file, because WF made the edit
  // (spec §6.3). Only its meta: Anguish's COSTS move in TG's wave and belong
  // in tg.balance.test.ts, so pinning them here would collide.
  it.each([
    ['WF:Veles', 'last'],
    ['WF:Purifier', 'last'],
    ['TG:Anguish', 'first'],
  ])('%s carries deployOrder %s', async (k, want) => {
    expect((await bySeedKey()).get(k)!.meta?.deployOrder).toBe(want)
  })

  // Both directions of Purifier's meta. `toMatchObject` alone would not notice
  // a key that STAYED, and the whole point of the rewrite is that the deploy
  // prerequisite is gone while noBaseDamage is not.
  it('Purifier keeps noBaseDamage and has given up its deploy prerequisite', async () => {
    const meta = (await bySeedKey()).get('WF:Purifier')!.meta as Record<string, unknown>
    expect(meta.noBaseDamage).toBe(true)
    expect(meta.deployRequiresBattleLoss).toBeUndefined()
  })

  // Veles traded a CONDITIONAL opt-out for an unconditional one. Assert both
  // halves: the key is gone, and STEALTHY — which is what now lets it sit a
  // defensive battle out — is printed.
  it('Veles trades defensiveOmission for STEALTHY', async () => {
    const veles = (await bySeedKey()).get('WF:Veles')!
    expect((veles.meta as Record<string, unknown>).defensiveOmission).toBeUndefined()
    expect(veles.keywords).toContain('stealthy')
  })

  // The only row this wave ADDS. Asserted as a count as well as a row, so a
  // second accidental card — a copy-paste of the literal above under a new
  // name — is caught rather than silently seeded.
  it('adds exactly one WF card', async () => {
    const { cards } = await loadSeedData()
    expect(cards.filter((c) => c.faction === 'WF')).toHaveLength(21)
  })
})
