import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'
import { DATA_EFFECT_KEYS } from '../../../shared/effects/registry'
import { MAX_VEHICLES_PER_ZONE_SIDE } from '../../../shared/gameSettings'
import { makeGame, zoneEntry } from '../../../shared/engine/testFixtures'
import { zoneCapFor } from '../../../shared/engine/zoneCapacity'

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

// ⚠ Ruling R-3 — Sacrilego is **10,000**, not a dropped zero. Pinned here so
// it cannot drift back to 80k or 100k silently.
//
// Every SS card the 2026-09-02 pass touched, spelled out. Keywords compare as
// SETS — order in the seed literal is not meaningful.
const CARDS: Record<string, Expected> = {
  'SS:Tyr': {
    materialCost: 950_000, blueprintCost: 983_000, keywords: ['blocker'],
    vehicleType: 'ship',
    cardText: 'This card costs 60k less for every turn it spends in your hand',
  },
  'SS:Tiger Shark': {
    materialCost: 690_000, blueprintCost: 914_000, keywords: [], vehicleType: 'ship',
    cardText: 'While this vehicle is alive, your opponent has 3 fewer vehicle slots in this zone. This does not stack.',
  },
  'SS:Thresher Shark': {
    materialCost: 580_000, blueprintCost: 914_000,
    keywords: ['blocker', 'subScreen'], vehicleType: 'ship',
    cardText: 'While you have less resources than this costs, you may play it with HALFCOST and INOFFENSIVE',
  },
  'SS:Bull Shark': {
    materialCost: 640_000, blueprintCost: 898_000,
    keywords: ['blocker', 'subScreen'], vehicleType: 'ship',
    cardText: 'Whenever this survives an offensive fleet battle, deal 200k damage to enemy base in this zone',
  },
  // An ability, so vehicleType null. cpCost 2 — the card buys itself with CP,
  // not with resources it is itself printing.
  'SS:Cash advance': {
    materialCost: 0, blueprintCost: 0, keywords: [], vehicleType: null, cpCost: 2,
    cardText: 'Gain 150k resources this turn, then draw a card.',
  },
  'SS:Victoria': {
    materialCost: 250_000, blueprintCost: 270_185, keywords: [], vehicleType: 'ship',
    cardText: 'When this vehicle is played, pick one SS ship in hand and reduce its cost by 75k',
  },
  'SS:Trondheim': {
    materialCost: 375_000, blueprintCost: 393_000, keywords: ['blocker'], vehicleType: 'ship',
    cardText: 'When this vehicle is destroyed, draw an SS ship from your deck and reduce its cost by 75k',
  },
  'SS:Resolute': {
    materialCost: 60_000, blueprintCost: 63_300, keywords: [], vehicleType: 'ship',
    cardText: 'When this vehicle is played, draw an SS ship from your deck and reduce its cost by 40k',
  },
  'SS:Air Strafe': {
    materialCost: 150_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Choose an enemy vehicle, it fights alone against two predatorX. If the target is a player design, also spawn your choice of hydra or cyclone',
  },
  'SS:Repairmen Ready': {
    materialCost: 0, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Grant target vehicle scrappy. If the target is an SS vehicle that costs less than 400k, draw a card.',
  },
  'SS:Excalibur': {
    materialCost: 550_000, blueprintCost: 553_900, keywords: ['blocker'], vehicleType: 'ship',
    cardText: 'Pick one SS ship in hand and reduce its cost by 200k',
  },
  'SS:Braveheart': {
    materialCost: 350_000, blueprintCost: 371_000, keywords: [], vehicleType: 'ship',
    cardText: 'Once per turn, you may pay 1cp to have one of your ships in this zone 1v1 an enemy vehicle in the same zone',
  },
  'SS:Nothung': {
    materialCost: 400_000, blueprintCost: 478_000, keywords: ['blocker'], vehicleType: 'ship',
    cardText: 'When this vehicle is played, reduce the cost of every SS ship in your hand by 40k',
  },
  'SS:Sacrilego': {
    materialCost: 10_000, blueprintCost: 86_000,
    keywords: ['scrappy', 'stealthy', 'mobile'], vehicleType: 'ship',
    cardText: 'Whenever this vehicle participates in a fleet battle, friendly ships receive SCRAPPY keyword for that battle. Whenever this vehicle survives a fleet battle, reduce the cost of SS ships in hand by 30k.',
  },
  'SS:Typhoon': {
    materialCost: 130_000, blueprintCost: 135_323, keywords: [], vehicleType: 'sub',
    cardText: 'When played into a zone, summon a second copy of it in that zone',
  },
  'SS:Cyclone': {
    materialCost: 280_000, blueprintCost: 281_000, keywords: [], vehicleType: 'sub',
    cardText: 'When this vehicle is played into a zone, grant every enemy vehicle in that zone FRAGILE',
  },
  'SS:Spectre': {
    materialCost: 200_000, blueprintCost: 214_000, keywords: ['stealthy'], vehicleType: 'ship',
    cardText: 'When this vehicle is played, reduce your opponent CP by 1',
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

  // A data key's VALUE is never checked by any guard, only its presence
  // (docs/claude/card-effects.md, blind spot 4) — and this value IS the rule:
  // zoneCapFor subtracts exactly this number. `2` or `"3"` would leave a card
  // that is inert AND invisible, with no guard failure and no "plays as
  // vanilla" note either.
  it('Tiger Shark denies exactly three slots', async () => {
    expect((await bySeedKey()).get('SS:Tiger Shark')!.meta?.slotDenial).toBe(3)
  })

  // The whole card is that one data key, so if it ever left DATA_EFFECT_KEYS
  // the card would become a G2 offender with no other symptom.
  it('slotDenial is a recognised data key', () => {
    expect([...DATA_EFFECT_KEYS]).toContain('slotDenial')
  })

  // Reads the SEED rather than a fixture: the engine rule and the printed
  // number have to agree, and only a seed-backed test can say they do. Lives
  // here rather than shared/engine/zoneCapacity.test.ts per the task-6 brief's
  // own escape hatch — dwgEffects.test.ts documents "nothing under shared/
  // may read the seed", and this file already loads it for every other
  // seed-backed cross-check of this shape.
  it('a seeded Tiger Shark takes three slots off the enemy cap', async () => {
    const { cards } = await loadSeedData()
    const row = cards.find((c) => c.faction === 'SS' && c.name === 'Tiger Shark')!
    const g = makeGame()
    g.state.zones[0].cards.b.push(zoneEntry({ name: row.name, meta: row.meta ?? {} }))
    expect(zoneCapFor(g.state, 'a', 1)).toBe(MAX_VEHICLES_PER_ZONE_SIDE - 3)
  })

  // resourceSurge is a DATA_EFFECT_KEY, so G2 closes the card on the key
  // EXISTING and never looks inside. Compared field by field: a materialsOver
  // where the card says "less than" would invert the whole card silently.
  //
  // The threshold IS the printed cost. Asserted against the row's own
  // materialCost as well as against the literal, because those two numbers
  // moving apart is exactly how this card would quietly stop working.
  it('Thresher Shark surges UNDER its own printed cost, granting halfCost and inoffensive', async () => {
    const card = (await bySeedKey()).get('SS:Thresher Shark')!
    expect(card.meta?.resourceSurge).toEqual({
      materialsUnder: 580_000, grantKeywords: ['halfCost', 'inoffensive'],
    })
    expect((card.meta?.resourceSurge as { materialsUnder: number }).materialsUnder)
      .toBe(card.materialCost)
  })

  // A DATA_EFFECT_KEY, so G2 closes the card on the key existing and never
  // looks at the number. `2` here would land three hulls for one payment.
  it('Typhoon deploys exactly one extra hull', async () => {
    expect((await bySeedKey()).get('SS:Typhoon')!.meta?.additionalSpawns).toBe(1)
  })

  // Spec §7.1's near miss: additionalSpawns is resolved by deployVehicle from
  // the card in hand, so no catalog is involved and Typhoon names no effect at
  // all. Asserted so nobody "fixes" it by writing one.
  it('Typhoon names no effect — the extra hull is placement, not an effect', async () => {
    const meta = (await bySeedKey()).get('SS:Typhoon')!.meta ?? {}
    expect(Object.keys(meta)).toEqual(['additionalSpawns'])
  })
})
