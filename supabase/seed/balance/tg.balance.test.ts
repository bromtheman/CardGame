import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'
import { KEYWORDS } from '../../../shared/gameSettings'

// The 2026-09-02 balance pass — TG's share, pinned against the seed source.
//
// One file per faction so the five faction branches never edit the same test
// file (spec §2.3). Costs, keywords and card text are plain data that nothing
// else in the suite reads: effectCoverage asks only whether a card's EFFECTS
// are wired, and seedDataSync only whether the generated SQL matches its
// source. Both stay green if a number is fat-fingered. This file would not.
//
// Numbers are spelled out, never derived — a test that recomputes its
// expectation from the source it is checking proves nothing.
//
// It deliberately overlaps supabase/seed/tgFaction.test.ts, which pins the
// same rows as WAVE 7 left them and was repaired in place by this wave. Two
// files, two stories: a reader who breaks one learns which change they broke.
// This file additionally covers three things tgFaction.test.ts cannot see —
// cpCost, meta effect names, and card text.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

const keywordsOf = (card: SeedCard): string[] => [...(card.keywords ?? [])].sort()
const metaOf = (card: SeedCard) => (card.meta ?? {}) as Record<string, unknown>

describe('2026-09-02 balance pass — TG, the five new cards', () => {
  interface Expected {
    materialCost: number
    blueprintCost: number
    cpCost: number
    vehicleType: string | null
    type: string
    keywords: string[]
    effect: [string, string] | null
  }

  const NEW: Record<string, Expected> = {
    Mania: {
      materialCost: 270_000, blueprintCost: 574_000, cpCost: 0,
      vehicleType: 'ship', type: 'vehicle',
      keywords: ['robotic', 'upkeepRequired'], effect: null,
    },
    'Spawn Audacious': {
      materialCost: 40_000, blueprintCost: 0, cpCost: 0,
      vehicleType: null, type: 'ability',
      keywords: [], effect: ['playOnZoneEffect', 'spawnAudaciousEffect'],
    },
    Agony: {
      materialCost: 375_000, blueprintCost: 440_000, cpCost: 0,
      vehicleType: 'sub', type: 'vehicle',
      keywords: ['blocker'], effect: ['onPlayEffect', 'agonyOnPlay'],
    },
    Wonder: {
      materialCost: 700_000, blueprintCost: 865_000, cpCost: 0,
      vehicleType: 'ship', type: 'vehicle',
      keywords: [], effect: ['onPlayEffect', 'wonderOnPlay'],
    },
    Repurpose: {
      materialCost: 0, blueprintCost: 0, cpCost: 1,
      vehicleType: null, type: 'ability',
      keywords: [], effect: ['playOnVehicleEffect', 'repurposeEffect'],
    },
  }

  it.each(Object.entries(NEW))('%s carries its authored numbers', async (name, want) => {
    const card = (await bySeedKey()).get(`TG:${name}`)
    expect(card, `${name} is missing from the seed`).toBeDefined()
    expect(card!.materialCost).toBe(want.materialCost)
    expect(card!.blueprintCost).toBe(want.blueprintCost)
    expect(card!.cpCost).toBe(want.cpCost)
    expect(card!.vehicleType ?? null).toBe(want.vehicleType)
    expect(card!.type).toBe(want.type)
    expect(keywordsOf(card!)).toEqual([...want.keywords].sort())
  })

  it.each(Object.entries(NEW))('%s names the effect it was built with', async (name, want) => {
    const meta = metaOf((await bySeedKey()).get(`TG:${name}`)!)
    if (want.effect === null) {
      expect(Object.keys(meta)).toEqual([])
    } else {
      expect(meta[want.effect[0]]).toBe(want.effect[1])
    }
  })

  // ⚠ Repurpose is the FIRST TG card with a non-zero cpCost, and
  // tgFaction.test.ts's CARDS map does not check cpCost at all. Pinned on its
  // own so the omission is visible rather than inherited.
  it('Repurpose is the only TG card that costs CP', async () => {
    const { cards } = await loadSeedData()
    const paying = cards.filter((c) => c.isBuiltIn && c.faction === 'TG' && c.cpCost > 0)
    expect(paying.map((c) => c.name)).toEqual(['Repurpose'])
    expect(paying[0].cpCost).toBe(1)
  })

  // Mania is vanilla ON PURPOSE. Blank text is why G2 never inspects it, and
  // empty meta is why G1 and G4 have nothing to say — asserted rather than
  // assumed, because "the card does nothing" reads like an unfinished task.
  it('Mania is deliberately vanilla', async () => {
    const card = (await bySeedKey()).get('TG:Mania')!
    expect(card.cardText ?? '').toBe('')
    expect(Object.keys(metaOf(card))).toEqual([])
  })
})

