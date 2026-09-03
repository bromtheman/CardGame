import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'
import type { SeedCard } from '../../shared/types'
import { FACTIONS, KEYWORDS, TRIGGERS, VEHICLE_TYPES } from '../../shared/gameSettings'

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

// ---------------------------------------------------------------------------
// The 26 new TG cards, pinned field by field against the seed source.
//
// Read off the file rather than off the handoff's tables: card text is
// authoritative (spec decision 1), and every wave so far has found at least
// one place where a summary had drifted from the card.
describe('the TG faction cards, as the 2026-09-02 pass left them', () => {
  interface Expected {
    materialCost: number
    blueprintCost: number
    vehicleType: string | null
    type: string
    keywords: string[]
  }

  const V = 'vehicle'
  const A = 'ability'
  const CARDS: Record<string, Expected> = {
    Jealousy: { materialCost: 375_000, blueprintCost: 406_000, vehicleType: 'airship', type: V, keywords: ['blocker'] },
    Obsession: { materialCost: 300_000, blueprintCost: 337_000, vehicleType: 'ship', type: V, keywords: ['robotic', 'upkeepRequired'] },
    Euphoria: { materialCost: 300_000, blueprintCost: 581_000, vehicleType: 'ship', type: V, keywords: ['robotic', 'upkeepRequired'] },
    Ecstasy: { materialCost: 224_000, blueprintCost: 224_000, vehicleType: 'ship', type: V, keywords: [] },
    Horror: { materialCost: 50_000, blueprintCost: 77_000, vehicleType: 'ship', type: V, keywords: ['robotic'] },
    Nostalgia: { materialCost: 75_000, blueprintCost: 98_000, vehicleType: 'ship', type: V, keywords: ['robotic'] },
    Optimism: { materialCost: 410_000, blueprintCost: 419_000, vehicleType: 'airship', type: V, keywords: [] },
    // An airship carrying SUB_SCREEN — every other Sub Screen in the game is a
    // ship. screenBlocks does not care what type the screening hull is, so it
    // works; pinned because it reads like a data error to the next reader.
    Frustration: { materialCost: 90_000, blueprintCost: 96_000, vehicleType: 'airship', type: V, keywords: ['stealthy', 'subScreen'] },
    Joy: { materialCost: 390_000, blueprintCost: 398_000, vehicleType: 'airship', type: V, keywords: ['upkeepRequired'] },
    Alarmed: { materialCost: 0, blueprintCost: 250_000, vehicleType: 'airship', type: V, keywords: ['robotic'] },
    Amusement: { materialCost: 330_000, blueprintCost: 334_000, vehicleType: 'airship', type: V, keywords: ['robotic', 'upkeepRequired'] },
    // blueprintCost UNDER materialCost here and on Curiosity, Obelisk, both
    // Factories and Duel: intentional buffs, not typos. blueprintCost is
    // display-only for built-ins and drives nothing mechanical.
    Anguish: { materialCost: 200_000, blueprintCost: 202_000, vehicleType: 'airship', type: V, keywords: ['robotic', 'upkeepRequired'] },
    Curiosity: { materialCost: 40_000, blueprintCost: 46_000, vehicleType: 'airship', type: V, keywords: [] },
    Duel: { materialCost: 0, blueprintCost: 0, vehicleType: null, type: A, keywords: [] },
    Fear: { materialCost: 500_000, blueprintCost: 800_000, vehicleType: 'ship', type: V, keywords: ['blocker', 'robotic', 'upkeepRequired'] },
    Hysteria: { materialCost: 730_000, blueprintCost: 733_000, vehicleType: 'ship', type: V, keywords: ['blocker', 'robotic', 'upkeepRequired'] },
    Acceptance: { materialCost: 150_000, blueprintCost: 159_000, vehicleType: 'plane', type: V, keywords: ['halfCost', 'temporary'] },
    Audacious: { materialCost: 660_000, blueprintCost: 665_000, vehicleType: 'plane', type: V, keywords: ['halfCost', 'temporary'] },
    Spite: { materialCost: 120_000, blueprintCost: 128_000, vehicleType: 'sub', type: V, keywords: [] },
    Agony: { materialCost: 375_000, blueprintCost: 440_000, vehicleType: 'sub', type: V, keywords: ['blocker'] },
    Vengeful: { materialCost: 150_000, blueprintCost: 168_000, vehicleType: 'sub', type: V, keywords: [] },
    // 120k, not the supplied 1,200,000 — its blueprint cost was already 120k.
    'Havoc Swarm': { materialCost: 120_000, blueprintCost: 120_000, vehicleType: 'plane', type: V, keywords: ['halfCost', 'robotic', 'temporary'] },
    'Mirth Swarm': { materialCost: 200_000, blueprintCost: 200_000, vehicleType: 'plane', type: V, keywords: ['halfCost', 'robotic', 'temporary'] },
    'Havoc Factory': { materialCost: 25_000, blueprintCost: 0, vehicleType: null, type: A, keywords: [] },
    'Mirth Factory': { materialCost: 60_000, blueprintCost: 0, vehicleType: null, type: A, keywords: [] },
    Obelisk: { materialCost: 40_000, blueprintCost: 32_000, vehicleType: 'ship', type: V, keywords: ['stealthy'] },
    Loathing: { materialCost: 225_000, blueprintCost: 268_000, vehicleType: 'ship', type: V, keywords: [] },
    Wonder: { materialCost: 700_000, blueprintCost: 865_000, vehicleType: 'ship', type: V, keywords: [] },
    Repurpose: { materialCost: 0, blueprintCost: 0, vehicleType: null, type: A, keywords: [] },
    'Spawn Audacious': { materialCost: 40_000, blueprintCost: 0, vehicleType: null, type: A, keywords: [] },
    Mania: { materialCost: 270_000, blueprintCost: 574_000, vehicleType: 'ship', type: V, keywords: ['robotic', 'upkeepRequired'] },
  }

  it('seeds exactly 31 new cards, and 35 TG rows in total with the borrowed four', async () => {
    const { cards } = await loadSeedData()
    const tg = cards.filter((c) => c.isBuiltIn && c.faction === 'TG')
    const fresh = tg.filter((c) => !c.name.startsWith('[TG] '))
    expect(fresh).toHaveLength(31)
    expect(tg).toHaveLength(35)
    expect(fresh.map((c) => c.name).sort()).toEqual(Object.keys(CARDS).sort())
  })

  it.each(Object.entries(CARDS))('%s carries its authored numbers', async (name, want) => {
    const card = (await bySeedKey()).get(`TG:${name}`)
    expect(card, `${name} is missing from the seed`).toBeDefined()
    expect(card!.materialCost).toBe(want.materialCost)
    expect(card!.blueprintCost).toBe(want.blueprintCost)
    expect(card!.vehicleType ?? null).toBe(want.vehicleType)
    expect(card!.type).toBe(want.type)
    expect(keywordsOf(card!)).toEqual([...want.keywords].sort())
  })

  it('splits 8 airship / 11 ship / 4 plane / 3 sub / 5 ability', async () => {
    const { cards } = await loadSeedData()
    const fresh = cards.filter((c) => c.isBuiltIn && c.faction === 'TG' && !c.name.startsWith('[TG] '))
    const count = (fn: (c: SeedCard) => boolean) => fresh.filter(fn).length
    expect(count((c) => c.vehicleType === 'airship')).toBe(8)
    expect(count((c) => c.vehicleType === 'ship')).toBe(11)
    expect(count((c) => c.vehicleType === 'plane')).toBe(4)
    expect(count((c) => c.vehicleType === 'sub')).toBe(3)
    expect(count((c) => c.type === 'ability')).toBe(5)
  })

  it('renames Extasy to Ecstasy — a correction that had to precede the first seed', async () => {
    const byKey = await bySeedKey()
    expect(byKey.get('TG:Ecstasy')).toBeDefined()
    // transform.ts derives each uuid from `card:TG:<name>`, so renaming after a
    // seed mints a new id, orphans every deck holding the old one, and leaves
    // the stale row in the database.
    expect(byKey.get('TG:Extasy')).toBeUndefined()
  })

  it('marks both Swarms summonOnly, so a destroyed one can never reach a deck', async () => {
    const byKey = await bySeedKey()
    for (const name of ['Havoc Swarm', 'Mirth Swarm']) {
      expect(byKey.get(`TG:${name}`)?.meta?.summonOnly).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// UPKEEP_REQUIRED, priced (spec §7.3, U-0 … U-2).
describe('the upkeep cards and what they cost per turn', () => {
  // Spelled out rather than computed from materialCost — a test that
  // recalculates its expectation from the source it is checking proves nothing.
  const UPKEEP: Record<string, number> = {
    Anguish: 30_000,
    Mania: 40_500,
    Obsession: 45_000,
    Euphoria: 45_000,
    Amusement: 49_500,
    Joy: 58_500,
    Fear: 75_000,
    Hysteria: 109_500,
  }

  it('is carried by exactly the cards in this map', async () => {
    const { cards } = await loadSeedData()
    const carriers = cards
      .filter((c) => c.isBuiltIn && (c.keywords ?? []).includes('upkeepRequired'))
      .map((c) => c.name)
      .sort()
    expect(carriers).toEqual(Object.keys(UPKEEP).sort())
  })

  it.each(Object.entries(UPKEEP))('%s costs %i per turn', async (name, owed) => {
    const card = (await bySeedKey()).get(`TG:${name}`)!
    expect(Math.ceil(card.materialCost * 0.15)).toBe(owed)
  })

  // ⚠ The fact that makes ruling U-1 unobservable on real data: printed cost
  // and effectiveMaterialCostOf agree on every card that exists, so only the
  // fixture in gameEngine.test.ts can separate them. Asserted here so that if
  // a later card ever carries both, this fails and someone re-reads U-1
  // instead of discovering it in a game.
  it('no card carries both UPKEEP_REQUIRED and HALF_COST', async () => {
    const { cards } = await loadSeedData()
    const both = cards.filter((c) => {
      const k = c.keywords ?? []
      return k.includes('upkeepRequired') && k.includes('halfCost')
    })
    expect(both.map((c) => c.name)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The two vocabularies, and the trap wave 7 walked into.
//
// `supabase/seed/source/*.js` import `../gameSettings` — which is
// `supabase/seed/source/gameSettings.js`, a SECOND hand-maintained copy of the
// keyword/faction/trigger vocabulary, NOT `shared/gameSettings.ts`. Nothing
// connected the two, so adding UPKEEP_REQUIRED to the shared file left
// `KEYWORDS.UPKEEP_REQUIRED` evaluating to `undefined` in all ten TG cards
// that print it, and `keywords: [null, "robotic"]` was written into jsonb with
// no error, no log line, and a green guard suite. The seeded-value assertions
// above are what caught it.
//
// This is the durable half of that fix: the next wave to add a keyword, faction
// or trigger cannot make the same mistake silently.
describe('the seed vocabulary matches shared/gameSettings', () => {
  it('KEYWORDS agree exactly, in both directions', async () => {
    const seed = await import('./source/gameSettings.js') as { KEYWORDS: Record<string, string> }
    expect(seed.KEYWORDS).toEqual({ ...KEYWORDS })
  })

  it('TRIGGERS agree exactly, in both directions', async () => {
    const seed = await import('./source/gameSettings.js') as { TRIGGERS: Record<string, string> }
    expect(seed.TRIGGERS).toEqual({ ...TRIGGERS })
  })

  // FACTIONS and VEHICLE_TYPES are the other two a card's fields are built
  // from. Compared as value SETS rather than key-for-key: a seed-only alias
  // would be harmless, a seed value the engine has never heard of would not.
  it('every seeded faction and vehicle type is one the engine knows', async () => {
    const seed = await import('./source/gameSettings.js') as {
      FACTIONS: Record<string, string>
      VEHICLE_TYPES: Record<string, string>
    }
    for (const value of Object.values(seed.FACTIONS)) {
      expect(Object.values(FACTIONS)).toContain(value)
    }
    for (const value of Object.values(seed.VEHICLE_TYPES)) {
      expect(Object.values(VEHICLE_TYPES)).toContain(value)
    }
  })
})

// ---------------------------------------------------------------------------
// Group B — the two cards whose whole behaviour is a data key, with no
// registry name at all (spec §4.8, as Buzzsaw and Veles used to).
//
// ⚠ The guard checks a data key's PRESENCE, never its VALUE (blind spot 4), so
// a mistyped `materialsAtLeast` or an `additionalSpawns: true` would leave the
// card inert AND invisible — no failing guard and no "plays as vanilla" note.
// These are the assertions that would notice. The engine-side halves live in
// shared/engine/placement.test.ts.
describe('group B data keys carry the exact values the engine compares', () => {
  it('Curiosity spawns exactly one extra hull', async () => {
    const card = (await bySeedKey()).get('TG:Curiosity')!
    expect(card.meta.additionalSpawns).toBe(1)
  })

  it('Acceptance surges on "at least", with one extra hull and no keyword grant', async () => {
    const card = (await bySeedKey()).get('TG:Acceptance')!
    // Key for key: an extra `grantKeywords` would silently flip it from the
    // suppressing arm of ruling B-9 to the granting one, and it would still
    // pass a presence check.
    expect(card.meta.resourceSurge).toEqual({ materialsAtLeast: 150_000, extraSpawns: 1 })
  })

  it('gives neither card a registry name to resolve', async () => {
    const byKey = await bySeedKey()
    for (const name of ['Curiosity', 'Acceptance']) {
      const meta = byKey.get(`TG:${name}`)!.meta
      expect(meta.onPlayEffect).toBeUndefined()
      expect(meta.onDeathEffect).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Group D data keys. Value, not presence (blind spot 4).
describe('group D data keys', () => {
  it('Alarmed carries the deploy prerequisite the engine compares', async () => {
    const card = (await bySeedKey()).get('TG:Alarmed')!
    expect(card.meta.deployRequiresAiVehicle).toBe(true)
    expect(card.meta.onPlayEffect).toBe('alarmedOnPlay')
  })
})
