import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-02 balance pass — DWG's share, pinned against the seed source.
//
// One file per faction so the five faction branches never edit the same test
// file (spec §2.3). Costs, keywords and card text are plain data that nothing
// else in the suite reads: effectCoverage asks only whether a card's EFFECTS
// are wired, and seedDataSync only whether the generated SQL matches its
// source. Both stay green if a number is fat-fingered. This file would not.
//
// Numbers are spelled out, never derived — a test that recomputes its
// expectation from the source it is checking proves nothing.

const MARAUDER_TEXT = 'When this vehicle is played, draw a vehicle card from the enemy deck'
const PLUNDERER_TEXT =
  'Costs 20k less for each friendly vehicle in play. When this vehicle survives a victorious ' +
  'fleet battle or inflicts damage to the enemy base, draw one card from the enemy deck, but ' +
  'increase its cost by 20k'
const AIRCRAFT_LOCK =
  'While this vehicle is alive, you may not play any other aircraft into this zone'
const LOGGERHEAD_TEXT =
  'When this vehicle is destroyed, shuffle another copt of it into your deck. It costs 0.'
const SPAWN_BUCCANEER_TEXT =
  'Spawn a Buccaneer into a zone. It is not temporary. It gains the Scrappy keyword.'

interface Expected {
  materialCost: number
  blueprintCost: number
  keywords: string[]
  vehicleType: string | null
  cardText: string
}

// Keywords are compared as sets — order in the seed literal is not meaningful.
const CARDS: Record<string, Expected> = {
  // 40k -> 55k, and the "reduce its cost by 50k" clause is gone from both the
  // text and marauderOnPlay. blueprintCost is deliberately unmoved: this pass
  // changes the material price only, so bp now sits BELOW it. Not a typo.
  'DWG:Marauder': {
    materialCost: 55_000, blueprintCost: 40_205, keywords: [],
    vehicleType: 'ship', cardText: MARAUDER_TEXT,
  },
  // Costs unchanged; the text gains the surcharge plundererRaid now stamps.
  'DWG:Plunderer': {
    materialCost: 180_000, blueprintCost: 187_000, keywords: ['blocker', 'scrappy'],
    vehicleType: 'ship', cardText: PLUNDERER_TEXT,
  },
  'DWG:Tarpon': {
    materialCost: 510_000, blueprintCost: 511_605, keywords: ['fragile', 'subScreen'],
    vehicleType: 'airship', cardText: AIRCRAFT_LOCK,
  },
  // -halfCost. Its SCRAPPY is NOT restored, despite Wave 0 correcting the rule
  // that took it: that is a balance decision this pass does not make (spec §8).
  'DWG:Loggerhead': {
    materialCost: 70_000, blueprintCost: 74_000, keywords: [],
    vehicleType: 'airship', cardText: LOGGERHEAD_TEXT,
  },
  'DWG:Buccaneer': {
    materialCost: 225_000, blueprintCost: 296_000, keywords: ['fragile'],
    vehicleType: 'airship', cardText: '',
  },
  // Matches the hull it mints: 150k -> 225k. An ability, so vehicleType null.
  'DWG:Spawn Buccaneer': {
    materialCost: 225_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: SPAWN_BUCCANEER_TEXT,
  },
}

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

describe('2026-09-02 balance pass — DWG', () => {
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

  // A cost-and-keyword edit that clobbered `meta` would delete an effect
  // silently: G1/G2 only ask whether the names a card DOES carry resolve, so a
  // card carrying none passes both. Braveheart shipped exactly that bug in the
  // 2026-08-30 pass (balancePass.test.ts). Five of these six rows carry a
  // registry name or a data rule; all five are compared here.
  it('every DWG card this pass touched keeps the meta it had', async () => {
    const cards = await bySeedKey()
    expect(cards.get('DWG:Marauder')!.meta).toEqual({ onPlayEffect: 'marauderOnPlay' })
    expect(cards.get('DWG:Plunderer')!.meta).toEqual({
      costModifier: 'plundererCostModifier', onBattleVictory: 'plundererRaid',
    })
    expect(cards.get('DWG:Tarpon')!.meta).toEqual({ aircraftLock: true })
    expect(cards.get('DWG:Loggerhead')!.meta).toEqual({ onDeathEffect: 'loggerheadOnDeath' })
    expect(cards.get('DWG:Spawn Buccaneer')!.meta).toEqual({
      playOnZoneEffect: 'spawnBuccaneerEffect',
    })
  })

  // Marauder's new 55k sits 5k under DWG_WATERS_GUEST_MAX_COST (60_000,
  // EXCLUSIVE — shared/gameSettings.ts). Nothing else in the suite would notice
  // it crossing that cliff: dwgGuestPool is only ever exercised against a
  // hand-built catalog, so the REAL pool's membership is asserted nowhere else.
  // Same reasoning as balancePass.test.ts's Harbringer pool guard.
  it('the DWG Waters guest pool is still exactly Corsair and Marauder', async () => {
    const { cards } = await loadSeedData()
    const pool = cards
      .filter((c) => c.isBuiltIn && c.faction === 'DWG' && c.type === 'vehicle'
        && c.materialCost < 60_000)
      .map((c) => c.name)
      .sort()
    expect(pool).toEqual(['Corsair', 'Marauder'])
  })
})