describe('2026-09-02 balance pass — TG, the sixteen updated cards', () => {
  interface Moved {
    materialCost: number
    keywords: string[]
    vehicleType: string | null
  }

  // Every card the pass moved, at its NEW value. blueprintCost is absent on
  // purpose: this pass names material costs only, and tgFaction.test.ts still
  // pins the blueprints wave 7 set.
  const MOVED: Record<string, Moved> = {
    Horror: { materialCost: 50_000, keywords: ['robotic'], vehicleType: 'ship' },
    Duel: { materialCost: 0, keywords: [], vehicleType: null },
    Spite: { materialCost: 120_000, keywords: [], vehicleType: 'sub' },
    Loathing: { materialCost: 225_000, keywords: [], vehicleType: 'ship' },
    Jealousy: { materialCost: 375_000, keywords: ['blocker'], vehicleType: 'airship' },
    Obsession: { materialCost: 300_000, keywords: ['robotic', 'upkeepRequired'], vehicleType: 'ship' },
    Euphoria: { materialCost: 300_000, keywords: ['robotic', 'upkeepRequired'], vehicleType: 'ship' },
    Anguish: { materialCost: 200_000, keywords: ['robotic', 'upkeepRequired'], vehicleType: 'airship' },
    Curiosity: { materialCost: 40_000, keywords: [], vehicleType: 'airship' },
    Vengeful: { materialCost: 150_000, keywords: [], vehicleType: 'sub' },
    'Havoc Factory': { materialCost: 25_000, keywords: [], vehicleType: null },
    'Mirth Factory': { materialCost: 60_000, keywords: [], vehicleType: null },
    Fear: { materialCost: 500_000, keywords: ['blocker', 'robotic', 'upkeepRequired'], vehicleType: 'ship' },
    Nostalgia: { materialCost: 75_000, keywords: ['robotic'], vehicleType: 'ship' },
    Alarmed: { materialCost: 0, keywords: ['robotic'], vehicleType: 'airship' },
    Obelisk: { materialCost: 40_000, keywords: ['stealthy'], vehicleType: 'ship' },
  }

  it('moves exactly sixteen cards', () => {
    expect(Object.keys(MOVED)).toHaveLength(16)
  })

  it.each(Object.entries(MOVED))('%s sits at its post-pass values', async (name, want) => {
    const card = (await bySeedKey()).get(`TG:${name}`)
    expect(card, `${name} is missing from the seed`).toBeDefined()
    expect(card!.materialCost).toBe(want.materialCost)
    expect(keywordsOf(card!)).toEqual([...want.keywords].sort())
    expect(card!.vehicleType ?? null).toBe(want.vehicleType)
  })

  // ⚠ A literal zero is the shape a stray `|| DEFAULT` swallows without a
  // trace, so it gets its own assertion rather than riding the table above.
  it('Alarmed really is zero, not merely falsy', async () => {
    const card = (await bySeedKey()).get('TG:Alarmed')!
    expect(card.materialCost).toBe(0)
    expect(typeof card.materialCost).toBe('number')
  })

  // ⚠ Obelisk is a SHIP now, not a typo. The change moves it out of
  // SUB_COPY_LIMIT accounting in validateDeck, so a deck at the 6-sub limit
  // that holds Obelisk silently gains headroom (spec §6.4).
  it('Obelisk is a ship, and the TG subs are exactly these three', async () => {
    const { cards } = await loadSeedData()
    const subs = cards
      .filter((c) => c.isBuiltIn && c.faction === 'TG' && c.vehicleType === 'sub')
      .map((c) => c.name)
      .sort()
    expect(subs).toEqual(['Agony', 'Spite', 'Vengeful'])
  })
})

