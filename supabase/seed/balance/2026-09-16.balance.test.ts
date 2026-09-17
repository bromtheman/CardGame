import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'
import { CATALOG_EFFECTS, DATA_EFFECT_KEYS, isImplemented } from '../../../shared/effects/registry'
import { FLYING_SQUIRREL_ATTACK_COUNT, SLASHER_EARTH_RAKER_COUNT, TYR_MIN_COST } from '../../../shared/gameSettings'
import '../../../shared/engine/index'

// The 2026-09-16 balance pass, pinned against the seed source — every row it
// touched, new or updated, in one file (one branch, so no per-faction split
// is needed; the 2026-09-02 files were updated in place where this pass moved
// one of their numbers, per that spec's §2.3).
//
// Costs, keywords and card text are plain data that nothing else in the suite
// reads: effectCoverage asks only whether a card's EFFECTS are wired, and
// seedDataSync only whether the generated SQL matches its source. Both stay
// green if a number is fat-fingered. This file would not. Numbers are spelled
// out, never derived.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}
const metaOf = (card: SeedCard) => (card.meta ?? {}) as Record<string, unknown>

interface Expected {
  materialCost: number
  blueprintCost: number
  keywords: string[]
  vehicleType: string | null
  cardText: string
}

const AI_SHIP = {
  victoria: 'When played, pick one AI ship in hand and reduce its cost by 75k',
  trondheim: 'When this vehicle is destroyed, draw an AI ship and reduce its cost by 75k',
  excalibur: 'Pick one AI ship in hand and reduce its cost by 200k',
  nothung: 'When played, reduce the cost of all AI ships in your hand by 40k',
  resolute: 'When this vehicle is played, draw an AI ship from your deck. reduce its cost by 40k',
  argonaut: 'When this is destroyed, reduce the cost of a random AI ship in your hand by 50k',
  sacrilego: 'Whenever this vehicle survives a fleet battle, reduce the cost of AI ships in hand by 30k.',
}

