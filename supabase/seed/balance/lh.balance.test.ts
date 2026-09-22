import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-21 LH redesign, pinned against the seed source by VALUE — costs,
// keywords, texts, and every charge/gate/placement data key, because G1/G2/G3
// check names and presence, never numbers (docs/claude/card-effects.md).
// Numbers are spelled out, never derived.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

interface Expected {
  materialCost: number
  blueprintCost: number
  cpCost: number
  keywords: string[]
  vehicleType: string | null
  cardText: string
  meta: Record<string, unknown>
}

export const CARDS: Record<string, Expected> = {
  'LH:Chrysoprase': {
    materialCost: 40_000, blueprintCost: 39_571, cpCost: 0, keywords: ['scrappy'], vehicleType: 'ship',
    cardText: '', meta: { chargeMax: 2 },
  },
  'LH:Dipole': {
    materialCost: 70_000, blueprintCost: 65_069, cpCost: 0, keywords: ['mobile'], vehicleType: 'airship',
    cardText: '', meta: { chargeMax: 2 },
  },
  'LH:Watt': {
    materialCost: 90_000, blueprintCost: 90_797, cpCost: 0, keywords: ['scrappy', 'mobile', 'decoy'], vehicleType: 'ship',
    cardText: '', meta: { chargeMax: 1 },
  },
  'LH:Luxon': {
    materialCost: 60_000, blueprintCost: 59_142, cpCost: 0, keywords: ['halfCost', 'temporary'], vehicleType: 'plane',
    cardText: 'Blind on its own: can only be played into a zone where you control an LH vehicle.',
    meta: { deployRequiresLhVehicle: true },
  },
  'LH:Conduit': {
    materialCost: 70_000, blueprintCost: 54_077, cpCost: 0, keywords: ['inoffensive', 'scrappy'], vehicleType: 'ship',
    cardText: 'Relay: at the start of your turn, other friendly LH vehicles in this zone gain 1 additional charge. This does not stack.',
    meta: { chargeRelay: 1 },
  },
  'LH:Byte': {
    materialCost: 40_000, blueprintCost: 43_301, cpCost: 0, keywords: ['mobile'], vehicleType: 'ship',
    cardText: 'Discharge 1: draw a card.',
    meta: { chargeMax: 1, onActivate: 'byteDraw', activateCpCost: 0, dischargeCost: 1 },
  },
  'LH:Volta': {
    materialCost: 40_000, blueprintCost: 37_207, cpCost: 0, keywords: ['fragile'], vehicleType: 'ship',
    cardText: 'When played, a friendly LH vehicle in this zone gains 1 charge.',
    meta: { chargeMax: 1, onPlayEffect: 'voltaJumpStart' },
  },
}

// Retired by this wave (spec §7): rows stay seeded, undraftable.
export const RETIRED = [
  'LH:Coulomb', 'LH:Thunderbird', 'LH:Sapphire', 'LH:Sapphire Screen', 'LH:Spectrum',
  'LH:Orbit', 'LH:Orbit Flank', 'LH:Robotic Assemblers',
  'TG:[TG] Amusement', 'TG:[TG] Fear', 'TG:[TG] Hysteria', 'TG:[TG] Obsession',
]

describe('LH redesign — rows by value', () => {
  it.each(Object.entries(CARDS))('%s', async (k, want) => {
    const card = (await bySeedKey()).get(k)
    expect(card, `${k} is missing from the seed source`).toBeDefined()
    expect({
      materialCost: card!.materialCost, blueprintCost: card!.blueprintCost, cpCost: card!.cpCost,
      keywords: [...(card!.keywords ?? [])].sort(), vehicleType: card!.vehicleType ?? null,
      cardText: card!.cardText ?? '',
    }).toEqual({
      materialCost: want.materialCost, blueprintCost: want.blueprintCost, cpCost: want.cpCost,
      keywords: [...want.keywords].sort(), vehicleType: want.vehicleType, cardText: want.cardText,
    })
    // Every data key by VALUE; unlisted engine-facing keys must be absent so a
    // stray gate or price cannot ride in unpinned.
    const meta = (card!.meta ?? {}) as Record<string, unknown>
    for (const [key, value] of Object.entries(want.meta)) expect(meta[key], `${k}.meta.${key}`).toEqual(value)
    for (const key of ['chargeMax', 'chargeRate', 'chargeRelay', 'dischargeCost', 'dischargeFrom', 'requiresCharge', 'deployRequiresLhVehicle', 'ignoresAirScreen', 'activateCpCost']) {
      if (!(key in want.meta)) expect(meta[key], `${k}.meta.${key} should be absent`).toBeUndefined()
    }
    expect(meta.retired, `${k} must not be retired`).not.toBe(true)
  })

  it.each(RETIRED)('%s is retired and still seeded', async (k) => {
    const card = (await bySeedKey()).get(k)
    expect(card, `${k} must stay seeded for in-flight games`).toBeDefined()
    expect((card!.meta as Record<string, unknown>).retired).toBe(true)
  })
})
