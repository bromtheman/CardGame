import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'
import { poolEligible } from '../../shared/effects/primitives'
import type { SeedCard } from '../../shared/types'

// The 2026-08-30 balance pass, pinned against the seed source.
//
// Costs, keywords and card text are plain data, so nothing else in the suite
// reads them: effectCoverage only asks whether a card's EFFECTS are wired, and
// seedDataSync only asks whether the generated SQL matches the source it was
// generated from. Both stay green if a number is fat-fingered. This file is
// the one that would not.
//
// It deliberately spells the numbers out rather than deriving them — a test
// that recomputes its expectation from the same source it is checking proves
// nothing.

const AIRCRAFT_LOCK =
  'While this vehicle is alive, you may not play any other aircraft into this zone'

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

interface Expected {
  materialCost: number
  blueprintCost: number
  keywords: string[]
  vehicleType?: string | null
  cardText?: string
}

// materialCost/blueprintCost/keywords for every card the pass touched or
// introduced. Keywords are compared as sets — order in the seed literal is
// not meaningful.
const CARDS: Record<string, Expected> = {
  // ---------------------------------------------------------------- DWG
  'DWG:Sinners Luck': {
    materialCost: 250_000, blueprintCost: 267_000, keywords: ['scrappy'],
    vehicleType: 'ship', cardText: '',
  },
  'DWG:Albacore': {
    materialCost: 260_000, blueprintCost: 261_000, keywords: ['fragile'],
    vehicleType: 'airship', cardText: AIRCRAFT_LOCK,
  },
  'DWG:Tarpon': {
    materialCost: 510_000, blueprintCost: 511_605, keywords: ['fragile'],
    vehicleType: 'airship', cardText: AIRCRAFT_LOCK,
  },
  'DWG:Buccaneer': {
    materialCost: 200_000, blueprintCost: 296_000, keywords: [],
    vehicleType: 'airship', cardText: '',
  },
  // ----------------------------------------------------------------- SS
  'SS:Chrysaor': {
    materialCost: 100_000, blueprintCost: 116_000, keywords: ['stealthy'], vehicleType: 'ship',
  },
  'SS:Paladin': {
    materialCost: 240_000, blueprintCost: 240_000, keywords: [], vehicleType: 'ship',
  },
  'SS:Argonaut': {
    materialCost: 90_000, blueprintCost: 94_000, keywords: ['scrappy'],
    vehicleType: 'ship', cardText: '',
  },
  'SS:Nothung': {
    materialCost: 470_000, blueprintCost: 478_000, keywords: ['blocker'], vehicleType: 'ship',
  },
  'SS:Balmung': {
    materialCost: 630_000, blueprintCost: 636_000, keywords: ['blocker'], vehicleType: 'ship',
  },
  'SS:Asphodel': {
    materialCost: 470_000, blueprintCost: 544_000, keywords: ['airScreen'],
    vehicleType: 'ship', cardText: '',
  },
  'SS:Victoria': {
    materialCost: 250_000, blueprintCost: 270_185, keywords: [], vehicleType: 'ship',
  },
  'SS:Braveheart': {
    materialCost: 350_000, blueprintCost: 371_000, keywords: [], vehicleType: 'ship',
  },
  'SS:Blockade': {
    materialCost: 100_000, blueprintCost: 0, keywords: [], vehicleType: null,
  },
  // ----------------------------------------------------------------- WF
  'WF:Harbringer': {
    materialCost: 550_000, blueprintCost: 551_000, keywords: ['subScreen'], vehicleType: 'ship',
  },
  'WF:Pontus': {
    materialCost: 150_000, blueprintCost: 56_000, keywords: ['fragile'], vehicleType: 'sub',
  },
  'WF:Basher': {
    materialCost: 210_000, blueprintCost: 214_000, keywords: [], vehicleType: 'ship',
  },
  'WF:Judgement': {
    materialCost: 540_000, blueprintCost: 546_000, keywords: [], vehicleType: 'ship',
  },
  'WF:Purifier': {
    materialCost: 750_000, blueprintCost: 765_000, keywords: ['halfCost', 'fragile'],
    vehicleType: 'ship',
  },
}