const CARDS: Record<string, Expected> = {
  // ---------------------------------------------------------------- DWG
  'DWG:Mutiny': {
    materialCost: 400_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Choose an enemy vehicle, gain control of it and give it temporary',
  },
  'DWG:Brigand': {
    materialCost: 350_000, blueprintCost: 356_000, keywords: ['scrappy'], vehicleType: 'ship',
    cardText: 'When this is destroyed, draw a copy of Mutiny',
  },
  'DWG:Buccaneer': {
    materialCost: 220_000, blueprintCost: 296_000, keywords: ['scrappy'], vehicleType: 'airship', cardText: '',
  },
  'DWG:Spawn Buccaneer': {
    materialCost: 225_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Spawn a Buccaneer into a zone. It gains the Scrappy keyword.',
  },
  'DWG:Sinners Luck': {
    materialCost: 250_000, blueprintCost: 267_000, keywords: [], vehicleType: 'ship',
    cardText: 'when played, you may swap a friendly airship with an enemy airship or plane. If airship you provide is worth less than what you get, the opponent draws a card and reduces that cards cost by the difference.',
  },
  'DWG:Tarpon': {
    materialCost: 510_000, blueprintCost: 511_605, keywords: ['airScreen'], vehicleType: 'airship', cardText: '',
  },
  'DWG:Albacore': {
    materialCost: 260_000, blueprintCost: 261_000, keywords: ['fragile'], vehicleType: 'airship',
    cardText: 'While this vehicle is alive, you may not play another Albacore into this zone',
  },
  'DWG:Loggerhead': {
    materialCost: 70_000, blueprintCost: 74_000, keywords: ['halfCost'], vehicleType: 'airship',
    cardText: 'When this vehicle is destroyed, shuffle another copt of it into your deck. It costs 0.',
  },
  'DWG:Pilferer': {
    materialCost: 100_000, blueprintCost: 132_000, keywords: ['scrappy'], vehicleType: 'ship',
    cardText: 'When played, spawn another copy of this vehicle into the zone',
  },
  'DWG:Flying Squirrel Attack': {
    materialCost: 100_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Choose an enemy vehicle, that vehicle fights alone against two flying squirrel (3x squadron)',
  },
  // ----------------------------------------------------------------- SS
  'SS:Victoria': { materialCost: 250_000, blueprintCost: 270_185, keywords: [], vehicleType: 'ship', cardText: AI_SHIP.victoria },
  'SS:Trondheim': { materialCost: 375_000, blueprintCost: 393_000, keywords: ['blocker'], vehicleType: 'ship', cardText: AI_SHIP.trondheim },
  'SS:Excalibur': { materialCost: 550_000, blueprintCost: 553_900, keywords: ['blocker'], vehicleType: 'ship', cardText: AI_SHIP.excalibur },
  'SS:Nothung': { materialCost: 400_000, blueprintCost: 478_000, keywords: ['blocker'], vehicleType: 'ship', cardText: AI_SHIP.nothung },
  'SS:Resolute': { materialCost: 60_000, blueprintCost: 63_300, keywords: [], vehicleType: 'ship', cardText: AI_SHIP.resolute },
  'SS:Argonaut': { materialCost: 90_000, blueprintCost: 94_000, keywords: ['scrappy'], vehicleType: 'ship', cardText: AI_SHIP.argonaut },
  'SS:Sacrilego': {
    materialCost: 10_000, blueprintCost: 86_000, keywords: ['scrappy', 'stealthy'], vehicleType: 'ship', cardText: AI_SHIP.sacrilego,
  },
  'SS:Tyr': {
    materialCost: 950_000, blueprintCost: 983_000, keywords: ['blocker', 'fragile'], vehicleType: 'ship',
    cardText: 'This card costs 60k less for every turn it spends in your hand. Min 500k',
  },
  'SS:Spectre': { materialCost: 200_000, blueprintCost: 214_000, keywords: ['stealthy'], vehicleType: 'ship', cardText: '' },
  'SS:Blockade': {
    materialCost: 120_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Choose a zone, whenever the opponent plays a vehicle into that zone while you have at least one vehicle there, a fleet battle immediately begins in that zone. If you lose with no surviving vehicles, the blockade goes away, otherwise it remains.',
  },
  // ----------------------------------------------------------------- TG
  'TG:Fear': {
    materialCost: 500_000, blueprintCost: 800_000, keywords: ['blocker', 'robotic', 'upkeepRequired'],
    vehicleType: 'ship', cardText: 'When this vehicle is played, draw a card',
  },
  'TG:Mirth Swarm': {
    materialCost: 200_000, blueprintCost: 200_000, keywords: ['halfCost', 'robotic', 'temporary'], vehicleType: 'plane',
    cardText: 'No more than one mirth swarm can participate in any one battle on a single side, even if spawned in by card effect',
  },
  'TG:Mirth Factory': {
    materialCost: 60_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Target friendly AI ship. Whenever that vehicle is engaged in a fleet combat, spawn a Mirth swarm to fight along side it',
  },
  'TG:Obelisk': {
    materialCost: 60_000, blueprintCost: 32_000, keywords: [], vehicleType: 'ship',
    cardText: 'Whenever this vehicle participates in a fleet battle, spawn a temporary Mirth swarm to fight on your side in the battlefield. You may only control one Obelisk per zone.',
  },
  'TG:Audacious': {
    materialCost: 660_000, blueprintCost: 665_000, keywords: ['fragile', 'halfCost', 'temporary'], vehicleType: 'plane', cardText: '',
  },
  'TG:Spawn Audacious': {
    materialCost: 400_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Spawn an audacious into target zone. It is not temporary.',
  },
  'TG:Horror': {
    materialCost: 50_000, blueprintCost: 77_000, keywords: ['robotic'], vehicleType: 'ship',
    cardText: 'Whenever a horror participates in an offensive fleet battle, create anther copy of it in this zone. Max one spawn per zone',
  },
  // ----------------------------------------------------------------- OW
  'OW:Bulwark': { materialCost: 600_000, blueprintCost: 848_000, keywords: ['blocker'], vehicleType: 'ship', cardText: '' },
  'OW:Eyrie': { materialCost: 650_000, blueprintCost: 809_000, keywords: ['blocker', 'fragile'], vehicleType: 'airship', cardText: '' },
  // ----------------------------------------------------------------- WF
  'WF:Scourge': { materialCost: 225_000, blueprintCost: 209_000, keywords: ['blocker', 'scrappy'], vehicleType: 'ship', cardText: '' },
  'WF:Disemboweler': { materialCost: 300_000, blueprintCost: 305_000, keywords: ['stealthy'], vehicleType: 'sub', cardText: '' },
  'WF:Slasher': {
    materialCost: 300_000, blueprintCost: 353_000, keywords: [], vehicleType: 'ship',
    cardText: 'When this is played, add an earth raker to your hand. it costs 0.',
  },
  'WF:Basher': {
    materialCost: 210_000, blueprintCost: 214_000, keywords: [], vehicleType: 'ship',
    cardText: 'When this vehicle is destroyed, draw a card',
  },
  'WF:Purifier': {
    materialCost: 760_000, blueprintCost: 765_000, keywords: ['halfCost', 'fragile'], vehicleType: 'ship',
    cardText: 'This vehicle does no damage to the enemy base. Whenever it participates in a fleet battle, the enemy forces must spawn in first, even if they are defending.',
  },
}