describe('2026-09-02 balance pass — TG, the text and the ids', () => {
  const textOf = async (name: string) => ((await bySeedKey()).get(`TG:${name}`)!.cardText ?? '')

  // `anther` is the card's own spelling and the delivered note keeps it.
  // Card text is data and is authoritative (2026-08-27 spec, decision 1).
  it('Horror keeps its own spelling, and now says "offensive"', async () => {
    expect(await textOf('Horror')).toBe(
      'Whenever a horror participates in an offensive fleet battle, create anther copy of it in this zone. Max one spawn per zone',
    )
  })

  it('Duel prints the draw clause', async () => {
    expect(await textOf('Duel')).toBe(
      'Target a friendly and enemy vehicle. They can be in different zones. they 1v1. If the opponents vehicle dies, draw a card.',
    )
  })

  // The casing fix, and only the casing fix — "along side" is the card's.
  it('Mirth Factory names a Mirth swarm rather than a mIRTH one', async () => {
    expect(await textOf('Mirth Factory')).toBe(
      'Target friendly robotic vehicle. Whenever that vehicle is engaged in a fleet combat, spawn a Mirth swarm to fight along side it',
    )
  })

  it('Spite and Agony print the same sentence', async () => {
    expect(await textOf('Spite')).toBe('When played, grant an enemy vehicle FRAGILE')
    expect(await textOf('Agony')).toBe(await textOf('Spite'))
  })

  // Spec R-6, at the data layer. Identical text, two ids — and a shared id
  // would rebind one card's behaviour mid-game for every dealt game at once.
  it('R-6: Spite and Agony name DIFFERENT implementations', async () => {
    const byKey = await bySeedKey()
    const spite = metaOf(byKey.get('TG:Spite')!).onPlayEffect
    const agony = metaOf(byKey.get('TG:Agony')!).onPlayEffect
    expect(spite).toBe('spiteOnPlay')
    expect(agony).toBe('agonyOnPlay')
    expect(spite).not.toBe(agony)
  })

  // R-6 across factions: Spawn Audacious must never name DWG's implementation.
  it('R-6: Spawn Audacious does not borrow spawnBuccaneerEffect', async () => {
    const meta = metaOf((await bySeedKey()).get('TG:Spawn Audacious')!)
    expect(meta.playOnZoneEffect).toBe('spawnAudaciousEffect')
  })

  it('Loathing and Hysteria keep separate ids for the same keyword', async () => {
    const byKey = await bySeedKey()
    expect(metaOf(byKey.get('TG:Loathing')!).onPlayEffect).toBe('loathingOnPlay')
    expect(metaOf(byKey.get('TG:Hysteria')!).onPlayEffect).toBe('hysteriaOnPlay')
  })
})

// ---------------------------------------------------------------------------
// The two-vocabulary trap, from the TG side.
//
// supabase/seed/source/*.js import supabase/seed/source/gameSettings.js — a
// SECOND hand-maintained keyword map. A keyword added to shared/gameSettings.ts
// alone evaluates to `undefined` in the seed source and writes `null` into
// jsonb with no error and every guard green (docs/claude/card-effects.md).
//
// This wave adds no keyword, so this is a guard against a later one — and it
// is cheap. tgFaction.test.ts compares the two MAPS; this compares the VALUES
// that actually reached the rows.
describe('2026-09-02 balance pass — TG writes no keyword the engine does not know', () => {
  it('every keyword on every TG row is a shared KEYWORDS value', async () => {
    const { cards } = await loadSeedData()
    const known = Object.values(KEYWORDS)
    for (const card of cards.filter((c) => c.isBuiltIn && c.faction === 'TG')) {
      for (const keyword of card.keywords ?? []) {
        expect(known, `${card.name} carries an unknown keyword`).toContain(keyword)
      }
    }
  })
})