describe('2026-08-30 balance pass', () => {
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
    if (want.cardText !== undefined) expect(card!.cardText ?? '').toBe(want.cardText)
  })

  it('Rhea is gone from the catalog', async () => {
    expect((await bySeedKey()).has('SS:Rhea')).toBe(false)
  })

  // The seeded thresholds the ENGINE compares, not just displays. A data key's
  // value is never checked by the coverage guard (docs/claude/card-effects.md,
  // blind spot 4), so each one needs its own assertion here.
  it('Pontus deploys three hulls off one payment', async () => {
    expect((await bySeedKey()).get('WF:Pontus')!.meta?.additionalSpawns).toBe(2)
  })

  it('Double Up and Repairmen Ready print the thresholds their code enforces', async () => {
    const cards = await bySeedKey()
    expect(cards.get('DWG:Double Up')!.cardText).toBe(
      'Target DWG ship card in hand That costs less than 400k. spawns an additional copy of that ship when played',
    )
    expect(cards.get('SS:Repairmen Ready')!.cardText).toBe(
      'Grant target vehicle scrappy. If the target is an AI vehicle that costs less than 400k, draw a card.',
    )
  })

  // Braveheart's balance note shipped an empty meta while leaving its card
  // text untouched, which would have silently deleted the ability the text
  // still promises. Both keys are required or ACTIVATE_VEHICLE refuses and
  // BoardZone renders no button.
  it('Braveheart keeps the activated ability its unchanged text promises', async () => {
    expect((await bySeedKey()).get('SS:Braveheart')!.meta).toMatchObject({
      onActivate: 'braveheartActivate', activateCpCost: 1,
    })
  })

  // ------------------------------------------------------------- wave 6
  //
  // Harbringer's pool ("one WF ship that costs <=100k") is exactly two cards
  // today, so its empty-pool path is unreachable and a filter typo would be
  // INVISIBLE — every unit test would still pass against a hand-built
  // catalog. Pinning the real membership off the seed is the only thing that
  // would notice the pool silently changing shape.
  //
  // The Repentance is the sharp one: a WF PLANE at exactly 100_000. It is
  // excluded by the vehicleType filter alone, so this assertion is what
  // proves that filter is doing work.
  // Purifier's whole card text is still data keys and it still names no effect
  // — but the 2026-09-02 pass swapped one of the two rules
  // (deployRequiresBattleLoss out, deployOrder in). Kept here rather than moved
  // wholesale to wf.balance.test.ts: the 2026-08-30 file is updated in place
  // where a later pass moves one of its numbers (2026-09-02 spec §2.3).
  it('Purifier carries both of its data rules', async () => {
    expect((await bySeedKey()).get('WF:Purifier')!.meta).toMatchObject({
      noBaseDamage: true, deployOrder: 'last',
    })
  })

  // Albacore and Tarpon carry NO registry name at all — their one sentence is
  // a placement rule read straight off this key, so this assertion is the only
  // thing standing between a typo and two inert cards that no guard notices.
  it.each(['DWG:Albacore', 'DWG:Tarpon'])('%s locks its zone against its owner aircraft', async (k) => {
    expect((await bySeedKey()).get(k)!.meta?.aircraftLock).toBe(true)
  })

  // Both surges are compared FIELD BY FIELD rather than for mere presence:
  // resourceSurge is a DATA_EFFECT_KEY, so G2 closes both cards on the key
  // existing and never looks at what is in it. A mistyped comparator
  // (materialsOver where the card says "less than") would leave a card that
  // is inert AND invisible — no guard failure, and no "plays as vanilla" note
  // either.
  it('Chrysaor surges over 200k for +100k and a second hull', async () => {
    expect((await bySeedKey()).get('SS:Chrysaor')!.meta?.resourceSurge).toEqual({
      materialsOver: 200_000, extraSpawns: 1, costDelta: 100_000,
    })
  })

  it('Paladin surges UNDER 240k, granting halfCost and temporary', async () => {
    expect((await bySeedKey()).get('SS:Paladin')!.meta?.resourceSurge).toEqual({
      materialsUnder: 240_000, grantKeywords: ['halfCost', 'temporary'],
    })
  })

  // Victoria's text says "spend 200k resources" — a MATERIAL price, the first
  // in the game. Same silent-pair trap as Judgement below: without the key the
  // card has a registered ability and no way to press it.
  it('Victoria carries the 200k material price its text prints', async () => {
    expect((await bySeedKey()).get('SS:Victoria')!.meta).toMatchObject({
      onActivate: 'victoriaActivate', activateMaterialCost: 200_000,
    })
  })

  // Judgement's text says "pay 1cp", and ACTIVATE_VEHICLE refuses a card with
  // no price key at all — so without this, the card would have a registered
  // ability, a card text promising it, and no way to press it. The same
  // silent-pair trap Braveheart's assertion above exists for.
  it('Judgement carries the 1cp price its text prints', async () => {
    expect((await bySeedKey()).get('WF:Judgement')!.meta).toMatchObject({
      costModifier: 'judgementCostModifier',
      onActivate: 'judgementActivate',
      activateCpCost: 1,
    })
  })

  // Filters through the shared poolEligible predicate — the same one
  // harbringerPool() (shared/effects/wfEffects.ts) calls — rather than a
  // hand-rolled `summonOnly` check, so this pin cannot silently drift from
  // the implementation the way the smoke harness once did (2026-09-02 review
  // finding 7). It excludes `retired` as well as `summonOnly`: no WF ship at
  // or under 100k is retired today, but if one ever is, harbringerPool()
  // drops it and this expectation must too.
  it('Harbringer draws from exactly the WF ships at or under 100k', async () => {
    const { cards } = await loadSeedData()
    const pool = cards
      .filter((c) => (
        c.isBuiltIn && c.faction === 'WF' && c.type === 'vehicle' &&
        c.vehicleType === 'ship' && c.materialCost <= 100_000 &&
        poolEligible({ meta: c.meta ?? {} })
      ))
      .map((c) => c.name)
      .sort()
    expect(pool).toEqual(['Buzzsaw', 'Earth Raker'])
    const repentance = cards.find((c) => c.faction === 'WF' && c.name === 'The Repentance')!
    expect({ vt: repentance.vehicleType, cost: repentance.materialCost })
      .toEqual({ vt: 'plane', cost: 100_000 })
  })
})