describe('2026-09-16 balance pass — every touched row', () => {
  it('touches exactly 34 rows: 2 new, 31 updated, 1 retired', () => {
    expect(Object.keys(CARDS)).toHaveLength(34)
  })

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

  // The two new rows, by name: transform.ts derives each id from
  // `card:<faction>:<name>`, so a retitle mints a different card.
  it('seeds Mutiny and Brigand under their delivered names, wired to their effects', async () => {
    const byKey = await bySeedKey()
    expect(metaOf(byKey.get('DWG:Mutiny')!)).toEqual({ playOnVehicleEffect: 'mutinyEffect' })
    expect(metaOf(byKey.get('DWG:Brigand')!)).toEqual({ onDeathEffect: 'brigandOnDeath' })
    expect(byKey.get('DWG:Mutiny')!.type).toBe('ability')
    expect(isImplemented('mutinyEffect')).toBe(true)
    expect(isImplemented('brigandOnDeath')).toBe(true)
  })

  it('Sinners Luck names its rework and nothing else', async () => {
    expect(metaOf((await bySeedKey()).get('DWG:Sinners Luck')!)).toEqual({ onPlayEffect: 'sinnersLuckOnPlay' })
  })

  // M-6. A data key whose VALUE the engine compares (strict === true) needs a
  // seed-backed assertion — no guard checks a value. Tarpon drops the rule
  // outright, so its meta is EMPTY, asserted in both directions.
  it('M-6: Albacore is uniquePerZone and no seeded card carries aircraftLock any more', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
    expect(metaOf(byKey.get('DWG:Albacore')!)).toEqual({ uniquePerZone: true })
    expect(metaOf(byKey.get('DWG:Tarpon')!)).toEqual({})
    expect(cards.filter((c) => metaOf(c).aircraftLock !== undefined)).toEqual([])
    expect(cards.filter((c) => metaOf(c).uniquePerZone === true).map((c) => `${c.faction}:${c.name}`).sort())
      .toEqual(['DWG:Albacore', 'TG:Obelisk'])
  })

  // M-3. The whole of Mirth Swarm's text is this key.
  it('M-3: Mirth Swarm carries battleCap 1 as a number, and the key is recognised', async () => {
    const meta = metaOf((await bySeedKey()).get('TG:Mirth Swarm')!)
    expect(meta).toEqual({ summonOnly: true, battleCap: 1 })
    expect([...DATA_EFFECT_KEYS]).toContain('battleCap')
  })

  // M-9 lives in retirement.test.ts; the trigger staying named is asserted here too.
  it('M-9: Horror is retired and still names horrorBattle', async () => {
    expect(metaOf((await bySeedKey()).get('TG:Horror')!)).toEqual({ onBattleEffect: 'horrorBattle', retired: true })
  })

  // M-10. Three cards lose their effect; the implementations stay registered
  // (effectCoverage.test.ts DELIBERATE_ORPHANS) and the rows carry no name.
  it.each(['SS:Spectre', 'WF:Scourge', 'WF:Disemboweler'])('%s carries no effect name (M-10)', async (k) => {
    expect(metaOf((await bySeedKey()).get(k)!)).toEqual({})
  })

  it('Basher already draws on death — wording change only (§5)', async () => {
    expect(metaOf((await bySeedKey()).get('WF:Basher')!)).toEqual({ onDeathEffect: 'basherOnDeath' })
  })

  it('Obelisk keeps its battle trigger and uniquePerZone beside its new price (Q6)', async () => {
    expect(metaOf((await bySeedKey()).get('TG:Obelisk')!)).toEqual({ onBattleEffect: 'obeliskBattle', uniquePerZone: true })
  })

  it('Tyr and Purifier keep the meta their text promises', async () => {
    const byKey = await bySeedKey()
    expect(metaOf(byKey.get('SS:Tyr')!)).toEqual({ costModifier: 'tyrCostModifier' })
    expect(metaOf(byKey.get('WF:Purifier')!)).toMatchObject({ noBaseDamage: true, deployOrder: 'last' })
  })

  // The constants the rewritten texts print.
  it('M-8 / Slasher: the constants match the printed counts', () => {
    expect(FLYING_SQUIRREL_ATTACK_COUNT).toBe(6) // two 3x squadrons
    expect(SLASHER_EARTH_RAKER_COUNT).toBe(1)
    expect(TYR_MIN_COST).toBe(500_000)
  })

  // ⚠ A missing or stale { needsCatalog } flag is invisible to unit tests.
  it('catalog flags: Brigand mints, Fear/Mutiny/Sinners Luck do not', () => {
    expect(CATALOG_EFFECTS.has('brigandOnDeath')).toBe(true)
    expect(CATALOG_EFFECTS.has('fearOnPlay')).toBe(false)
    expect(CATALOG_EFFECTS.has('mutinyEffect')).toBe(false)
    expect(CATALOG_EFFECTS.has('sinnersLuckOnPlay')).toBe(false)
  })

  it('every card in CARDS is seeded', async () => {
    const seeded = await bySeedKey()
    for (const k of Object.keys(CARDS)) expect(seeded.has(k), `${k} is missing`).toBe(true)
  })
})
